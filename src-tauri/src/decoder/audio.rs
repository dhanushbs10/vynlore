use symphonia::core::audio::{SampleBuffer, SignalSpec};
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
	sample_spec: Option<SignalSpec>,
}

#[derive(Debug, Clone)]
pub struct AudioFormat {
	pub sample_rate: u32,
	pub channels: u16,
	pub bit_depth: u16,
	/// Total audio frames when the container reports it (None for streams
	/// like raw MP3 where only decoding reveals the length).
	pub total_frames: Option<u64>,
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

	// Take the first track the codec registry can actually decode, not
	// blindly tracks()[0]: multi-stream files (MP4/MKV with a cover-art or
	// video stream first) would otherwise decode the wrong stream or fail.
	let mut chosen: Option<(u32, symphonia::core::codecs::CodecParameters, Box<dyn SymphoniaDecoder>)> = None;
	for track in format.tracks() {
		let params = track.codec_params.clone();
		match get_codecs().make(&params, &DecoderOptions::default()) {
			Ok(decoder) => {
				chosen = Some((track.id, params, decoder));
				break;
			}
			Err(_) => continue,
		}
	}
	let (track_id, params, decoder) =
		chosen.ok_or_else(|| AudioError::DecodingError("No decodable audio track found".to_string()))?;

	let sample_rate = params.sample_rate.unwrap_or(44100);
	let channels = params.channels.map_or(2, |c| c.count() as u16);
	let bit_depth = params.bits_per_sample.unwrap_or(16) as u16;
	let total_frames = params.n_frames;

	Ok((
		AudioFileDecoder {
			format,
			decoder,
			track_id,
			sample_buf: None,
			sample_spec: None,
		},
		AudioFormat {
			sample_rate,
			channels,
			bit_depth,
			total_frames,
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
				let spec = *audio_buf_ref.spec();
				// (Re)allocate the reusable interleave buffer whenever the
				// decoded packet needs more room than the current one — a
				// SampleBuffer sized from the first packet silently truncates
				// later, larger packets (audible ticks/static on some files).
				// A mid-stream spec change (channels/rate) also forces a fresh
				// buffer so the interleave copy can't mismatch.
				let needs = audio_buf_ref.frames() as u64;
				let spec_changed = decoder.sample_spec.map_or(true, |s| s != spec);
				match decoder.sample_buf.as_ref() {
					Some(existing) if !spec_changed && existing.capacity() as u64 >= needs => {}
					_ => {
						decoder.sample_buf = Some(SampleBuffer::<f32>::new(needs, spec));
						decoder.sample_spec = Some(spec);
					}
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
	decoder.sample_spec = None;
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
