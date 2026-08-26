use std::path::Path;

use super::audio::{self, AudioFileDecoder};

const TARGET_POINTS: usize = 400;
const MAX_SAMPLES: usize = 6_000_000;

/// Cache version byte prefixed to every waveform BLOB.  Bump this when the
/// extraction algorithm changes so stale caches are silently ignored and
/// re-extracted on next play.
pub const WAVEFORM_CACHE_VERSION: u8 = 2;

/// Perceptual curve exponent — values below 1.0 expand quiet sections and
/// compress loud ones, giving the waveform visible dynamic range similar to
/// commercial players (Poweramp, SoundCloud).
const CURVE_EXPONENT: f32 = 0.65;

/// Decode the entire file and return 400 energy samples normalized to 0.0..1.0.
///
/// Each point is the **RMS** (root-mean-square) energy of its segment, raised
/// to a perceptual curve, then linearly normalized so the loudest segment is
/// exactly 1.0.  RMS reflects perceived loudness much better than raw peak
/// amplitude — quiet sections are visibly shorter, loud sections taller.
///
/// Returns flat zeros if the file cannot be opened or decoded.
pub fn extract_peaks(path: &Path) -> Vec<f32> {
    let (mut decoder, _format) = match audio::open_audio(path) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[waveform] open_audio failed for {}: {}", path.display(), e);
            return vec![0.0; TARGET_POINTS];
        }
    };

    let mut all_samples: Vec<f32> = Vec::with_capacity(4096 * 2);
    while let Some(chunk) = decode_packet(&mut decoder) {
        all_samples.extend_from_slice(&chunk);
        if all_samples.len() >= MAX_SAMPLES {
            eprintln!(
                "[waveform] truncated decode for {} at {} samples (cap {})",
                path.display(),
                all_samples.len(),
                MAX_SAMPLES
            );
            break;
        }
    }

    if all_samples.is_empty() {
        return vec![0.0; TARGET_POINTS];
    }

    // --- RMS-pool into TARGET_POINTS buckets ---------------------------
    let total = all_samples.len();
    let pool_size = (total / TARGET_POINTS).max(1);
    let mut energies = Vec::with_capacity(TARGET_POINTS);

    for i in 0..TARGET_POINTS {
        let start = i * pool_size;
        let end = if i + 1 == TARGET_POINTS { total } else { (i + 1) * pool_size };
        let segment = &all_samples[start..end];
        let len = segment.len() as f32;
        if len == 0.0 {
            energies.push(0.0);
            continue;
        }
        let sum_sq: f64 = segment.iter().map(|&s| s as f64 * s as f64).sum();
        let rms = (sum_sq / len as f64).sqrt() as f32;
        energies.push(rms);
    }

    // --- perceptual curve: expand quiet, compress loud ------------------
    for e in &mut energies {
        *e = e.powf(CURVE_EXPONENT);
    }

    // --- normalize so the loudest point is exactly 1.0 ------------------
    let max_e = energies.iter().copied().fold(0.0f32, f32::max);
    if max_e > 0.0 {
        let inv = 1.0 / max_e;
        for e in &mut energies {
            *e *= inv;
        }
    }

    energies
}

fn decode_packet(decoder: &mut AudioFileDecoder) -> Option<Vec<f32>> {
    audio::decode_packet(decoder)
}
