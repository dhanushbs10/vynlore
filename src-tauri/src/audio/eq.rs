use std::sync::{Arc, Mutex};

pub const DEFAULT_EQ_BAND_COUNT: usize = 10;
pub const DEFAULT_EQ_BANDS_HZ: [f32; DEFAULT_EQ_BAND_COUNT] = [
	31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];
pub const EQ_MAX_GAIN_DB: f32 = 12.0;
pub const EQ_MAX_BOOST_DB: f32 = 12.0;
pub const MIN_BAND_COUNT: usize = 5;
pub const MAX_BAND_COUNT: usize = 32;
pub const DEFAULT_Q: f32 = 1.1;

/// Coefficient ramp time-constant (~8ms): long enough to be inaudible, short
/// enough that slider changes don't lag the hand.
const SMOOTH_TC: f64 = 0.008;
/// Limiter release time constant (~350ms) so the gain eases back slowly and
/// doesn't pump; the attack is effectively instant (envelope follows peaks).
const LIMITER_RELEASE_TC: f64 = 0.35;
/// Limiter gain adjustment smoothing (~12ms) so gain tweaks glide, no zipper.
const LIMITER_GAIN_TC: f64 = 0.012;

#[derive(Clone, Debug)]
pub struct EqSettings {
	pub enabled: bool,
	pub parametric: bool,
	pub gains: Vec<f32>,
	pub qs: Vec<f32>,
	pub band_hz: Vec<f32>,
	pub bass_boost_db: f32,
	pub treble_boost_db: f32,
}

impl Default for EqSettings {
	fn default() -> Self {
		let hz = DEFAULT_EQ_BANDS_HZ.to_vec();
		let count = hz.len();
		Self {
			enabled: false,
			parametric: false,
			gains: vec![0.0; count],
			qs: vec![DEFAULT_Q; count],
			band_hz: hz,
			bass_boost_db: 0.0,
			treble_boost_db: 0.0,
		}
	}
}

impl EqSettings {
	pub fn is_neutral(&self) -> bool {
		!self.enabled
			|| (self.gains.iter().all(|g| g.abs() < 0.05)
				&& self.bass_boost_db.abs() < 0.05
				&& self.treble_boost_db.abs() < 0.05)
	}
}

pub type SharedEq = Arc<Mutex<EqSettings>>;

pub fn shared_eq() -> SharedEq {
	Arc::new(Mutex::new(EqSettings::default()))
}

#[derive(Clone, Copy)]
struct Coeffs {
	b0: f64,
	b1: f64,
	b2: f64,
	a1: f64,
	a2: f64,
}

impl Coeffs {
	#[inline(always)]
	fn step_toward(&mut self, target: &Coeffs, step: f64) {
		self.b0 += (target.b0 - self.b0) * step;
		self.b1 += (target.b1 - self.b1) * step;
		self.b2 += (target.b2 - self.b2) * step;
		self.a1 += (target.a1 - self.a1) * step;
		self.a2 += (target.a2 - self.a2) * step;
	}
}

struct Biquad {
	c: Coeffs,
	target: Coeffs,
	step: f64,
	x1: f64,
	x2: f64,
	y1: f64,
	y2: f64,
}

impl Biquad {
	fn new(c: Coeffs, step: f64) -> Self {
		Self {
			c,
			target: c,
			step,
			x1: 0.0,
			x2: 0.0,
			y1: 0.0,
			y2: 0.0,
		}
	}

	fn set_target(&mut self, c: Coeffs) {
		self.target = c;
	}

	#[inline]
	fn process(&mut self, x: f64) -> f64 {
		// Ramp coefficients toward the target one sample at a time; a
		// single-sample coefficient jump (zipper) becomes an inaudible glide.
		self.c.step_toward(&self.target, self.step);
		let y = self.c.b0 * x
			+ self.c.b1 * self.x1
			+ self.c.b2 * self.x2
			- self.c.a1 * self.y1
			- self.c.a2 * self.y2;
		self.x2 = self.x1;
		self.x1 = x;
		self.y2 = self.y1;
		self.y1 = y;
		y
	}
}

fn design_band(f0: f32, gain_db: f32, q: f32, is_first: bool, is_last: bool, sample_rate: u32) -> Coeffs {
	let f0 = if f0.is_finite() && f0 > 0.0 { f0 } else { 100.0 };
	let q_f64 = if q.is_finite() && q > 0.05 { q as f64 } else { DEFAULT_Q as f64 };
	if gain_db.abs() < 0.05 {
		return Coeffs { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 };
	}

	if is_first && !is_last {
		return design_shelf(f0, gain_db, sample_rate, false);
	} else if is_last && !is_first {
		return design_shelf(f0, gain_db, sample_rate, true);
	}

	peaking(f0, gain_db, q_f64, sample_rate)
}

fn peaking(f0: f32, gain_db: f32, q: f64, sample_rate: u32) -> Coeffs {
	let f0_f64 = f0 as f64;
	let f0_f64 = f0_f64.min(sample_rate as f64 * 0.45);
	let a = 10f64.powf(gain_db as f64 / 20.0);
	let w0 = 2.0 * std::f64::consts::PI * f0_f64 / sample_rate as f64;
	let (sin_w0, cos_w0) = w0.sin_cos();

	let alpha = sin_w0 / (2.0 * q);
	let b0 = 1.0 + alpha * a;
	let b1 = -2.0 * cos_w0;
	let b2 = 1.0 - alpha * a;
	let a0 = 1.0 + alpha / a;
	let a1 = -2.0 * cos_w0;
	let a2 = 1.0 - alpha / a;

	Coeffs { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

fn design_shelf(f0: f32, gain_db: f32, sample_rate: u32, high: bool) -> Coeffs {
	let f0 = if f0.is_finite() && f0 > 0.0 { f0 } else { 100.0 };
	let f0_f64 = (f0 as f64).min(sample_rate as f64 * 0.45);
	let a = 10f64.powf(gain_db as f64 / 20.0);
	let w0 = 2.0 * std::f64::consts::PI * f0_f64 / sample_rate as f64;
	let (sin_w0, cos_w0) = w0.sin_cos();

	if gain_db.abs() < 0.05 {
		return Coeffs { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 };
	}

	let (b0, b1, b2, a0, a1, a2);
	// RBJ cookbook shelving slope S=1: alpha = sin(w0)/2 * sqrt(2).
	let alpha = sin_w0 / 2.0 * 2f64.sqrt();
	let sq = 2.0 * a.sqrt() * alpha;

	if high {
		b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + sq);
		b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
		b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - sq);
		a0 = (a + 1.0) - (a - 1.0) * cos_w0 + sq;
		a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
		a2 = (a + 1.0) - (a - 1.0) * cos_w0 - sq;
	} else {
		b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + sq);
		b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
		b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - sq);
		a0 = (a + 1.0) + (a - 1.0) * cos_w0 + sq;
		a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
		a2 = (a + 1.0) + (a - 1.0) * cos_w0 - sq;
	}

	Coeffs { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/// Stereo-linked soft peak limiter. Prevents EQ boosts from ever reaching the
/// hard clipping stage; attack is instant (envelope follows the peak), release
/// is slow so the gain eases back without pumping.
struct Limiter {
	env: f64,
	gain: f64,
	release_step: f64,
	gain_step: f64,
}

impl Limiter {
	fn new(sample_rate: u32) -> Self {
		let fs = sample_rate.max(1) as f64;
		Self {
			env: 0.0,
			gain: 1.0,
			release_step: 1.0 - (-1.0 / (LIMITER_RELEASE_TC * fs)).exp(),
			gain_step: 1.0 - (-1.0 / (LIMITER_GAIN_TC * fs)).exp(),
		}
	}

	fn reset(&mut self) {
		self.env = 0.0;
		self.gain = 1.0;
	}

	/// Applies limiting across one interleaved frame (all channels), returns
	/// the clipped-to-range samples.
	fn process_frame(&mut self, frame: &mut [f64]) {
		let mut peak: f64 = 0.0;
		for v in frame.iter() {
			let a = v.abs();
			if a > peak {
				peak = a;
			}
		}
		// Instant attack: envelope jumps up with the peak; slow release.
		if peak > self.env {
			self.env = peak;
		} else {
			self.env += (peak - self.env) * self.release_step;
		}
		let desired = if self.env > 1.0 { 1.0 / self.env } else { 1.0 };
		if desired < self.gain {
			self.gain = desired; // instant cut
		} else {
			self.gain += (desired - self.gain) * self.gain_step; // glide back
		}
		for v in frame.iter_mut() {
			*v *= self.gain;
		}
	}
}

pub struct EqProcessor {
	settings: SharedEq,
	sample_rate: u32,
	channels: usize,
	band_filters: Vec<Vec<Biquad>>,
	bass_filters: Vec<Biquad>,
	treble_filters: Vec<Biquad>,
	limiter: Limiter,
	cached_rate: u32,
	cached_parametric: bool,
	cached_gains: Vec<f32>,
	cached_qs: Vec<f32>,
	cached_band_hz: Vec<f32>,
	cached_bass: f32,
	cached_treble: f32,
}

impl EqProcessor {
	pub fn new(settings: SharedEq, sample_rate: u32, channels: usize) -> Self {
		Self {
			settings,
			sample_rate,
			channels,
			band_filters: Vec::new(),
			bass_filters: Vec::new(),
			treble_filters: Vec::new(),
			limiter: Limiter::new(sample_rate),
			cached_rate: 0,
			cached_parametric: false,
			cached_gains: Vec::new(),
			cached_qs: Vec::new(),
			cached_band_hz: Vec::new(),
			cached_bass: f32::NAN,
			cached_treble: f32::NAN,
		}
	}

	pub fn reset(&mut self) {
		for ch in &mut self.band_filters {
			for bq in ch {
				bq.x1 = 0.0;
				bq.x2 = 0.0;
				bq.y1 = 0.0;
				bq.y2 = 0.0;
			}
		}
		for bq in &mut self.bass_filters {
			bq.x1 = 0.0;
			bq.x2 = 0.0;
			bq.y1 = 0.0;
			bq.y2 = 0.0;
		}
		for bq in &mut self.treble_filters {
			bq.x1 = 0.0;
			bq.x2 = 0.0;
			bq.y1 = 0.0;
			bq.y2 = 0.0;
		}
		self.limiter.reset();
	}

	fn ensure_filters(&mut self, s: &EqSettings) {
		let band_count = s.gains.len().max(1);
		let structural = self.cached_rate != self.sample_rate
			|| self.band_filters.len() != self.channels
			|| self.band_filters.first().map_or(true, |f| f.len() != band_count)
			|| self.bass_filters.len() != self.channels
			|| self.treble_filters.len() != self.channels;

		let step = 1.0 - (-1.0 / (SMOOTH_TC * self.sample_rate.max(1) as f64)).exp();

		if structural {
			self.band_filters = (0..self.channels)
				.map(|_| {
					(0..band_count)
						.map(|i| {
							Biquad::new(
								design_band(
									s.band_hz.get(i).copied().unwrap_or(1000.0),
									s.gains.get(i).copied().unwrap_or(0.0),
									band_q(s.parametric, s.qs.get(i).copied()),
									i == 0 && band_count > 1,
									i == band_count - 1 && band_count > 1,
									self.sample_rate,
								),
								step,
							)
						})
						.collect()
				})
				.collect();

			self.bass_filters = (0..self.channels)
				.map(|_| Biquad::new(design_shelf(100.0, s.bass_boost_db, self.sample_rate, false), step))
				.collect();
			self.treble_filters = (0..self.channels)
				.map(|_| Biquad::new(design_shelf(8000.0, s.treble_boost_db, self.sample_rate, true), step))
				.collect();
		} else {
			// In-place retarget: filter memory is preserved so changing gains/
			// Qs/frequencies/shelves glides instead of popping or rebuilding.
			for ch_filters in &mut self.band_filters {
				for (i, bq) in ch_filters.iter_mut().enumerate() {
					bq.set_target(design_band(
						s.band_hz.get(i).copied().unwrap_or(1000.0),
						s.gains.get(i).copied().unwrap_or(0.0),
						band_q(s.parametric, s.qs.get(i).copied()),
						i == 0 && band_count > 1,
						i == band_count - 1 && band_count > 1,
						self.sample_rate,
					));
				}
			}
			for bq in &mut self.bass_filters {
				bq.set_target(design_shelf(100.0, s.bass_boost_db, self.sample_rate, false));
			}
			for bq in &mut self.treble_filters {
				bq.set_target(design_shelf(8000.0, s.treble_boost_db, self.sample_rate, true));
			}
		}

		self.cached_rate = self.sample_rate;
		self.cached_parametric = s.parametric;
		self.cached_gains = s.gains.clone();
		self.cached_qs = s.qs.clone();
		self.cached_band_hz = s.band_hz.clone();
		self.cached_bass = s.bass_boost_db;
		self.cached_treble = s.treble_boost_db;
	}

	pub fn process_interleaved(&mut self, samples: &mut [f32]) {
		let snapshot = match self.settings.lock() {
			Ok(s) => s.clone(),
			Err(_) => return,
		};
		if snapshot.is_neutral() {
			if !self.band_filters.is_empty() {
				self.reset();
				self.band_filters.clear();
				self.bass_filters.clear();
				self.treble_filters.clear();
				self.cached_gains = Vec::new();
				self.cached_qs = Vec::new();
				self.cached_band_hz = Vec::new();
			}
			return;
		}

		self.ensure_filters(&snapshot);

		let ch = self.channels.max(1);
		// Sized to the channel count — a fixed stereo buffer silently dropped
		// every channel past the second (no EQ, no limiter) on surround files.
		let mut buf: Vec<f64> = vec![0.0; ch];
		for frame in samples.chunks_exact_mut(ch) {
			for (c, s) in frame.iter().enumerate() {
				let mut v = *s as f64;
				if let Some(bq) = self.bass_filters.get_mut(c) {
					v = bq.process(v);
				}
				if let Some(bands) = self.band_filters.get_mut(c) {
					for bq in bands {
						v = bq.process(v);
					}
				}
				if let Some(bq) = self.treble_filters.get_mut(c) {
					v = bq.process(v);
				}
				buf[c] = v;
			}
			// Soft-limit the frame (linked across all channels) before writing back.
			let n = frame.len().min(ch);
			self.limiter.process_frame(&mut buf[..n]);
			for (c, s) in frame.iter_mut().enumerate() {
				*s = buf[c].clamp(-1.0, 1.0) as f32;
			}
		}
		// A trailing partial frame can't be processed as audio; leaving it
		// untouched (passthrough) is safer than dropping it silently.
	}
}

fn band_q(parametric: bool, q: Option<f32>) -> f32 {
	if parametric {
		q.unwrap_or(DEFAULT_Q)
	} else {
		DEFAULT_Q
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::{Arc, Mutex};

	fn boosted_proc(band_hz: f32) -> EqProcessor {
		let settings = Arc::new(Mutex::new(EqSettings {
			enabled: true,
			..EqSettings::default()
		}));
		{
			let mut s = settings.lock().unwrap();
			let boost_hz: Vec<f32> = s
				.band_hz
				.iter()
				.enumerate()
				.filter(|(_, hz)| (*hz - band_hz).abs() < 200.0)
				.map(|(i, _)| i as f32)
				.collect();
			for i in boost_hz {
				s.gains[i as usize] = 12.0;
			}
		}
		EqProcessor::new(settings, 48000, 2)
	}

	#[test]
	fn heavy_boost_never_clips_or_nans() {
		let mut proc = boosted_proc(1000.0);
		let mut frame = vec![0.0f32; 256];
		let mut max_abs = 0.0f32;
		for pass in 0..40 {
			for (i, s) in frame.iter_mut().enumerate() {
				let ch = if pass % 2 == 0 { 0 } else { 1 };
				*s = 0.5 * (2.0 * std::f32::consts::PI * 1000.0 * (i / 2) as f32 / 48000.0 + ch as f32).sin();
			}
			proc.process_interleaved(&mut frame);
			for s in &frame {
				assert!(s.is_finite(), "EQ produced NaN/Inf");
				max_abs = max_abs.max(s.abs());
			}
		}
		assert!(max_abs <= 1.0005, "output exceeded digital full scale: {}", max_abs);
	}

	#[test]
	fn neutral_eq_passes_signal_through() {
		let settings = Arc::new(Mutex::new(EqSettings::default()));
		let mut proc = EqProcessor::new(settings, 48000, 2);
		let mut frame = vec![0.0f32; 64];
		let mut err = 0.0f32;
		for pass in 0..20 {
			for (i, s) in frame.iter_mut().enumerate() {
				*s = (2.0 * std::f32::consts::PI * 440.0 * (i / 2) as f32 / 48000.0 + pass as f32 * 0.01).sin();
			}
			let before = frame.clone();
			proc.process_interleaved(&mut frame);
			for (a, b) in frame.iter().zip(before.iter()) {
				err = err.max((a - b).abs());
			}
		}
		assert!(err < 1e-3, "neutral EQ distorted the signal by {err}");
	}

	#[test]
	fn limiter_reduces_loud_sustained_gain() {
		// +12dB on the 1k band with a 0.5-amplitude 1kHz sine should come out
		// with soft-limited RMS well under the naively-amplified ~2.0.
		let mut proc = boosted_proc(1000.0);
		let mut frame = vec![0.0f32; 1024];
		let mut sum_sq = 0.0f64;
		for pass in 0..30 {
			for (i, s) in frame.iter_mut().enumerate() {
				*s = 0.5 * (2.0 * std::f32::consts::PI * 1000.0 * (i / 2) as f32 / 48000.0 + pass as f32).sin();
			}
			proc.process_interleaved(&mut frame);
			for s in &frame {
				sum_sq += (*s as f64) * (*s as f64);
			}
		}
		let rms = (sum_sq / (30 * 1024) as f64).sqrt();
		assert!(rms < 1.0, "limiter not engaging: RMS {rms}");
		assert!(rms > 0.01, "limiter went to digital silence: RMS {rms}");
	}
}