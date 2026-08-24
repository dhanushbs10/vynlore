use crate::error::AudioError;

pub struct AudioResampler {
	ratio: f64,
	channels: usize,
	phase: f64,
	half_len: usize,
	input_buffer: Vec<f32>,
	padded_start: bool,
}

impl AudioResampler {
	pub fn new(from_rate: u32, to_rate: u32, channels: usize) -> Result<Self, AudioError> {
		Ok(Self {
			ratio: from_rate as f64 / to_rate as f64,
			channels,
			phase: 16.0, // Start at 16 to safely look backwards into the zero-padding!
			half_len: 16, // 32-tap Windowed Sinc filter
			input_buffer: Vec::new(),
			padded_start: false,
		})
	}

	pub fn clear(&mut self) {
		self.input_buffer.clear();
		self.padded_start = false;
		self.phase = 16.0;
	}

	pub fn add_input(&mut self, samples: &[f32]) {
		// Pad the beginning with zeros so the Sinc filter can read "backwards" safely
		if !self.padded_start {
			self.input_buffer.resize(self.half_len * self.channels, 0.0);
			self.padded_start = true;
		}
		self.input_buffer.extend_from_slice(samples);
	}

	pub fn flush(&mut self) {
		// Pad the end with zeros so the last few samples ring out properly
		self.input_buffer
			.resize(self.input_buffer.len() + (self.half_len * self.channels), 0.0);
	}

	pub fn has_enough_for_samples(&self, output_samples: usize) -> bool {
		let output_frames = output_samples / self.channels;
		let max_phase = self.phase + (output_frames as f64 * self.ratio);
		let needed_input_samples = (max_phase.ceil() as usize + self.half_len * 2) * self.channels;

		self.input_buffer.len() >= needed_input_samples
	}

  pub fn get_output(&mut self, output: &mut [f32]) -> usize {
    let output_frames = output.len() / self.channels;
    let mut out_frame_idx = 0;

    let cutoff = if self.ratio > 1.0 { 0.5 / self.ratio } else { 1.0 };

		while out_frame_idx < output_frames {
			let center = self.phase as usize;
			let frac = self.phase - center as f64;

			// Ensure we have enough samples for the full window width
			if (center + self.half_len * 2 + 1) * self.channels > self.input_buffer.len() {
				break;
			}

			for ch in 0..self.channels {
				let mut sum = 0.0;

				// Apply the Windowed Sinc filter
				for i in 0..=(self.half_len * 2) {
					// Correctly map backwards and forwards in time
					let idx = (center + i - self.half_len) * self.channels + ch;

					let t = (i as f64) - (self.half_len as f64) - frac;

					// Hann Window
					let window = 0.5
						* (1.0
							+ (2.0 * std::f64::consts::PI * t / (self.half_len * 2) as f64)
								.cos());

					// Sinc function
					let s = if t == 0.0 {
						1.0
					} else {
						let arg = std::f64::consts::PI * t * cutoff;
						arg.sin() / arg
					};

					sum += self.input_buffer[idx] as f64 * s * window;
				}

				output[out_frame_idx * self.channels + ch] = sum as f32;
			}

			out_frame_idx += 1;
			self.phase += self.ratio;
		}

		// Clean up consumed samples to prevent memory leak
		let consumed_input_frames = self.phase as usize;
		if consumed_input_frames > self.half_len {
			let frames_to_drain = consumed_input_frames - self.half_len;
			let samples_to_drain = frames_to_drain * self.channels;
			self.input_buffer.drain(..samples_to_drain);
			self.phase -= frames_to_drain as f64;
		}

		out_frame_idx * self.channels
	}
}
