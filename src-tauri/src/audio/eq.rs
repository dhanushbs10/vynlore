//! 10-band parametric EQ applied on the DECODER thread (never on the realtime
//! output path): RBJ-cookbook biquads — low-shelf / peaking / high-shelf.
//!
//! The decoder reads the shared `EqSettings` once per chunk and rebuilds
//! coefficients only when rate or gains change, so slider moves apply within
//! ~100 ms while steady-state cost is just 10 biquad passes per sample.

use std::sync::{Arc, Mutex};

pub const EQ_BAND_COUNT: usize = 10;
pub const EQ_BANDS_HZ: [f32; EQ_BAND_COUNT] = [
	31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];
pub const EQ_MAX_GAIN_DB: f32 = 12.0;

#[derive(Clone, Copy, PartialEq, Debug)]
pub struct EqSettings {
	pub enabled: bool,
	pub gains: [f32; EQ_BAND_COUNT], // dB, clamped to ±EQ_MAX_GAIN_DB
}

impl Default for EqSettings {
	fn default() -> Self {
		Self {
			enabled: false,
			gains: [0.0; EQ_BAND_COUNT],
		}
	}
}

impl EqSettings {
	fn is_neutral(&self) -> bool {
		!self.enabled || self.gains.iter().all(|g| g.abs() < 0.05)
	}
}

pub type SharedEq = Arc<Mutex<EqSettings>>;

pub fn shared_eq() -> SharedEq {
	Arc::new(Mutex::new(EqSettings::default()))
}

/// Normalized biquad coefficients (Direct Form I).
#[derive(Clone, Copy)]
struct Coeffs {
	b0: f64,
	b1: f64,
	b2: f64,
	a1: f64,
	a2: f64,
}

#[derive(Clone, Copy)]
struct Biquad {
	c: Coeffs,
	x1: f64,
	x2: f64,
	y1: f64,
	y2: f64,
}

impl Biquad {
	fn new(c: Coeffs) -> Self {
		Self {
			c,
			x1: 0.0,
			x2: 0.0,
			y1: 0.0,
			y2: 0.0,
		}
	}

	#[inline]
	fn process(&mut self, x: f64) -> f64 {
		let y = self.c.b0 * x as f64
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

fn design_band(band: usize, gain_db: f32, sample_rate: u32) -> Coeffs {
	let f0 = (EQ_BANDS_HZ[band] as f64).min(sample_rate as f64 * 0.45);
	let a = 10f64.powf(gain_db as f64 / 40.0);
	let w0 = 2.0 * std::f64::consts::PI * f0 / sample_rate as f64;
	let (sin_w0, cos_w0) = w0.sin_cos();
	let q: f64 = 1.1;

	if gain_db.abs() < 0.05 {
		return Coeffs {
			b0: 1.0,
			b1: 0.0,
			b2: 0.0,
			a1: 0.0,
			a2: 0.0,
		};
	}

	let (b0, b1, b2, a0, a1, a2);
	if band == 0 {
		// Low shelf (S = 1)
		let alpha = sin_w0 / 2.0 * std::f64::consts::SQRT_2;
		let sq = 2.0 * a.sqrt() * alpha;
		b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + sq);
		b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
		b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - sq);
		a0 = (a + 1.0) + (a - 1.0) * cos_w0 + sq;
		a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
		a2 = (a + 1.0) + (a - 1.0) * cos_w0 - sq;
	} else if band == EQ_BAND_COUNT - 1 {
		// High shelf (S = 1)
		let alpha = sin_w0 / 2.0 * std::f64::consts::SQRT_2;
		let sq = 2.0 * a.sqrt() * alpha;
		b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + sq);
		b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
		b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - sq);
		a0 = (a + 1.0) - (a - 1.0) * cos_w0 + sq;
		a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
		a2 = (a + 1.0) - (a - 1.0) * cos_w0 - sq;
	} else {
		// Peaking
		let alpha = sin_w0 / (2.0 * q);
		b0 = 1.0 + alpha * a;
		b1 = -2.0 * cos_w0;
		b2 = 1.0 - alpha * a;
		a0 = 1.0 + alpha / a;
		a1 = -2.0 * cos_w0;
		a2 = 1.0 - alpha / a;
	}

	Coeffs {
		b0: b0 / a0,
		b1: b1 / a0,
		b2: b2 / a0,
		a1: a1 / a0,
		a2: a2 / a0,
	}
}

/// Per-stream processor owned by a Pipeline (decoder thread only).
pub struct EqProcessor {
	settings: SharedEq,
	sample_rate: u32,
	channels: usize,
	// filters[channel][band]
	filters: Vec<Vec<Biquad>>,
	cached_rate: u32,
	cached_gains: [f32; EQ_BAND_COUNT],
}

impl EqProcessor {
	pub fn new(settings: SharedEq, sample_rate: u32, channels: usize) -> Self {
		Self {
			settings,
			sample_rate,
			channels,
			filters: Vec::new(),
			cached_rate: 0,
			cached_gains: [f32::NAN; EQ_BAND_COUNT],
		}
	}

	pub fn reset(&mut self) {
		for ch in &mut self.filters {
			for bq in ch {
				bq.x1 = 0.0;
				bq.x2 = 0.0;
				bq.y1 = 0.0;
				bq.y2 = 0.0;
			}
		}
	}

	fn ensure_filters(&mut self, gains: [f32; EQ_BAND_COUNT]) {
		if self.cached_rate == self.sample_rate && self.cached_gains == gains && !self.filters.is_empty()
		{
			return;
		}
		self.filters = (0..self.channels)
			.map(|_| {
				(0..EQ_BAND_COUNT)
					.map(|band| Biquad::new(design_band(band, gains[band], self.sample_rate)))
					.collect()
			})
			.collect();
		self.cached_rate = self.sample_rate;
		self.cached_gains = gains;
	}

	/// Applies EQ in-place on interleaved samples.
	pub fn process_interleaved(&mut self, samples: &mut [f32]) {
		let snapshot = match self.settings.lock() {
			Ok(s) => *s,
			Err(_) => return,
		};
		if snapshot.is_neutral() {
			if !self.filters.is_empty() {
				self.reset();
				self.filters.clear();
				self.cached_gains = [f32::NAN; EQ_BAND_COUNT];
			}
			return;
		}

		self.ensure_filters(snapshot.gains);

		for frame in samples.chunks_exact_mut(self.channels.max(1)) {
			for (c, s) in frame.iter_mut().enumerate() {
				let mut v = *s as f64;
				for bq in &mut self.filters[c] {
					v = bq.process(v);
				}
				*s = v.clamp(-1.0, 1.0) as f32;
			}
		}
	}
}
