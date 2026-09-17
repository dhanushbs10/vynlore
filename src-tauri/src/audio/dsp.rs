use wsola::TimeStretch;

use pitch_shift::Shifter;

/// Input block size for the phase-vocoder pitch engine.
const PITCH_FRAME: usize = 128;

/// Per-channel phase-vocoder state (mono by construction; the DSP stage keeps
/// one of these per output channel and interleaves results).
struct Vocoder {
	shifter: Shifter<Box<pitch_shift::RawState>>,
	inbuf: Vec<f32>,
	outbuf: Vec<f32>,
}

impl Vocoder {
	fn new() -> Self {
		let state: Box<pitch_shift::RawState> = Box::new([0.0; pitch_shift::TOTAL_F32]);
		Self {
			shifter: Shifter::new(state),
			inbuf: Vec::new(),
			outbuf: Vec::new(),
		}
	}

	fn reset_buffers(&mut self) {
		self.inbuf.clear();
		self.outbuf.clear();
	}

	fn push_block(&mut self, samples: &[f32], semitones: f32, sample_rate: f32) {
		let out = self.shifter.shift(samples, semitones, PITCH_FRAME, sample_rate);
		self.outbuf.extend_from_slice(out);
	}
}

/// Chained tempo + pitch DSP for the decode pipeline.
///
/// Tempo uses WSOLA (pitch-preserving time-stretch) and pitch uses a phase
/// vocoder (tempo-preserving frequency shift), so the two axes are independent.
/// Both stages are bypassed when their control is neutral, giving an exact
/// passthrough so default playback is untouched. Tempo/pitch are read live from
/// the shared control atomics so the values can be changed mid-stream without
/// restarting playback.
pub struct SpeedDsp {
	sample_rate: u32,
	channels: usize,
	ws: Option<TimeStretch>,
	vocoders: Vec<Vocoder>,
	ws_scratch: Vec<f32>,
	block: Vec<f32>,
	semitones: f32,
}

impl SpeedDsp {
	pub fn new(sample_rate: u32, channels: usize) -> Self {
		Self {
			sample_rate,
			channels,
			ws: None,
			vocoders: (0..channels).map(|_| Vocoder::new()).collect(),
			ws_scratch: Vec::new(),
			block: Vec::with_capacity(PITCH_FRAME),
			semitones: 0.0,
		}
	}

	/// Re-sync the processor configuration from the live control atomics.
	/// Apply tempo + pitch to one interleaved block, appending output frames to
	/// `result`. Caller must keep `result` frame-aligned across calls.
	pub fn process(
		&mut self,
		input: &[f32],
		tempo: f32,
		semitones: f32,
		result: &mut Vec<f32>,
	) {
		self.configure_values(tempo, semitones);
		self.chain(input, result);
	}

	/// Finish the stream: emit the WSOLA overlap tail and pad the pitch engine
	/// out so its buffered frames are flushed. Appends to `result`.
	pub fn flush(&mut self, result: &mut Vec<f32>) {
		if let Some(w) = self.ws.as_mut() {
			let tail = w.flush();
			if !tail.is_empty() {
				// The tail is already tempo-processed; only pitch remains.
				self.apply_pitch(&tail, result);
			}
		}
		// Pad-and-shift any unterminated vocoder block so its last frames are
		// not silently dropped at end of stream.
		if !self.vocoders.is_empty() {
			let semi = self.semitones;
			let mut fed = false;
			for v in &mut self.vocoders {
				if v.inbuf.is_empty() {
					continue;
				}
				fed = true;
				self.block.clear();
				self.block.extend_from_slice(&v.inbuf);
				self.block.resize(PITCH_FRAME, 0.0);
				v.push_block(&self.block, semi, self.sample_rate as f32);
				v.inbuf.clear();
			}
			if fed {
				self.drain_pitch(result);
			}
		}
	}

	/// Discard all DSP state after an upstream seek so frames from the old
	/// position can't bleed into the new one.
	pub fn reset(&mut self) {
		if let Some(w) = self.ws.as_mut() {
			w.reset();
		}
		for v in &mut self.vocoders {
			v.shifter = Shifter::new(Box::new([0.0; pitch_shift::TOTAL_F32]));
			v.reset_buffers();
		}
		self.semitones = 0.0;
	}

	fn configure_values(&mut self, tempo: f32, semitones: f32) {
		let speed_active = (tempo - 1.0).abs() > 1e-6;
		let pitch_active = semitones.abs() > 1e-6;

		if speed_active {
			if self.ws.is_none() {
				// Never panic the decode thread on an exotic rate/channel
				// combo: fall back to no time-stretch for this stream.
				match TimeStretch::new(self.sample_rate, self.channels as u16) {
					Ok(mut w) => {
						w.set_tempo(tempo.clamp(wsola::MIN_TEMPO, wsola::MAX_TEMPO));
						self.ws = Some(w);
					}
					Err(e) => {
						eprintln!("wsola init failed ({} Hz/{}ch): {}", self.sample_rate, self.channels, e);
						self.ws = None;
					}
				}
			} else {
				let w = self.ws.as_mut().expect("checked above");
				if (w.tempo() - tempo).abs() > 1e-6 {
					w.set_tempo(tempo.clamp(wsola::MIN_TEMPO, wsola::MAX_TEMPO));
				}
			}
		} else {
			self.ws = None;
		}

		if self.semitones == 0.0 && pitch_active {
			for v in &mut self.vocoders {
				v.shifter = Shifter::new(Box::new([0.0; pitch_shift::TOTAL_F32]));
				v.reset_buffers();
			}
		} else if !pitch_active {
			for v in &mut self.vocoders {
				v.reset_buffers();
			}
		}

		self.semitones = semitones;
	}

	fn chain(&mut self, input: &[f32], result: &mut Vec<f32>) {
		// WSOLA stage: tempo only, always pitch-preserving.
		let owned: Vec<f32>;
		let src: &[f32];
		match self.ws.as_mut() {
			Some(w) => {
				w.push(input);
				self.ws_scratch.clear();
				loop {
					let chunk = w.pull(PITCH_FRAME * 64);
					if chunk.is_empty() {
						break;
					}
					self.ws_scratch.extend_from_slice(&chunk);
				}
				owned = std::mem::take(&mut self.ws_scratch);
				src = &owned;
			}
			None => {
				if self.semitones.abs() <= 1e-6 {
					self.apply_pitch(input, result);
					return;
				}
				owned = input.to_vec();
				src = &owned;
			}
		}
		self.apply_pitch(src, result);
	}

	fn apply_pitch(&mut self, ws_out: &[f32], result: &mut Vec<f32>) {
		// Phase-vocoder stage: pitch only, always tempo-preserving.
		if self.semitones.abs() > 1e-6 {
			for (i, s) in ws_out.iter().enumerate() {
				self.vocoders[i % self.channels].inbuf.push(*s);
			}
			let semi = self.semitones;
			for v in &mut self.vocoders {
				while v.inbuf.len() >= PITCH_FRAME {
					self.block.clear();
					self.block.extend_from_slice(&v.inbuf[..PITCH_FRAME]);
					v.inbuf.drain(..PITCH_FRAME);
					v.push_block(&self.block, semi, self.sample_rate as f32);
				}
			}
			self.drain_pitch(result);
		} else {
			result.extend_from_slice(ws_out);
		}
	}

	fn drain_pitch(&mut self, result: &mut Vec<f32>) {
		let min = self
			.vocoders
			.iter()
			.map(|v| v.outbuf.len())
			.min()
			.unwrap_or(0);
		for f in 0..min {
			for v in &mut self.vocoders {
				result.push(v.outbuf[f]);
			}
		}
		for v in &mut self.vocoders {
			v.outbuf.drain(..min);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn dirac(i: usize, frames: usize, ch: usize) -> f32 {
		if i % ch == 0 && i / ch == frames / 2 {
			1.0
		} else {
			0.0
		}
	}

	#[test]
	fn bypass_is_exact_passthrough() {
		let mut dsp = SpeedDsp::new(48_000, 2);
		let src = (0..4096).map(|i| dirac(i, 2048, 2)).collect::<Vec<_>>();
		let mut out = Vec::new();
		dsp.process(&src, 1.0, 0.0, &mut out);
		dsp.flush(&mut out);
		assert_eq!(out.len(), src.len());
		for (a, b) in out.iter().zip(src.iter()) {
			assert_eq!(a, b);
		}
	}

	#[test]
	fn tempo_2x_roughly_halves_length() {
		let mut dsp = SpeedDsp::new(44_100, 2);
		let mut out = Vec::new();
		let src: Vec<f32> = (0..44_100 * 2)
			.map(|i| (i as f32 * 0.01).sin())
			.collect();
		dsp.process(&src, 2.0, 0.0, &mut out);
		dsp.flush(&mut out);
		// WSOLA adds its frame/tail overhead; length should land near half.
		let frames = out.len() / 2;
		assert!((frames as i64 - 22050).abs() < 5000, "frames={}", frames);
		assert!(out.iter().all(|s| s.is_finite()));
	}

	#[test]
	fn tempo_half_roughly_doubles_length() {
		let mut dsp = SpeedDsp::new(44_100, 2);
		let mut out = Vec::new();
		let src: Vec<f32> = (0..22_050 * 2)
			.map(|i| (i as f32 * 0.01).cos())
			.collect();
		dsp.process(&src, 0.5, 0.0, &mut out);
		dsp.flush(&mut out);
		let frames = out.len() / 2;
		assert!((frames as i64 - 44100).abs() < 10_000, "frames={}", frames);
		assert!(out.iter().all(|s| s.is_finite()));
	}

	#[test]
	fn pitch_preserves_length() {
		let mut dsp = SpeedDsp::new(44_100, 2);
		let mut out = Vec::new();
		let src: Vec<f32> = (0..20_000 * 2)
			.map(|i| (i as f32 * 0.017).sin() + (i as f32 * 0.003).cos())
			.collect();
		dsp.process(&src, 1.0, 3.0, &mut out);
		dsp.flush(&mut out);
		let frames = out.len() / 2;
		assert!((frames as i64 - 20_000).abs() < 2048, "frames={}", frames);
		assert!(out.iter().all(|s| s.is_finite()));
	}

	#[test]
	fn tempo_and_pitch_together_stay_sane() {
		let mut dsp = SpeedDsp::new(44_100, 2);
		let mut out = Vec::new();
		let src: Vec<f32> = (0..30_000 * 2)
			.map(|i| (i as f32 * 0.01).sin())
			.collect();
		dsp.process(&src, 1.5, -2.0, &mut out);
		dsp.flush(&mut out);
		let frames = out.len() / 2;
		assert!((frames as i64 - 20_000).abs() < 10_000, "frames={}", frames);
		assert!(out.iter().all(|s| s.is_finite()));
	}

	/// Midstream zero-crossing frequency estimate (Hertz) over a region of
	/// `out`, skipping the initial vocoder/WSOLA latency.
	fn estimate_hz(out: &[f32], channels: usize, sample_rate: u32, skip: usize) -> f32 {
		let from = skip * channels;
		let window = 32_000usize.min(out.len().saturating_sub(from)) / channels * channels;
		let end = from + window;
		let mut crossings = 0usize;
		let mut prev = out[from];
		for i in (from..end).step_by(channels) {
			let s = out[i];
			if (s >= 0.0) != (prev >= 0.0) {
				crossings += 1;
			}
			prev = s;
		}
		crossings as f32 / 2.0 * sample_rate as f32 / (window / channels) as f32
	}

	#[test]
	fn pitch_plus_octave_doubles_frequency() {
		let sr = 44_100u32;
		let mut dsp = SpeedDsp::new(sr, 1);
		let f0 = 220.0f32;
		let src: Vec<f32> = (0..sr as usize * 3)
			.map(|i| (2.0 * std::f32::consts::PI * f0 * i as f32 / sr as f32).sin())
			.collect();
		let mut out = Vec::new();
		dsp.process(&src, 1.0, 12.0, &mut out);
		dsp.flush(&mut out);
		let est = estimate_hz(&out, 1, sr, 2000);
		assert!(
			(est - 440.0).abs() < 70.0,
			"expected ~440 Hz after +12 st, got {} Hz (len={})",
			est,
			out.len()
		);
	}

	#[test]
	fn pitch_minus_octave_halves_frequency() {
		let sr = 44_100u32;
		let mut dsp = SpeedDsp::new(sr, 1);
		let f0 = 220.0f32;
		let src: Vec<f32> = (0..sr as usize * 3)
			.map(|i| (2.0 * std::f32::consts::PI * f0 * i as f32 / sr as f32).sin())
			.collect();
		let mut out = Vec::new();
		dsp.process(&src, 1.0, -12.0, &mut out);
		dsp.flush(&mut out);
		let est = estimate_hz(&out, 1, sr, 2000);
		assert!(
			(est - 110.0).abs() < 25.0,
			"expected ~110 Hz after -12 st, got {} Hz",
			est
		);
	}

	#[test]
	fn tempo_preserves_pitch_but_speeds_up() {
		let sr = 44_100u32;
		let f0 = 300.0f32;
		let src: Vec<f32> = (0..sr as usize * 2)
			.map(|i| (2.0 * std::f32::consts::PI * f0 * i as f32 / sr as f32).sin())
			.collect();
		let mut dsp = SpeedDsp::new(sr, 1);
		let mut out = Vec::new();
		dsp.process(&src, 2.0, 0.0, &mut out);
		dsp.flush(&mut out);
		let est = estimate_hz(&out, 1, sr, 2000);
		assert!(
			(est - f0).abs() < 60.0,
			"2x tempo must preserve ~300 Hz, got {} Hz",
			est
		);
		// Duration must actually shrink to roughly half.
		let src_frames = src.len();
		let out_frames = out.len();
		assert!(
			out_frames < src_frames / 2 + 4000,
			"out longer than ~half: {} vs {}",
			out_frames,
			src_frames
		);

		// Pitch and tempo together: 10 beats at 200 Hz, tempo 1.5
		let f1 = 200.0f32;
		let src2: Vec<f32> = (0..sr as usize * 12)
			.map(|i| (2.0 * std::f32::consts::PI * f1 * i as f32 / sr as f32).sin())
			.collect();
		let mut dsp2 = SpeedDsp::new(sr, 1);
		let mut out2 = Vec::new();
		dsp2.process(&src2, 1.5, 7.0, &mut out2);
		dsp2.flush(&mut out2);
		let est2 = estimate_hz(&out2, 1, sr, 4000);
		// Expected 200 * 2^(7/12) = 299.9 Hz
		assert!(
			(est2 - 299.9).abs() < 70.0,
			"tempo 1.5 +7 st expected ~300 Hz, got {} Hz",
			est2
		);
		// Tempo 1.5 over 12 s must land near 8 s (plus tail overhead).
		let frames2 = out2.len();
		assert!(
			(frames2 as i64 - 8 * sr as i64).abs() < sr as i64 + 8000,
			"combined length {} frames for 12 s at 1.5x",
			frames2
		);
	}

	#[test]
	fn reset_clears_midstream_state() {
		let mut dsp = SpeedDsp::new(44_100, 2);
		let mut out = Vec::new();
		let src: Vec<f32> = vec![1.0; 4096];
		dsp.process(&src, 0.5, 0.0, &mut out);
		dsp.reset();
		out.clear();
		// Post-reset, a bypass must again be exact passthrough.
		let clean: Vec<f32> = (0..2048).map(|i| (i % 2) as f32).collect();
		dsp.process(&clean, 1.0, 0.0, &mut out);
		dsp.flush(&mut out);
		assert_eq!(out.len(), clean.len());
		for (a, b) in out.iter().zip(clean.iter()) {
			assert_eq!(a, b);
		}
	}
}