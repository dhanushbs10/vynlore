use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder as SymphoniaDecoder, DecoderOptions};
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::{get_codecs, get_probe};

use crate::error::AudioError;

pub struct AudioFileDecoder {
	format: Box<dyn FormatReader>,
	decoder: Box<dyn SymphoniaDecoder>,
	track_id: u32,
	sample_buf: Option<SampleBuffer<f32>>,
}

#[derive(Debug, Clone)]
pub struct AudioFormat {
	pub sample_rate: u32,
	pub channels: u16,
	pub bit_depth: u16,
}

pub fn open_audio(path: &std::path::Path) -> Result<(AudioFileDecoder, AudioFormat), AudioError> {
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
	let bit_depth = params.bits_per_sample.unwrap_or(16) as u16;

	let decoder = get_codecs()
		.make(&params, &DecoderOptions::default())
		.map_err(|e| AudioError::DecodingError(e.to_string()))?;

	Ok((
		AudioFileDecoder {
			format,
			decoder,
			track_id,
			sample_buf: None,
		},
		AudioFormat {
			sample_rate,
			channels,
			bit_depth,
		},
	))
}

pub fn decode_packet(decoder: &mut AudioFileDecoder) -> Option<Vec<f32>> {
	const MAX_SKIP_ITERATIONS: usize = 10000;
	let mut skipped = 0usize;
	loop {
		let packet = match decoder.format.next_packet() {
			Ok(p) => p,
			Err(_) => return None,
		};

		if packet.track_id() != decoder.track_id {
			skipped += 1;
			if skipped >= MAX_SKIP_ITERATIONS {
				return None;
			}
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
					return Some(sample_buf.samples().to_vec());
				}
			}
			Err(_) => continue,
		}
	}
}

pub fn seek(decoder: &mut AudioFileDecoder, seek_secs: f64) -> Result<(), AudioError> {
	decoder.sample_buf = None;
	let whole = seek_secs.floor();
	let frac = seek_secs - whole;

	decoder.format.seek(
		symphonia::core::formats::SeekMode::Accurate,
		symphonia::core::formats::SeekTo::Time {
			time: symphonia::core::units::Time::new(whole as u64, frac),
			track_id: None,
		},
	).map_err(|e| {
		AudioError::DecodingError(format!("seek failed: {:?}", e))
	})?;

	Ok(())
}
