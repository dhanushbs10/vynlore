use std::path::Path;

use crate::decoder::audio::{self};

/// Target loudness for ReplayGain (LUFS). -16 is a good music-player value:
/// loud enough to stay lively, soft enough to leave headroom for EQ boosts.
const TARGET_LUFS: f64 = -16.0;
/// Hard floor/ceiling on the derived gain so a single oddly mastered file
/// never gets absurdly quiet or absurdly loud.
const MAX_GAIN_DB: f64 = 12.0;

/// Integrated-loudness ReplayGain analysis (EBU R128 flavour).
///
/// Weighs the decoded stream with the R128 K-weighting pre-filter (a 38 Hz
/// high-pass plus a +4 dB shelf at ~1681 Hz), measures block RMS, then derives
/// a single gain that normalizes the track to `TARGET_LUFS`. True peak (sample
/// peak of the unweighted stream) caps the gain so normalization never clips.
pub struct ReplayGainResult {
	pub track_gain_db: f64,
	pub track_peak: f64,
}

struct KWeight {
	// Per-channel: [hp38 x2 state, shelf x2 state]
	hp_x1: [f64; 2],
	hp_x2: [f64; 2],
	hp_y1: [f64; 2],
	hp_y2: [f64; 2],
	sh_x1: [f64; 2],
	sh_x2: [f64; 2],
	sh_y1: [f64; 2],
	sh_y2: [f64; 2],
	hp_b: [[f64; 3]; 2],
	hp_a: [[f64; 3]; 2],
	sh_b: [[f64; 3]; 2],
	sh_a: [[f64; 3]; 2],
}

impl KWeight {
	fn new(fs: u32) -> Self {
		let fs = fs.max(1) as f64;
		// RBJ high-pass, 38 Hz, Q = 0.5 (R128 spec pre-filter).
		let w0 = 2.0 * std::f64::consts::PI * 38.0 / fs;
		let (sin_w0, cos_w0) = w0.sin_cos();
		let alpha = sin_w0 / (2.0 * 0.5);
		let hp_b0 = (1.0 + cos_w0) / 2.0;
		let hp_b1 = -(1.0 + cos_w0);
		let hp_b2 = hp_b0;
		let hp_a0 = 1.0 + alpha;
		let hp_a1 = -2.0 * cos_w0;
		let hp_a2 = 1.0 - alpha;
		let hp_b = [
			[hp_b0 / hp_a0, hp_b1 / hp_a0, hp_b2 / hp_a0],
			[hp_b0 / hp_a0, hp_b1 / hp_a0, hp_b2 / hp_a0],
		];
		let hp_a = [
			[1.0, hp_a1 / hp_a0, hp_a2 / hp_a0],
			[1.0, hp_a1 / hp_a0, hp_a2 / hp_a0],
		];

		// RBJ high-shelf, 1681 Hz, +4 dB (R128 stage two).
		let a = 10f64.powf(4.0 / 20.0);
		let shelf_w0 = 2.0 * std::f64::consts::PI * 1681.0 / fs;
		let (s_sin, s_cos) = shelf_w0.sin_cos();
		let s_alpha = s_sin / 2.0 * a.sqrt();
		let sq = 2.0 * a.sqrt() * s_alpha;
		let sh_b0 = a * ((a + 1.0) + (a - 1.0) * s_cos + sq);
		let sh_b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * s_cos);
		let sh_b2 = a * ((a + 1.0) + (a - 1.0) * s_cos - sq);
		let sh_a0 = (a + 1.0) - (a - 1.0) * s_cos + sq;
		let sh_a1 = 2.0 * ((a - 1.0) - (a + 1.0) * s_cos);
		let sh_a2 = (a + 1.0) - (a - 1.0) * s_cos - sq;
		let sh_b = [
			[sh_b0 / sh_a0, sh_b1 / sh_a0, sh_b2 / sh_a0],
			[sh_b0 / sh_a0, sh_b1 / sh_a0, sh_b2 / sh_a0],
		];
		let sh_a = [
			[1.0, sh_a1 / sh_a0, sh_a2 / sh_a0],
			[1.0, sh_a1 / sh_a0, sh_a2 / sh_a0],
		];

		Self {
			hp_x1: [0.0; 2],
			hp_x2: [0.0; 2],
			hp_y1: [0.0; 2],
			hp_y2: [0.0; 2],
			sh_x1: [0.0; 2],
			sh_x2: [0.0; 2],
			sh_y1: [0.0; 2],
			sh_y2: [0.0; 2],
			hp_b,
			hp_a,
			sh_b,
			sh_a,
		}
	}

	#[inline]
	fn process(&mut self, ch: usize, x: f64) -> f64 {
		// Stage 1: high-pass 38 Hz.
		let hp = self.hp_b[ch][0] * x + self.hp_b[ch][1] * self.hp_x1[ch] + self.hp_b[ch][2] * self.hp_x2[ch]
			- self.hp_a[ch][1] * self.hp_y1[ch]
			- self.hp_a[ch][2] * self.hp_y2[ch];
		self.hp_x2[ch] = self.hp_x1[ch];
		self.hp_x1[ch] = x;
		self.hp_y2[ch] = self.hp_y1[ch];
		self.hp_y1[ch] = hp;
		// Stage 2: +4 dB shelf.
		let sh = self.sh_b[ch][0] * hp + self.sh_b[ch][1] * self.sh_x1[ch] + self.sh_b[ch][2] * self.sh_x2[ch]
			- self.sh_a[ch][1] * self.sh_y1[ch]
			- self.sh_a[ch][2] * self.sh_y2[ch];
		self.sh_x2[ch] = self.sh_x1[ch];
		self.sh_x1[ch] = hp;
		self.sh_y2[ch] = self.sh_y1[ch];
		self.sh_y1[ch] = sh;
		sh
	}
}

pub fn analyze(path: &Path) -> Result<ReplayGainResult, String> {
	let (mut decoder, format) = audio::open_audio(path).map_err(|e| e.to_string())?;
	let ch = format.channels.max(1) as usize;
	let fs = format.sample_rate.max(1);
	let mut weight = KWeight::new(fs);

	let block_frames = (fs / 10).max(1) as u64; // 100 ms block
	let mut powers: Vec<f64> = Vec::with_capacity(2400);
	let (mut block_sq, mut block_n): (f64, u64) = (0.0, 0);
	let mut peak: f64 = 0.0;

	loop {
		let Some(samples) = audio::decode_packet(&mut decoder) else {
			break;
		};
		// samples are interleaved f32 PCM from the decoder
		for (i, &s) in samples.iter().enumerate() {
			let c = i % ch;
			let v = s as f64;
			peak = peak.max(v.abs());
			let weighted = weight.process(c, v);
			block_sq += weighted * weighted;
			block_n += 1;
			if block_n >= block_frames {
				let p = block_sq / block_n as f64;
				block_sq = 0.0;
				block_n = 0;
				if p > 1e-12 {
					powers.push(p);
				}
			}
		}
	}
	if block_n > 0 {
		let p = block_sq / block_n as f64;
		if p > 1e-12 {
			powers.push(p);
		}
	}

	if powers.is_empty() {
		// Silent file — leave it alone rather than boosting noise to the moon.
		return Ok(ReplayGainResult { track_gain_db: 0.0, track_peak: peak });
	}

	// Absolute gating: drop blocks quieter than -70 LUFS (mostly silence).
	let gate = 10f64.powf(-70.0 / 10.0);
	let gated: Vec<f64> = powers.iter().copied().filter(|&p| p > gate).collect();
	let mean_power = if gated.is_empty() { powers.iter().sum::<f64>() / powers.len() as f64 } else { gated.iter().sum::<f64>() / gated.len() as f64 };
	let lufs = 10.0 * mean_power.log10() + 0.691;

	let mut gain = TARGET_LUFS - lufs;
	gain = gain.clamp(-MAX_GAIN_DB, MAX_GAIN_DB);

	// Never allow the gain to push peaks past full scale.
	let linear = 10f64.powf(gain / 20.0);
	if peak > 0.0 {
		let max_safe = 0.98 / peak;
		if linear > max_safe.max(0.5) && (max_safe.max(0.5) * peak) < linear * peak {
			let capped = max_safe.max(0.5);
			gain = 20.0 * capped.log10();
		}
	}

	Ok(ReplayGainResult { track_gain_db: gain, track_peak: peak })
}

/// Scalar (linear) multiplier for a ReplayGain value.
pub fn scalar_from_db(db: f64) -> f32 {
	if !db.is_finite() {
		return 1.0;
	}
	10f64.powf(db / 20.0).clamp(0.05, 4.0) as f32
}

/// Resolve the linear gain to apply for a track under the chosen mode.
/// `mode`: 0 = off, 1 = track, 2 = album.
pub fn resolve_gain(
	mode: u32,
	track_gain_db: Option<f64>,
	album_gain_db: Option<f64>,
	track_peak: Option<f64>,
) -> f32 {
	if mode == 0 {
		return 1.0;
	}
	let gain_db = match mode {
		2 => album_gain_db.or(track_gain_db),
		_ => track_gain_db,
	};
	let Some(db) = gain_db else {
		return 1.0;
	};
	if !db.is_finite() {
		return 1.0;
	}
	let mut g = scalar_from_db(db);
	// Peak guard: keep the resampled/EQ'd path well below digital full scale.
	if let Some(pk) = track_peak {
		if pk > 0.0 && pk.is_finite() {
			let max_g = 0.98 / pk;
			if g as f64 > max_g {
				g = max_g as f32;
			}
		}
	}
	g.max(0.05)
}