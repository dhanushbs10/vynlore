use std::collections::VecDeque;
use std::sync::Mutex;
use serde::Serialize;

/// 64-bin spectrum analyzer. Thread-safe via interior mutability.
pub struct SpectrumAnalyzer {
    ring: Mutex<VecDeque<f32>>,
    /// 64 magnitudes (0.0..1.0), updated every emit cycle.
    bins: Mutex<[f32; 64]>,
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
        }
    }

    /// Push interleaved f32 samples from the output callback.
    /// Only the most recent 2048 samples are kept for FFT.
    pub fn push_samples(&self, samples: &[f32]) {
        let mut ring = self.ring.lock().unwrap();
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
        // Copy the needed samples out of the ring buffer quickly, then release
        // the lock so the audio callback's push_samples() is never blocked
        // during the expensive FFT computation.
        let snapshot: Vec<f32> = {
            let ring = self.ring.lock().unwrap();
            let n = 2048;
            if ring.len() < n {
                return;
            }
            let len = ring.len();
            let start = len - n;
            ring.range(start..len).copied().collect()
        };

        let n = snapshot.len();
        let mut mono: Vec<f64> = Vec::with_capacity(n);
        let mut i = 0;
        while i < n {
            let s = snapshot[i] as f64;
            let s2 = if i + 1 < n { snapshot[i + 1] as f64 } else { s };
            mono.push((s + s2) * 0.5);
            i += 2;
        }
        // Zero-pad back to n for the FFT (stereo downmix halves the sample count)
        while mono.len() < n {
            mono.push(0.0);
        }
        let mono = &mono[..n];

        let mut windowed: Vec<f64> = Vec::with_capacity(n);
        for (i, &s) in mono.iter().enumerate() {
            let w = 0.5 * (1.0 - (2.0 * std::f64::consts::PI * i as f64 / n as f64).cos());
            windowed.push(s * w);
        }

        let mut re: Vec<f64> = windowed;
        let mut im: Vec<f64> = vec![0.0; n];
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
            // Normalize to 0..1 range; the factor accounts for average FFT magnitude
            let normalized = (energy * 3.0).min(1.0);
            bins[b] = normalized as f32;
        }

        *self.bins.lock().unwrap() = bins;
    }

    /// Get the current 64 bins as a Vec<f32>.
    pub fn snapshot(&self) -> Vec<f32> {
        self.bins.lock().unwrap().to_vec()
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
