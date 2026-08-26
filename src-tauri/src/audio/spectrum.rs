use std::collections::VecDeque;
use std::sync::Mutex;
use serde::Serialize;

/// 64-bin spectrum analyzer. Thread-safe via interior mutability.
pub struct SpectrumAnalyzer {
    ring: Mutex<VecDeque<f32>>,
    /// 64 magnitudes (0.0..1.0), updated every emit cycle.
    bins: Mutex<[f32; 64]>,
    channels: Mutex<usize>,
    /// Reusable buffers for compute() to avoid per-cycle allocation.
    snapshot: Mutex<Vec<f32>>,
    mono: Mutex<Vec<f64>>,
    windowed: Mutex<Vec<f64>>,
    re: Mutex<Vec<f64>>,
    im: Mutex<Vec<f64>>,
}

#[derive(Clone, Serialize)]
pub struct SpectrumPayload {
    pub bins: Vec<f32>,
}

impl SpectrumAnalyzer {
    pub fn new() -> Self {
        Self {
            ring: Mutex::new(VecDeque::with_capacity(4096)),
            bins: Mutex::new([0.0f32; 64]),
            channels: Mutex::new(2),
            snapshot: Mutex::new(Vec::with_capacity(2048)),
            mono: Mutex::new(Vec::with_capacity(2048)),
            windowed: Mutex::new(Vec::with_capacity(2048)),
            re: Mutex::new(Vec::with_capacity(2048)),
            im: Mutex::new(Vec::with_capacity(2048)),
        }
    }

    pub fn set_channels(&self, channels: usize) {
        if channels > 0 {
            *self.channels.lock().unwrap_or_else(|e| e.into_inner()) = channels;
        }
    }

    /// Push interleaved f32 samples from the output callback.
    /// Only the most recent 2048 samples are kept for FFT.
    pub fn push_samples(&self, samples: &[f32]) {
        let mut ring = self.ring.lock().unwrap_or_else(|e| e.into_inner());
        for &s in samples {
            ring.push_back(s);
        }
        while ring.len() > 4096 {
            ring.pop_front();
        }
    }

    /// Compute 64 frequency bins from the ring buffer.
    /// Downmixes interleaved multichannel to mono, applies Hann window,
    /// runs radix-2 FFT on 2048 samples, returns 64 magnitude bins.
    /// Called periodically (~30fps) by the emitter thread.
    pub fn compute(&self) {
        let n = 2048usize;
        {
            let ring = self.ring.lock().unwrap_or_else(|e| e.into_inner());
            if ring.len() < n {
                return;
            }
            let mut snapshot = self.snapshot.lock().unwrap_or_else(|e| e.into_inner());
            snapshot.clear();
            let len = ring.len();
            let start = len - n;
            for &s in ring.range(start..len) {
                snapshot.push(s);
            }
        }

        let channels = *self.channels.lock().unwrap_or_else(|e| e.into_inner());
        let snapshot = self.snapshot.lock().unwrap_or_else(|e| e.into_inner());
        let mut mono = self.mono.lock().unwrap_or_else(|e| e.into_inner());
        mono.clear();
        if channels <= 1 {
            for &s in snapshot.iter() {
                mono.push(s as f64);
            }
        } else if channels == 2 {
            let mut i = 0;
            while i < n {
                let s = snapshot[i] as f64;
                let s2 = if i + 1 < n { snapshot[i + 1] as f64 } else { s };
                mono.push((s + s2) * 0.5);
                i += 2;
            }
            while mono.len() < n {
                mono.push(0.0);
            }
        } else {
            let mut i = 0;
            while i < n {
                let mut sum = 0.0f64;
                let mut count = 0usize;
                for ch in 0..channels {
                    if i + ch < n {
                        sum += snapshot[i + ch] as f64;
                        count += 1;
                    }
                }
                mono.push(if count > 0 { sum / count as f64 } else { 0.0 });
                i += channels;
            }
            while mono.len() < n {
                mono.push(0.0);
            }
        }

        let mut windowed = self.windowed.lock().unwrap_or_else(|e| e.into_inner());
        windowed.clear();
        for (i, &s) in mono.iter().enumerate() {
            let w = 0.5 * (1.0 - (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos());
            windowed.push(s * w);
        }

        let mut re = self.re.lock().unwrap_or_else(|e| e.into_inner());
        re.clear();
        re.extend_from_slice(&windowed);
        let mut im = self.im.lock().unwrap_or_else(|e| e.into_inner());
        im.clear();
        im.resize(n, 0.0);
        bit_reverse(&mut re, &mut im, n);

        let log2n = n.trailing_zeros() as u32;
        for stage in 0..log2n {
            let m = 1usize << (stage + 1);
            let half = m / 2;
            let angle_step = -2.0 * std::f64::consts::PI / m as f64;
            for k in (0..n).step_by(m) {
                for j in 0..half {
                    let angle = angle_step * j as f64;
                    let wr = angle.cos();
                    let wi = angle.sin();
                    let t_re = re[k + j + half] * wr - im[k + j + half] * wi;
                    let t_im = re[k + j + half] * wi + im[k + j + half] * wr;
                    re[k + j + half] = re[k + j] - t_re;
                    im[k + j + half] = im[k + j] - t_im;
                    re[k + j] += t_re;
                    im[k + j] += t_im;
                }
            }
        }

        let fft_bins = n / 2;
        let bins_per = fft_bins / 64;
        let mut bins = [0.0f32; 64];
        for b in 0..64 {
            let start_bin = b * bins_per;
            let end_bin = (start_bin + bins_per).min(fft_bins);
            let mut energy = 0.0f64;
            for k in start_bin..end_bin {
                let mag_sq = re[k] * re[k] + im[k] * im[k];
                energy += mag_sq.sqrt();
            }
            energy /= bins_per as f64;
            let normalized = (energy * 3.0).min(1.0);
            bins[b] = normalized as f32;
        }

        *self.bins.lock().unwrap_or_else(|e| e.into_inner()) = bins;
    }

    /// Get the current 64 bins as a Vec<f32>.
    pub fn snapshot(&self) -> Vec<f32> {
        self.bins.lock().unwrap_or_else(|e| e.into_inner()).to_vec()
    }
}

fn bit_reverse(re: &mut [f64], im: &mut [f64], n: usize) {
    let bits = n.trailing_zeros();
    for i in 0..n {
        let j = i.reverse_bits() >> (usize::BITS - bits);
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
}
