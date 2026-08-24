use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder as SymphoniaDecoder, DecoderOptions};
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::{get_codecs, get_probe};

use crate::error::AudioError;

pub struct FlacDecoder {
	format: Box<dyn FormatReader>,
	decoder: Box<dyn SymphoniaDecoder>,
	track_id: u32,
	sample_buf: Option<SampleBuffer<f32>>,
	audio_buffer: Vec<f32>,
	current_frame_idx: usize,
	bits_per_sample: u16,
}

#[derive(Debug)]
pub struct AudioFormat {
	pub sample_rate: u32,
	pub channels: u16,
	pub bits_per_sample: u16,
}

pub fn open_flac(path: &std::path::Path) -> Result<(FlacDecoder, AudioFormat), AudioError> {
	let file = std::fs::File::open(path).map_err(|e| AudioError::FileError(e.to_string()))?;
	let mss = MediaSourceStream::new(Box::new(file), Default::default());

	let mut hint = Hint::new();
	if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
		hint.with_extension(ext);
	}

	let probed = get_probe()
		.format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
		.map_err(|e| AudioError::DecodingError(e.to_string()))?;

	let format = probed.format;

	let track = format
		.tracks()
		.first()
		.ok_or_else(|| AudioError::DecodingError("No track found".to_string()))?;

	let track_id = track.id;
	let params = track.codec_params.clone();

	let sample_rate = params.sample_rate.unwrap_or(44100);
	let channels = params.channels.map_or(2, |c| c.count() as u16);
	let bits_per_sample = params.bits_per_sample.unwrap_or(16) as u16;

	let decoder = get_codecs()
		.make(&params, &DecoderOptions::default())
		.map_err(|e| AudioError::DecodingError(e.to_string()))?;

	Ok((
		FlacDecoder {
			format,
			decoder,
			track_id,
			sample_buf: None,
			audio_buffer: Vec::new(),
			current_frame_idx: 0,
			bits_per_sample,
		},
		AudioFormat {
			sample_rate,
			channels,
			bits_per_sample,
		},
	))
}

pub fn fill_buffer(decoder: &mut FlacDecoder, buffer: &mut [f32]) {
	let mut offset = 0;

	while offset < buffer.len() {
		// If we've run out of samples in our current buffer, decode the next packet
		if decoder.current_frame_idx >= decoder.audio_buffer.len() {
			let packet = match decoder.format.next_packet() {
				Ok(packet) => packet,
				Err(_) => {
					// End of stream or read error — fill the *remaining* buffer with silence
					buffer[offset..].fill(0.0);
					return;
				}
			};

			if packet.track_id() != decoder.track_id {
				continue;
			}

			match decoder.decoder.decode(&packet) {
				Ok(audio_buf_ref) => {
					if decoder.sample_buf.is_none() {
						let spec = *audio_buf_ref.spec();
						let duration = audio_buf_ref.capacity() as u64;
						decoder.sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
					}

					if let Some(sample_buf) = decoder.sample_buf.as_mut() {
						sample_buf.copy_interleaved_ref(audio_buf_ref);
						decoder.audio_buffer = sample_buf.samples().to_vec();
						decoder.current_frame_idx = 0;

						if decoder.bits_per_sample > 16 {
							let scale = 1.0 / (1 << (decoder.bits_per_sample - 1)) as f32;
							for sample in &mut decoder.audio_buffer {
								*sample *= scale;
							}
						}

						let mut sum = 0.0f64;
						for &sample in &decoder.audio_buffer {
							sum += sample as f64;
						}
						let dc = (sum / decoder.audio_buffer.len() as f64) as f32;
						if dc.abs() > 0.01 {
							for sample in &mut decoder.audio_buffer {
								*sample -= dc;
							}
						}
					}
				}
				Err(_) => {
					// Skip bad packet, try the next one.
					continue;
				}
			}
		}

		// Copy as much audio data as we can into the requested buffer
		let available = decoder.audio_buffer.len() - decoder.current_frame_idx;
		let needed = buffer.len() - offset;
		let to_copy = std::cmp::min(available, needed);

		buffer[offset..offset + to_copy].copy_from_slice(
			&decoder.audio_buffer[decoder.current_frame_idx..decoder.current_frame_idx + to_copy],
		);

		offset += to_copy;
		decoder.current_frame_idx += to_copy;
	}
}

pub fn decode_packet(decoder: &mut FlacDecoder) -> Option<Vec<f32>> {
	loop {
		let packet = match decoder.format.next_packet() {
			Ok(p) => p,
			Err(_) => return None,
		};

		if packet.track_id() != decoder.track_id {
			continue;
		}

		match decoder.decoder.decode(&packet) {
			Ok(audio_buf_ref) => {
				if decoder.sample_buf.is_none() {
					let spec = *audio_buf_ref.spec();
					let duration = audio_buf_ref.capacity() as u64;
					decoder.sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
				}

				if let Some(sample_buf) = decoder.sample_buf.as_mut() {
					sample_buf.copy_interleaved_ref(audio_buf_ref);
					let mut samples = sample_buf.samples().to_vec();

					if decoder.bits_per_sample > 16 {
						let scale = 1.0 / (1 << (decoder.bits_per_sample - 1)) as f32;
						for sample in &mut samples {
							*sample *= scale;
						}
					}

					let mut sum = 0.0f64;
					for &sample in &samples {
						sum += sample as f64;
					}
					let dc = (sum / samples.len() as f64) as f32;
					if dc.abs() > 0.01 {
						for sample in &mut samples {
							*sample -= dc;
						}
					}

					return Some(samples);
				}
			}
			Err(_) => continue,
		}
	}
}

pub fn seek(decoder: &mut FlacDecoder, seek_secs: f64) -> Result<(), AudioError> {
	decoder.audio_buffer.clear();
	decoder.current_frame_idx = 0;
	decoder.sample_buf = None;

	decoder.format.seek(
		symphonia::core::formats::SeekMode::Accurate,
		symphonia::core::formats::SeekTo::Time {
			time: symphonia::core::units::Time::new(seek_secs as u64, seek_secs - (seek_secs as u64) as f64),
			track_id: None,
		}
	).map_err(|e| {
		AudioError::DecodingError(format!("seek failed: {:?}", e))
	})?;

	Ok(())
}
