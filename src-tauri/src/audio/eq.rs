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

/// Generate log-spaced frequency distribution for `count` bands.
pub fn default_bands(count: usize) -> Vec<f32> {
	let c = count.max(2);
	let log_min = 31.0_f32.log10();
	let log_max = 16000.0_f32.log10();
	(0..c)
		.map(|i| {
			let t = i as f32 / (c - 1) as f32;
			10f32.powf(log_min + t * (log_max - log_min))
		})
		.collect()
}

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
		Self { c, x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }
	}

	#[inline]
	fn process(&mut self, x: f64) -> f64 {
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
	if gain_db.abs() < 0.05 {
		return Coeffs { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 };
	}

	if is_first && !is_last {
		return design_shelf(f0, gain_db, sample_rate, false);
	} else if is_last && !is_first {
		return design_shelf(f0, gain_db, sample_rate, true);
	}

	let f0_f64 = (f0 as f64).min(sample_rate as f64 * 0.45);
	let a = 10f64.powf(gain_db as f64 / 20.0);
	let w0 = 2.0 * std::f64::consts::PI * f0_f64 / sample_rate as f64;
	let (sin_w0, cos_w0) = w0.sin_cos();
	let q_f64 = q as f64;

	// Peaking
	let alpha = sin_w0 / (2.0 * q_f64);
	let b0 = 1.0 + alpha * a;
	let b1 = -2.0 * cos_w0;
	let b2 = 1.0 - alpha * a;
	let a0 = 1.0 + alpha / a;
	let a1 = -2.0 * cos_w0;
	let a2 = 1.0 - alpha / a;

	Coeffs { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

fn design_shelf(f0: f32, gain_db: f32, sample_rate: u32, high: bool) -> Coeffs {
	let f0_f64 = (f0 as f64).min(sample_rate as f64 * 0.45);
	let a = 10f64.powf(gain_db as f64 / 20.0);
	let w0 = 2.0 * std::f64::consts::PI * f0_f64 / sample_rate as f64;
	let (sin_w0, cos_w0) = w0.sin_cos();

	if gain_db.abs() < 0.05 {
		return Coeffs { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 };
	}

	let (b0, b1, b2, a0, a1, a2);
	let alpha = sin_w0 / 2.0 * a.sqrt();
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

pub struct EqProcessor {
	settings: SharedEq,
	sample_rate: u32,
	channels: usize,
	band_filters: Vec<Vec<Biquad>>,
	bass_filters: Vec<Biquad>,
	treble_filters: Vec<Biquad>,
	cached_rate: u32,
	cached_gains: Vec<f32>,
	cached_qs: Vec<f32>,
	cached_band_hz: Vec<f32>,
	cached_parametric: bool,
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
			cached_rate: 0,
			cached_gains: Vec::new(),
			cached_qs: Vec::new(),
			cached_band_hz: Vec::new(),
			cached_parametric: false,
			cached_bass: f32::NAN,
			cached_treble: f32::NAN,
		}
	}

	pub fn reset(&mut self) {
		for ch in &mut self.band_filters {
			for bq in ch {
				bq.x1 = 0.0; bq.x2 = 0.0; bq.y1 = 0.0; bq.y2 = 0.0;
			}
		}
		for bq in &mut self.bass_filters {
			bq.x1 = 0.0; bq.x2 = 0.0; bq.y1 = 0.0; bq.y2 = 0.0;
		}
		for bq in &mut self.treble_filters {
			bq.x1 = 0.0; bq.x2 = 0.0; bq.y1 = 0.0; bq.y2 = 0.0;
		}
	}

	fn needs_rebuild(&self, s: &EqSettings) -> bool {
		self.cached_rate != self.sample_rate
			|| self.cached_parametric != s.parametric
			|| self.cached_bass != s.bass_boost_db
			|| self.cached_treble != s.treble_boost_db
			|| self.cached_gains.len() != s.gains.len()
			|| self.cached_qs.len() != s.qs.len()
			|| self.cached_band_hz.len() != s.band_hz.len()
			|| self.cached_gains.iter().zip(s.gains.iter()).any(|(a, b)| (a - b).abs() > 1e-6)
			|| self.cached_qs.iter().zip(s.qs.iter()).any(|(a, b)| (a - b).abs() > 1e-6)
			|| self.cached_band_hz.iter().zip(s.band_hz.iter()).any(|(a, b)| (a - b).abs() > 0.5)
	}

	fn ensure_filters(&mut self, s: &EqSettings) {
		if !self.needs_rebuild(s) && !self.band_filters.is_empty() {
			return;
		}
		let band_count = s.gains.len();

		if !self.band_filters.is_empty()
			&& self.band_filters[0].len() == band_count
			&& self.cached_parametric == s.parametric
		{
			for ch_filters in &mut self.band_filters {
				for (i, bq) in ch_filters.iter_mut().enumerate() {
					let q = if s.parametric {
						s.qs.get(i).copied().unwrap_or(DEFAULT_Q)
					} else {
						DEFAULT_Q
					};
					let is_first = i == 0 && band_count > 1;
					let is_last = i == band_count - 1 && band_count > 1;
					let hz = s.band_hz.get(i).copied().unwrap_or(1000.0);
					let gain = s.gains.get(i).copied().unwrap_or(0.0);
					bq.c = design_band(hz, gain, q, is_first, is_last, self.sample_rate);
				}
			}
			for (ch, bq) in self.bass_filters.iter_mut().enumerate() {
				let _ = ch;
				bq.c = design_shelf(100.0, s.bass_boost_db, self.sample_rate, false);
			}
			for (ch, bq) in self.treble_filters.iter_mut().enumerate() {
				let _ = ch;
				bq.c = design_shelf(8000.0, s.treble_boost_db, self.sample_rate, true);
			}
		} else {
			self.band_filters = (0..self.channels)
				.map(|_| {
					(0..band_count)
						.map(|i| {
							let q = if s.parametric {
								s.qs.get(i).copied().unwrap_or(DEFAULT_Q)
							} else {
								DEFAULT_Q
							};
							let is_first = i == 0 && band_count > 1;
							let is_last = i == band_count - 1 && band_count > 1;
							let hz = s.band_hz.get(i).copied().unwrap_or(1000.0);
							let gain = s.gains.get(i).copied().unwrap_or(0.0);
							Biquad::new(design_band(hz, gain, q, is_first, is_last, self.sample_rate))
						})
						.collect()
				})
				.collect();

			self.bass_filters = (0..self.channels)
				.map(|_| Biquad::new(design_shelf(100.0, s.bass_boost_db, self.sample_rate, false)))
				.collect();
			self.treble_filters = (0..self.channels)
				.map(|_| Biquad::new(design_shelf(8000.0, s.treble_boost_db, self.sample_rate, true)))
				.collect();
		}

		self.cached_rate = self.sample_rate;
		self.cached_gains = s.gains.clone();
		self.cached_qs = s.qs.clone();
		self.cached_band_hz = s.band_hz.clone();
		self.cached_parametric = s.parametric;
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

		for frame in samples.chunks_exact_mut(self.channels.max(1)) {
			for (c, s) in frame.iter_mut().enumerate() {
				let mut v = *s as f64;
				// Bass shelf
				if let Some(bq) = self.bass_filters.get_mut(c) {
					v = bq.process(v);
				}
				// EQ bands
				if let Some(bands) = self.band_filters.get_mut(c) {
					for bq in bands {
						v = bq.process(v);
					}
				}
				// Treble shelf
				if let Some(bq) = self.treble_filters.get_mut(c) {
					v = bq.process(v);
				}
				*s = v.clamp(-1.0, 1.0) as f32;
			}
		}
	}
}
