use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use rubato::{
	calculate_cutoff, Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType,
	WindowFunction,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use cpal::traits::HostTrait;

use crate::audio::config::AudioConfig;
use crate::audio::dsp::SpeedDsp;
use crate::audio::output::{self, AudioOutput};
use crate::audio::queue::SampleQueue;
use crate::decoder::audio::{self, AudioFileDecoder, AudioFormat};

const CHUNK_IN_FRAMES: usize = 1024;
const SINC_LEN: usize = 256;

#[derive(Clone, Serialize)]
pub struct TrackChangedPayload {
	pub path: String,
}

pub struct ControlBlock {
	pub paused: AtomicBool,
	pub stop: AtomicBool,
	pub ended_emitted: AtomicBool,
	pub seek_to: Mutex<Option<f64>>,
	pub output_rate: u32,
	pub output_channels: u16,
	pub underruns: AtomicU64,

	// Frame accounting (all in OUTPUT-rate frames):
	//   frames_played     - consumed by the realtime callback, monotonic
	//   track_start_frame - frames_played value where the current track's t=0 lands
	//   frames_pushed     - produced by the decoder thread, monotonic
	// Position of current track = (played - start) / rate. A negative start offset
	// covers initial seeks before any audio has been consumed.
	pub frames_played: AtomicI64,
	pub track_start_frame: AtomicI64,
	pub frames_pushed: AtomicU64,

	// Gapless chaining: when the callback has consumed up to a boundary count,
	// playback has audibly crossed into the next queued file.
	pub boundaries: Mutex<VecDeque<i64>>,
	pub has_boundary: AtomicBool,
	pub pending_change: AtomicBool,

	pub next_file: Mutex<Option<PathBuf>>,
	pub current_file: Mutex<PathBuf>,

	// ReplayGain applied in the decode pump (pre-EQ). `replaygain` is the live
	// gain for the current file; `pending_rg_gain` is pre-armed by the frontend
	// when it queues the next track and is swapped in at the gapless boundary.
	pub replaygain: Arc<AtomicU32>,
	pub pending_rg_gain: Arc<AtomicU32>,

	// Live tempo (1.0 = unchanged) and pitch (0 semitones = unchanged) controls.
	// `playback_rate` also scales position accounting to keep the UI in
	// track-time while the output runs at real-time.
	pub playback_rate: Arc<AtomicU32>,
	pub pitch_semitones: Arc<AtomicU32>,

	// Crossfade length in seconds (0 = off). The RT callback fades the outgoing
	// track out over this window before each gapless boundary and fades the
	// incoming track in over the same window after it. `last_crossed` records
	// the boundary position most recently crossed for the fade-in ramp.
	pub crossfade_secs: Arc<AtomicU32>,
	pub last_crossed: AtomicI64,
}

impl ControlBlock {
	fn boundaries_lock(&self) -> std::sync::MutexGuard<'_, VecDeque<i64>> {
		self.boundaries.lock().unwrap_or_else(|e| e.into_inner())
	}

	/// Drops gapless/crossfade boundary state. Seeks must call this: old
	/// markers belong to the pre-seek timeline and would otherwise mis-fire
	/// fades, phantom track-changed events and position jumps.
	pub fn clear_boundaries(&self) {
		self.boundaries_lock().clear();
		self.has_boundary.store(false, Ordering::Relaxed);
		self.last_crossed.store(i64::MIN, Ordering::Relaxed);
	}

	pub fn position_secs(&self) -> f64 {
		let played = self.frames_played.load(Ordering::SeqCst);
		let start = self.track_start_frame.load(Ordering::SeqCst);
		let delta = played.saturating_sub(start) as f64;
		let tempo = f32::from_bits(self.playback_rate.load(Ordering::Relaxed)) as f64;
		delta / self.output_rate as f64 * tempo
	}

	/// Shared by both output backends: advances consumption accounting and
	/// flips the audible track position when a gapless boundary is crossed.
	pub fn consume_frames(&self, frames: i64) {
		if frames <= 0 {
			return;
		}
		let prev = self.frames_played.fetch_add(frames, Ordering::AcqRel);
		let played = prev + frames;

		if !self.has_boundary.load(Ordering::Relaxed) {
			return;
		}
		let mut boundaries = self.boundaries_lock();
		let mut crossed = false;
		while let Some(front) = boundaries.front().copied() {
			if played >= front {
				boundaries.pop_front();
				self.track_start_frame.store(front, Ordering::Relaxed);
				self.last_crossed.store(front, Ordering::Relaxed);
				crossed = true;
			} else {
				break;
			}
		}
		if boundaries.is_empty() {
			self.has_boundary.store(false, Ordering::Relaxed);
		}
		drop(boundaries);
		if crossed {
			self.pending_change.store(true, Ordering::Release);
		}
	}

	/// Applies the crossfade gain envelope to an interleaved block whose first
	/// frame is `start_frame` in output-rate frames. The outgoing track fades to
	/// zero over the crossfade window immediately before its boundary; the
	/// incoming track ramps back up over the window immediately after. No-op
	/// when crossfade is disabled, so default playback is untouched.
	pub fn apply_crossfade(&self, buf: &mut [f32], start_frame: i64, channels: usize) {
		let secs = f32::from_bits(self.crossfade_secs.load(Ordering::Relaxed));
		if secs <= 0.0 {
			return;
		}
		let ch = channels.max(1);
		let rate = self.output_rate as i64;
		if rate <= 0 {
			return;
		}
		let window = (secs as i64 * rate).max(1);
		let next_boundary = self.boundaries_lock().front().copied();
		let last_crossed = self.last_crossed.load(Ordering::Relaxed);
		if next_boundary.is_none() && last_crossed == i64::MIN {
			return;
		}
		for (f, frame) in buf.chunks_exact_mut(ch).enumerate() {
			let played = start_frame + f as i64;
			let mut gain = 1.0f32;
			if let Some(b) = next_boundary {
				let dist = b - played;
				if dist > 0 && dist <= window {
					gain *= dist as f32 / window as f32;
				}
			}
			if last_crossed != i64::MIN {
				let since = played - last_crossed;
				if since >= 0 && since < window {
					gain *= since as f32 / window as f32;
				}
			}
			if gain < 1.0 {
				for s in frame.iter_mut() {
					*s *= gain;
				}
			}
		}
	}
}

// Variants hold the live output streams purely for their lifetime and Drop
// side effects (stopping audio); their contents are never read directly.
#[allow(dead_code)]
enum Backend {
	Cpal(AudioOutput),
	#[cfg(windows)]
	Wasapi(crate::audio::wasapi::WasapiStream),
}

pub struct PlaybackHandle {
	pub control: Arc<ControlBlock>,
	queue: Arc<SampleQueue>,
	backend: Option<Backend>,
	decode_handle: Option<JoinHandle<()>>,
}

// SAFETY: cpal::Stream is internally synchronized but lacks Send/Sync impls on some
// platforms. The stream is only ever created, held, and dropped here; the audio
// callback is invoked by the OS on its own thread and touches only the ControlBlock
// (atomics/mutexes) and SampleQueue (mutex), both of which are Sync.
unsafe impl Send for PlaybackHandle {}
unsafe impl Sync for PlaybackHandle {}

impl PlaybackHandle {
	pub fn request_stop(&self) {
		self.control.stop.store(true, Ordering::SeqCst);
		self.queue.close();
	}

	pub fn request_seek(&self, secs: f64) {
		let rate = self.control.output_rate as f64;
		let tempo = f32::from_bits(self.control.playback_rate.load(Ordering::Relaxed)) as f64;
		let played = self.control.frames_played.load(Ordering::Relaxed);
		self.control
			.track_start_frame
			.store(played - (secs * rate / tempo) as i64, Ordering::Relaxed);
		*self.control.seek_to.lock().unwrap_or_else(|e| e.into_inner()) = Some(secs);
		self.control.clear_boundaries();
		self.queue.clear();
	}

	/// Arms gapless continuation. Pass `None` to disarm (e.g. repeat-one).
	pub fn set_next(&self, path: Option<PathBuf>) {
		*self.control.next_file.lock().unwrap_or_else(|e| e.into_inner()) = path;
	}

	pub fn set_next_rg_gain(&self, gain_bits: u32) {
		self.control.pending_rg_gain.store(gain_bits, Ordering::Relaxed);
	}
}

impl Drop for PlaybackHandle {
	fn drop(&mut self) {
		self.request_stop();
		self.backend.take();
		if let Some(h) = self.decode_handle.take() {
			let _ = h.join();
		}
	}
}

/// Resolves the requested device (falling back to default when the persisted
/// index is stale) and picks the best shared-mode config for `channels`.
fn setup_shared_output(
	device_index: Option<usize>,
	channels: u16,
) -> Result<(cpal::Device, cpal::StreamConfig), String> {
	let mut device_opt = None;
	if let Some(idx) = device_index.filter(|i| *i > 0) {
		match crate::audio::output::select_device_by_number(idx) {
			Ok(d) => device_opt = Some(d),
			Err(e) => eprintln!("device {} unavailable ({}), using default", idx, e),
		}
	}
	if device_opt.is_none() {
		device_opt = cpal::default_host().default_output_device();
	}
	let device = device_opt.ok_or_else(|| "No default output device found".to_string())?;

	let config = output::find_best_config(&device, channels).map_err(|e| e.to_string())?;
	let stream_config = AudioConfig {
		sample_rate: config.sample_rate().0,
		channels: config.channels(),
	}
	.to_stream_config();

	Ok((device, stream_config))
}

pub fn start(
	path: &Path,
	device_index: Option<usize>,
	exclusive: bool,
	volume_bits: Arc<std::sync::atomic::AtomicU32>,
	eq: crate::audio::eq::SharedEq,
	spectrum: Arc<crate::audio::spectrum::SpectrumAnalyzer>,
	balance: Arc<AtomicU32>,
	preamp: Arc<AtomicU32>,
	replaygain_gain: f32,
	app: AppHandle,
	initial_seek: f64,
	playback_rate: Arc<AtomicU32>,
	pitch_semitones: Arc<AtomicU32>,
	crossfade_secs: Arc<AtomicU32>,
) -> Result<(PlaybackHandle, bool), String> {
	let (decoder, format) = audio::open_audio(path).map_err(|e| e.to_string())?;

	// Exclusive mode keeps the file's native rate/channels end to end:
	// no mixer, no resampler. Probe first so an unsupported format quietly
	// falls back instead of failing playback.
	#[cfg(windows)]
	let mut use_exclusive = false;
	#[cfg(windows)]
	if exclusive {
		let target = crate::audio::wasapi::TargetFormat {
			sample_rate: format.sample_rate,
			channels: format.channels,
			valid_bits: format.bit_depth,
		};
		match crate::audio::wasapi::probe_exclusive(device_index, target) {
			Ok(()) => use_exclusive = true,
			Err(e) => eprintln!("exclusive unavailable, using shared mode: {}", e),
		}
	}
	#[cfg(not(windows))]
	let use_exclusive = false;

	// Shared-mode output setup (skipped entirely on the exclusive path).
	let shared = if use_exclusive {
		None
	} else {
		Some(setup_shared_output(device_index, format.channels)?)
	};

	let (out_rate, out_channels) = match shared.as_ref() {
		Some((_, cfg)) => (cfg.sample_rate.0, cfg.channels),
		None => (format.sample_rate, format.channels),
	};

	let queue = Arc::new(SampleQueue::new(
		out_rate as usize * out_channels as usize * 4,
	));

	let file_bit_depth = format.bit_depth;
	let replaygain = Arc::new(AtomicU32::new(replaygain_gain.clamp(0.0, 4.0).to_bits()));
	let pending_rg = Arc::new(AtomicU32::new(1.0f32.to_bits()));
	let mut pipeline = Pipeline::new(
		decoder,
		format,
		out_rate,
		eq.clone(),
		preamp.clone(),
		replaygain.clone(),
		playback_rate.clone(),
		pitch_semitones.clone(),
	)?;
	if initial_seek > 0.0 {
		pipeline.seek(initial_seek);
	}

	let tempo = f32::from_bits(playback_rate.load(Ordering::Relaxed)) as f64;
	let start_offset_frames = if initial_seek > 0.0 {
		-((initial_seek * out_rate as f64 / tempo) as i64)
	} else {
		0
	};

	let control = Arc::new(ControlBlock {
		paused: AtomicBool::new(false),
		stop: AtomicBool::new(false),
		ended_emitted: AtomicBool::new(false),
		seek_to: Mutex::new(None),
		output_rate: out_rate,
		output_channels: out_channels,
		underruns: AtomicU64::new(0),
		frames_played: AtomicI64::new(0),
		track_start_frame: AtomicI64::new(start_offset_frames),
		frames_pushed: AtomicU64::new(0),
		boundaries: Mutex::new(VecDeque::new()),
		has_boundary: AtomicBool::new(false),
		pending_change: AtomicBool::new(false),
		next_file: Mutex::new(None),
		current_file: Mutex::new(path.to_path_buf()),
		replaygain: replaygain.clone(),
		pending_rg_gain: pending_rg,
		playback_rate: playback_rate.clone(),
		pitch_semitones: pitch_semitones.clone(),
		crossfade_secs: crossfade_secs.clone(),
		last_crossed: AtomicI64::new(i64::MIN),
	});

	// Backend opens BEFORE the decode thread spawns so a failed open can't
	// strand a pusher blocked on a queue nobody drains.
	let backend = if use_exclusive {
		#[cfg(windows)]
		{
			let target = crate::audio::wasapi::TargetFormat {
				sample_rate: out_rate,
				channels: out_channels,
				valid_bits: file_bit_depth,
			};
			match crate::audio::wasapi::open_exclusive(
				device_index,
				target,
				queue.clone(),
				control.clone(),
				volume_bits.clone(),
				spectrum.clone(),
				balance.clone(),
			) {
				Ok(s) => Backend::Wasapi(s),
				Err(e) => return Err(format!("exclusive init failed: {}", e)),
			}
		}
		#[cfg(not(windows))]
		{
			let _ = exclusive;
			return Err("exclusive mode is only available on Windows".into());
		}
	} else {
		let (device, stream_config) = match shared.as_ref() {
			Some(s) => s,
			None => return Err("shared audio device setup must be initialized before starting shared backend".into()),
		};
		let cb_control = control.clone();
		let cb_queue = queue.clone();
		let cb_volume = volume_bits.clone();
		let cb_balance = balance.clone();
		let cb_spectrum = spectrum.clone();
		cb_spectrum.set_channels(control.output_channels.max(1) as usize);
		let audio_output = AudioOutput::start(stream_config, device, move |out_buf| {
			if cb_control.paused.load(Ordering::Relaxed) {
				out_buf.fill(0.0);
				return;
			}
			let written = cb_queue.pop_available(out_buf);
			if written < out_buf.len() {
				out_buf[written..].fill(0.0);
				cb_control.underruns.fetch_add(1, Ordering::Relaxed);
			}
			if written > 0 {
				let start_frame = cb_control.frames_played.load(Ordering::Relaxed);
				let ch_count = cb_control.output_channels.max(1) as usize;
				// Consume first so a boundary crossed by this exact block is
				// already registered when the fade envelope is computed —
				// otherwise the first post-boundary buffer misses its fade-in.
				// written counts interleaved SAMPLES; consume_frames wants frames.
				cb_control.consume_frames((written / ch_count) as i64);
				cb_control.apply_crossfade(&mut out_buf[..written], start_frame, ch_count);
				let vol = f32::from_bits(cb_volume.load(Ordering::Relaxed));
				for sample in out_buf[..written].iter_mut() {
					*sample *= vol;
				}
				let bal = f32::from_bits(cb_balance.load(Ordering::Relaxed));
				if bal.abs() > 0.01 {
					let left_gain = if bal <= 0.0 { 1.0 } else { 1.0 - bal };
					let right_gain = if bal >= 0.0 { 1.0 } else { 1.0 + bal };
					for frame in out_buf[..written].chunks_exact_mut(ch_count) {
						if ch_count >= 1 { frame[0] *= left_gain; }
						if ch_count >= 2 { frame[1] *= right_gain; }
					}
				}
				cb_spectrum.push_samples(&out_buf[..written]);
			}
		})
		.map_err(|e| e.to_string())?;
		Backend::Cpal(audio_output)
	};

	let thread_control = control.clone();
	let thread_queue = queue.clone();
	let thread_preamp = preamp.clone();
	let decode_handle = std::thread::Builder::new()
		.name("vynlore-decode".into())
		.spawn(move || {
			// The RT callback runs at WASAPI-boosted priority on Windows; keep
			// the producer ahead of it instead of losing to random system load
			// (the queue backpressure bounds how much we can outpace the device).
			#[cfg(windows)]
			{
				let _ = unsafe {
					windows::Win32::System::Threading::SetThreadPriority(
						windows::Win32::System::Threading::GetCurrentThread(),
						windows::Win32::System::Threading::THREAD_PRIORITY_ABOVE_NORMAL,
					)
				};
			}
			run_decoder(pipeline, thread_control, thread_queue, eq, thread_preamp, app);
		})
		.map_err(|e| format!("failed to spawn decode thread: {}", e))?;

	Ok((
		PlaybackHandle {
			control,
			queue,
			backend: Some(backend),
			decode_handle: Some(decode_handle),
		},
		use_exclusive,
	))
}

fn interleave(channels: &[Vec<f32>], frames: usize, scratch: &mut Vec<f32>) {
	scratch.clear();
	scratch.reserve(frames * channels.len());
	for frame in 0..frames {
		for ch in channels.iter() {
			scratch.push(ch[frame]);
		}
	}
}

/// Per-file decode state. Swapping one of these (instead of restarting threads
/// and streams) is what makes track transitions gapless.
struct Pipeline {
	decoder: AudioFileDecoder,
	format: AudioFormat,
	resampler: Option<SincFixedIn<f32>>,
	pending: Vec<f32>,
	processed: Vec<f32>,
	scratch: Vec<f32>,
	speed: SpeedDsp,
	eq: crate::audio::eq::EqProcessor,
	preamp: Arc<AtomicU32>,
	replaygain: Arc<AtomicU32>,
	rate: Arc<AtomicU32>,
	semitones: Arc<AtomicU32>,
	eof: bool,
	tail_flushed: bool,
}

enum Pushed {
	Frames(u64),
	Closed,
}

impl Pipeline {
	fn new(
		decoder: AudioFileDecoder,
		format: AudioFormat,
		out_rate: u32,
		eq: crate::audio::eq::SharedEq,
		preamp: Arc<AtomicU32>,
		replaygain: Arc<AtomicU32>,
		rate: Arc<AtomicU32>,
		semitones: Arc<AtomicU32>,
	) -> Result<Self, String> {
		let resampler = if format.sample_rate != out_rate {
			let ratio = out_rate as f64 / format.sample_rate as f64;
			// A fixed 256-tap sinc needs ~sinc_len/ratio taps per output
			// sample: at 176.4k -> 48k that's ~940, which can't keep realtime
			// (measured: >4x slower than needed). Scale the window to the
			// conversion depth — close ratios keep full quality, deep ones use
			// a shorter window whose effective span is still hundreds of taps
			// after the ratio expansion (rubato rounds up to a multiple of 8).
			let distance = (ratio - 1.0).abs();
			let sinc_len = if distance <= 0.25 {
				SINC_LEN
			} else if distance <= 0.6 {
				128
			} else {
				64
			};
			let params = SincInterpolationParameters {
				sinc_len,
				f_cutoff: calculate_cutoff(sinc_len, WindowFunction::BlackmanHarris2),
				interpolation: SincInterpolationType::Cubic,
				oversampling_factor: 256,
				window: WindowFunction::BlackmanHarris2,
			};
			Some(
				SincFixedIn::<f32>::new(ratio, 1.0, params, CHUNK_IN_FRAMES, format.channels as usize)
					.map_err(|e| format!("resampler init failed: {}", e))?,
			)
		} else {
			None
		};
		let eq_processor =
			crate::audio::eq::EqProcessor::new(eq, out_rate, format.channels as usize);
		let speed = SpeedDsp::new(format.sample_rate, format.channels as usize);
		Ok(Self {
			decoder,
			format,
			resampler,
			pending: Vec::new(),
			processed: Vec::new(),
			scratch: Vec::new(),
			speed,
			eq: eq_processor,
			preamp,
			replaygain,
			rate,
			semitones,
			eof: false,
			tail_flushed: false,
		})
	}

	fn seek(&mut self, secs: f64) {
		match audio::seek(&mut self.decoder, secs) {
			Ok(()) => {
				self.pending.clear();
				self.processed.clear();
				self.eof = false;
				self.tail_flushed = false;
				if let Some(r) = self.resampler.as_mut() {
					r.reset();
				}
				self.speed.reset();
				self.eq.reset();
			}
			Err(e) => eprintln!("seek failed: {}", e),
		}
	}

	/// Routes decoded frames through the tempo/pitch stage into `processed`,
	/// which is then consumed by the resampler (or pushed directly). Bypasses
	/// cheaply with an exact passthrough when both controls are neutral.
	fn forward(&mut self) {
		if self.pending.is_empty() {
			return;
		}
		let data = std::mem::take(&mut self.pending);
		let tempo = f32::from_bits(self.rate.load(Ordering::Relaxed));
		let semi = f32::from_bits(self.semitones.load(Ordering::Relaxed));
		self.speed.process(&data, tempo, semi, &mut self.processed);
	}

	fn refill(&mut self) {
		let ch = self.format.channels as usize;
		while !self.eof && self.pending.len() < CHUNK_IN_FRAMES * ch * 4 {
			match audio::decode_packet(&mut self.decoder) {
				Some(samples) => self.pending.extend_from_slice(&samples),
				None => self.eof = true,
			}
		}
	}

	#[inline]
	fn total_gain(&self) -> f32 {
		let preamp = f32::from_bits(self.preamp.load(Ordering::Relaxed));
		let rg = f32::from_bits(self.replaygain.load(Ordering::Relaxed));
		(preamp * rg).max(0.0)
	}

	fn pump(&mut self, queue: &SampleQueue) -> Pushed {
		self.forward();
		let ch = self.format.channels as usize;
		let available_frames = self.processed.len() / ch;
		let preamp_gain = self.total_gain();

		match self.resampler.as_mut() {
			Some(r) => {
				if available_frames >= CHUNK_IN_FRAMES {
					let mut in_bufs: Vec<Vec<f32>> = (0..ch)
						.map(|_| Vec::with_capacity(CHUNK_IN_FRAMES))
						.collect();
					for frame in 0..CHUNK_IN_FRAMES {
						for c in 0..ch {
							in_bufs[c].push(self.processed[frame * ch + c]);
						}
					}
					self.processed.drain(..CHUNK_IN_FRAMES * ch);
					match r.process(&in_bufs, None) {
						Ok(out) => {
							let out_frames = out.first().map_or(0, |c| c.len());
							interleave(&out, out_frames, &mut self.scratch);
							apply_gain(preamp_gain, &mut self.scratch);
							self.eq.process_interleaved(&mut self.scratch);
							if queue.push_all(&self.scratch) {
								Pushed::Frames(out_frames as u64)
							} else {
								Pushed::Closed
							}
						}
						Err(e) => {
							eprintln!("resample error: {}", e);
							Pushed::Frames(0)
						}
					}
				} else {
					Pushed::Frames(0)
				}
			}
			None => {
				if !self.processed.is_empty() {
					let mut data = std::mem::take(&mut self.processed);
					let frames = data.len() / ch;
					apply_gain(preamp_gain, &mut data);
					self.eq.process_interleaved(&mut data);
					if queue.push_all(&data) {
						Pushed::Frames(frames as u64)
					} else {
						Pushed::Closed
					}
				} else {
					Pushed::Frames(0)
				}
			}
		}
	}

	/// At EOF: pushes every remaining sample including the resampler's internal
	/// tail so the last samples of a file are never dropped.
	fn flush_tail(&mut self, queue: &SampleQueue) -> Pushed {
		if self.tail_flushed {
			return Pushed::Frames(0);
		}
		// Move the final decoded frames through the tempo/pitch stage, flush the
		// WSOLA overlap tail, and pad the vocoder so nothing buffered is dropped.
		self.forward();
		self.speed.flush(&mut self.processed);
		let ch = self.format.channels as usize;
		let available_frames = self.processed.len() / ch;
		let mut total: u64 = 0;
		let preamp_gain = self.total_gain();

		if let Some(r) = self.resampler.as_mut() {
			// Feed the tail in full chunks (same pattern as pump) followed by
			// the sub-chunk remainder, then one zero-padded drain call to emit
			// the sinc lookback tail. SincFixedIn only reads chunk_size input
			// frames per call, so over-large partials silently drop audio.
			let mut offset = 0;
			while available_frames.saturating_sub(offset) >= CHUNK_IN_FRAMES {
				let mut in_bufs: Vec<Vec<f32>> = (0..ch)
					.map(|_| Vec::with_capacity(CHUNK_IN_FRAMES))
					.collect();
				for frame in 0..CHUNK_IN_FRAMES {
					for c in 0..ch {
						in_bufs[c].push(self.processed[(offset + frame) * ch + c]);
					}
				}
				match r.process(&in_bufs, None) {
					Ok(out) => {
						let out_frames = out.first().map_or(0, |c| c.len());
						if !push_resampled(
							&out,
							out_frames,
							&mut self.scratch,
							&mut self.eq,
							queue,
							preamp_gain,
						) {
							self.tail_flushed = true;
							return Pushed::Closed;
						}
						total += out_frames as u64;
					}
					Err(e) => {
						eprintln!("final resample error: {}", e);
						break;
					}
				}
				offset += CHUNK_IN_FRAMES;
			}
			if offset < available_frames {
				let rem = available_frames - offset;
				let mut in_bufs: Vec<Vec<f32>> =
					(0..ch).map(|_| Vec::with_capacity(rem)).collect();
				for frame in 0..rem {
					for c in 0..ch {
						in_bufs[c].push(self.processed[(offset + frame) * ch + c]);
					}
				}
				match r.process_partial(Some(&in_bufs), None) {
					Ok(out) => {
						let out_frames = out.first().map_or(0, |c| c.len());
						if !push_resampled(
							&out,
							out_frames,
							&mut self.scratch,
							&mut self.eq,
							queue,
							preamp_gain,
						) {
							self.tail_flushed = true;
							return Pushed::Closed;
						}
						total += out_frames as u64;
					}
					Err(e) => eprintln!("final resample error: {}", e),
				}
			}
			self.processed.clear();
			// One zero-padded drain call emits the sinc lookback tail; further
			// calls would only loop producing silence forever.
			match r.process_partial::<Vec<f32>>(None, None) {
				Ok(out) => {
					let out_frames = out.first().map_or(0, |c| c.len());
					if out_frames > 0
						&& !push_resampled(
							&out,
							out_frames,
							&mut self.scratch,
							&mut self.eq,
							queue,
							preamp_gain,
						)
					{
						self.tail_flushed = true;
						return Pushed::Closed;
					}
					total += out_frames as u64;
				}
				Err(_) => {}
			}
		} else if !self.processed.is_empty() {
			let mut data = std::mem::take(&mut self.processed);
			let frames = data.len() / ch;
			apply_gain(preamp_gain, &mut data);
			self.eq.process_interleaved(&mut data);
			if !queue.push_all(&data) {
				self.tail_flushed = true;
				return Pushed::Closed;
			}
			total += frames as u64;
		}
		self.tail_flushed = true;
		Pushed::Frames(total)
	}
}

/// Interleaves `out_frames` frames of `out` (deinterleaved per channel),
/// applies gain and EQ, and pushes to the queue. Returns false (queue
/// closed) if `push_all` rejected the block.
fn push_resampled(
	out: &[Vec<f32>],
	out_frames: usize,
	scratch: &mut Vec<f32>,
	eq: &mut crate::audio::eq::EqProcessor,
	queue: &SampleQueue,
	gain: f32,
) -> bool {
	interleave(out, out_frames, scratch);
	apply_gain(gain, scratch);
	eq.process_interleaved(scratch);
	queue.push_all(scratch)
}

fn apply_gain(gain: f32, data: &mut [f32]) {
	let g = gain.max(0.0);
	if (g - 1.0).abs() > 1e-6 {
		for sample in data.iter_mut() {
			*sample *= g;
		}
	}
}

enum ChainResult {
	Chained(Box<Pipeline>),
	Incompatible,
	NoneQueued,
}

fn try_chain(control: &Arc<ControlBlock>, out_rate: u32, eq: crate::audio::eq::SharedEq, preamp: Arc<AtomicU32>) -> ChainResult {
	let next = control.next_file.lock().unwrap_or_else(|e| e.into_inner()).take();
	let Some(next_path) = next else {
		return ChainResult::NoneQueued;
	};
	match audio::open_audio(&next_path) {
		Ok((decoder, format)) if format.channels == control.output_channels => {
			// Everything pushed from here on belongs to the next file. The RT
			// callback compares consumption against this marker and flips the
			// audible position exactly when the new audio starts.
			let mark = control.frames_pushed.load(Ordering::Relaxed) as i64;
            control.boundaries_lock().push_back(mark);
			control.has_boundary.store(true, Ordering::Relaxed);
			*control.current_file.lock().unwrap_or_else(|e| e.into_inner()) = next_path;
			// Swap the pre-armed ReplayGain for this file into the live slot so
			// the first pump of the new file already uses the right loudness.
			control
				.replaygain
				.store(control.pending_rg_gain.load(Ordering::Relaxed), Ordering::Relaxed);
			match Pipeline::new(
				decoder,
				format,
				out_rate,
				eq,
				preamp,
				control.replaygain.clone(),
				control.playback_rate.clone(),
				control.pitch_semitones.clone(),
			) {
				Ok(p) => ChainResult::Chained(Box::new(p)),
				Err(e) => {
					eprintln!("gapless chain failed: {}", e);
					ChainResult::Incompatible
				}
			}
		}
		Ok(_) => {
			// Channel layout differs; a seamless splice isn't possible. Report
			// normal end-of-track so the frontend restarts with a fresh config.
			ChainResult::Incompatible
		}
		Err(e) => {
			eprintln!("failed to open queued next track: {}", e);
			ChainResult::Incompatible
		}
	}
}

fn run_decoder(
	mut pipeline: Pipeline,
	control: Arc<ControlBlock>,
	queue: Arc<SampleQueue>,
	eq: crate::audio::eq::SharedEq,
	preamp: Arc<AtomicU32>,
	app: AppHandle,
) {
	let out_rate = control.output_rate;

	const STALL_POLL: Duration = Duration::from_millis(10);
	const STALL_WARN_AFTER: Duration = Duration::from_secs(2);
	const STALL_WARN_COOLDOWN: Duration = Duration::from_secs(10);
	let mut idle_dur = Duration::ZERO;
	let mut last_warn = std::time::Instant::now();

	'outer: loop {
		if control.stop.load(Ordering::SeqCst) {
			break;
		}

		// The RT callback flags when playback audibly crossed into the chained
		// file; sync the UI from here, safely off the realtime thread.
		if control.pending_change.swap(false, Ordering::Relaxed) {
			let path = control.current_file.lock().unwrap_or_else(|e| e.into_inner()).display().to_string();
			let _ = app.emit("track-changed", TrackChangedPayload { path });
		}

		if let Some(t) = control.seek_to.lock().unwrap_or_else(|e| e.into_inner()).take() {
			control.clear_boundaries();
			pipeline.seek(t);
		}

		let produced_before = control.frames_pushed.load(Ordering::Relaxed);

		if !pipeline.eof {
			pipeline.refill();
		}

		if pipeline.eof && !pipeline.tail_flushed {
			match pipeline.flush_tail(&queue) {
				Pushed::Frames(n) => {
					control.frames_pushed.fetch_add(n, Ordering::Relaxed);
				}
				Pushed::Closed => break 'outer,
			}
		}

		match pipeline.pump(&queue) {
			Pushed::Frames(n) => {
				control.frames_pushed.fetch_add(n, Ordering::Relaxed);
			}
			Pushed::Closed => break 'outer,
		}

		// ── Watchdog ──────────────────────────────────────────────────────
		// If an iteration produced no frames while actively decoding, the
		// decoder is stalled (cold disk, blocked read, a corrupt region). Sleep
		// instead of spinning a core to death, and surface the stall instead of
		// letting audio silently gap.
		let produced = control.frames_pushed.load(Ordering::Relaxed) - produced_before;
		if produced > 0 {
			idle_dur = Duration::ZERO;
		} else if !pipeline.eof {
			idle_dur += STALL_POLL;
			std::thread::sleep(STALL_POLL);
			if idle_dur >= STALL_WARN_AFTER && last_warn.elapsed() >= STALL_WARN_COOLDOWN {
				let path = control.current_file.lock().unwrap_or_else(|e| e.into_inner()).display().to_string();
				eprintln!("[watchdog] decoder stalled >2s playing {:?}", path);
				last_warn = std::time::Instant::now();
				idle_dur = Duration::ZERO;
			}
		}

		if pipeline.eof && pipeline.tail_flushed {
			// Fast path: a next track was armed before we got here — splice
			// immediately, no drain wait needed (FIFO order preserves audio
			// continuity; the boundary marker handles position/UI switching).
			match try_chain(&control, out_rate, eq.clone(), preamp.clone()) {
				ChainResult::Chained(next_pipeline) => {
					pipeline = *next_pipeline;
					continue 'outer;
				}
				ChainResult::Incompatible | ChainResult::NoneQueued => {}
			}

			// Final track (so far): drain, but stay responsive — a next track
			// may arrive late (slow UI roundtrip), or the user may seek back.
			let mut late_chained: Option<Box<Pipeline>> = None;
			while !control.stop.load(Ordering::SeqCst) {
				if let Some(t) = control.seek_to.lock().unwrap_or_else(|e| e.into_inner()).take() {
					control.clear_boundaries();
					pipeline.seek(t);
					continue 'outer;
				}
				if control.pending_change.swap(false, Ordering::Relaxed) {
					let path = control.current_file.lock().unwrap_or_else(|e| e.into_inner()).display().to_string();
					let _ = app.emit("track-changed", TrackChangedPayload { path });
				}
				if control.next_file.lock().unwrap_or_else(|e| e.into_inner()).is_some() {
					match try_chain(&control, out_rate, eq.clone(), preamp.clone()) {
						ChainResult::Chained(p) => {
							late_chained = Some(p);
							break;
						}
						ChainResult::Incompatible => break,
						ChainResult::NoneQueued => {}
					}
				}
				if queue.is_empty() {
					break;
				}
				std::thread::sleep(Duration::from_millis(20));
			}

			if control.stop.load(Ordering::SeqCst) {
				break 'outer;
			}
			if let Some(p) = late_chained {
				pipeline = *p;
				continue 'outer;
			}
			emit_ended(&control, &app);
			break 'outer;
		}
	}
}

fn emit_ended(control: &Arc<ControlBlock>, app: &AppHandle) {
	if !control.stop.load(Ordering::SeqCst)
		&& !control.ended_emitted.swap(true, Ordering::SeqCst)
	{
		let _ = app.emit("playback-ended", ());
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn control_with_crossfade(window_secs: f32) -> Arc<ControlBlock> {
		Arc::new(ControlBlock {
			paused: AtomicBool::new(false),
			stop: AtomicBool::new(false),
			ended_emitted: AtomicBool::new(false),
			seek_to: Mutex::new(None),
			output_rate: 100,
			output_channels: 2,
			underruns: AtomicU64::new(0),
			frames_played: AtomicI64::new(0),
			track_start_frame: AtomicI64::new(0),
			frames_pushed: AtomicU64::new(0),
			boundaries: Mutex::new(VecDeque::new()),
			has_boundary: AtomicBool::new(false),
			pending_change: AtomicBool::new(false),
			next_file: Mutex::new(None),
			current_file: Mutex::new(PathBuf::from("test")),
			replaygain: Arc::new(AtomicU32::new(1.0f32.to_bits())),
			pending_rg_gain: Arc::new(AtomicU32::new(1.0f32.to_bits())),
			playback_rate: Arc::new(AtomicU32::new(1.0f32.to_bits())),
			pitch_semitones: Arc::new(AtomicU32::new(0.0f32.to_bits())),
			crossfade_secs: Arc::new(AtomicU32::new(window_secs.to_bits())),
			last_crossed: AtomicI64::new(i64::MIN),
		})
	}

	fn mono(buf: &[f32]) -> f32 {
		buf[0]
	}

	fn write_wav(path: &Path, sample_rate: u32, channels: u16, frames: usize, bits: u16, gen: impl Fn(usize, usize) -> f32) {
		let mut data: Vec<i32> = Vec::with_capacity(frames * channels as usize);
		for f in 0..frames {
			for c in 0..channels {
				let s = gen(f, c as usize).clamp(-1.0, 1.0);
				let v = if bits == 24 { (s * 8_388_607.0) as i32 } else { (s * 32_767.0) as i32 };
				data.push(v);
			}
		}
		let bytes_per_sample = (bits / 8) as u32;
		let bytes_per_frame = channels as u32 * bytes_per_sample;
		let data_len = data.len() as u32 * bytes_per_sample;
		let mut w: Vec<u8> = Vec::new();
		w.extend_from_slice(b"RIFF");
		w.extend_from_slice(&(36 + data_len).to_le_bytes());
		w.extend_from_slice(b"WAVE");
		w.extend_from_slice(b"fmt ");
		w.extend_from_slice(&16u32.to_le_bytes());
		w.extend_from_slice(&1u16.to_le_bytes());
		w.extend_from_slice(&channels.to_le_bytes());
		w.extend_from_slice(&sample_rate.to_le_bytes());
		w.extend_from_slice(&(sample_rate * bytes_per_frame).to_le_bytes());
		w.extend_from_slice(&(bytes_per_frame as u16).to_le_bytes());
		w.extend_from_slice(&bits.to_le_bytes());
		w.extend_from_slice(b"data");
		w.extend_from_slice(&data_len.to_le_bytes());
		for v in &data {
			if bits == 24 {
				let uv = *v as u32;
				w.push((uv & 0xff) as u8);
				w.push(((uv >> 8) & 0xff) as u8);
				w.push(((uv >> 16) & 0xff) as u8);
			} else {
				w.extend_from_slice(&(*v as i16).to_le_bytes());
			}
		}
		std::fs::write(path, w).expect("write wav");
	}

	fn run_pipeline(path: &Path, out_rate: u32, tempo: f32, semi: f32) -> Vec<f32> {
		let (decoder, format) = audio::open_audio(path).expect("open wav");
		let eq = crate::audio::eq::shared_eq();
		let preamp = Arc::new(AtomicU32::new(1.0f32.to_bits()));
		let rg = Arc::new(AtomicU32::new(1.0f32.to_bits()));
		let rate = Arc::new(AtomicU32::new(tempo.to_bits()));
		let semi_a = Arc::new(AtomicU32::new(semi.to_bits()));
		let mut p = Pipeline::new(
			decoder,
			format.clone(),
			out_rate,
			eq,
			preamp,
			rg,
			rate,
			semi_a,
		)
		.expect("pipeline init");
		let queue = Arc::new(SampleQueue::new(
			out_rate as usize * format.channels as usize * 4,
		));
		let mut captured = Vec::new();
		let mut scratch_buf = vec![0.0f32; out_rate as usize * 4];
		let mut iters = 0usize;
		loop {
			'inner: loop {
				iters += 1;
				if iters > 2_000_000 {
					panic!("run_pipeline did not terminate");
				}
				if !p.eof {
					p.refill();
				}
				if p.eof && !p.tail_flushed {
					match p.flush_tail(&queue) {
						Pushed::Closed => break 'inner,
						_ => {}
					}
				}
				match p.pump(&queue) {
					Pushed::Closed => break 'inner,
					_ => {}
				}
				loop {
					let got = queue.pop_available(&mut scratch_buf);
					if got == 0 {
						break;
					}
					captured.extend_from_slice(&scratch_buf[..got]);
				}
				if p.eof && p.tail_flushed {
					break 'inner;
				}
			}
			loop {
				let got = queue.pop_available(&mut scratch_buf);
				if got == 0 {
					break;
				}
				captured.extend_from_slice(&scratch_buf[..got]);
			}
			break;
		}
		captured
	}

	fn estimate_hz_drv(out: &[f32], channels: usize, sample_rate: u32, skip: usize) -> f32 {
		let from = skip * channels;
		let win = 32_000usize.min(out.len().saturating_sub(from)) / channels * channels;
		let end = from + win;
		let mut crossings = 0usize;
		let mut prev = out[from];
		for i in (from..end).step_by(channels) {
			let s = out[i];
			if (s >= 0.0) != (prev >= 0.0) {
				crossings += 1;
			}
			prev = s;
		}
		crossings as f32 / 2.0 * sample_rate as f32 / (win / channels) as f32
	}

	#[test]
	fn pipeline_decodes_stereo_tone_end_to_end() {
		let dir = std::env::temp_dir();
		let path = dir.join("vynlore_it_one.wav");
		write_wav(&path, 44_100, 2, 44_100 * 2, 16, |f, c| {
			0.35 * (2.0 * std::f32::consts::PI * 440.0 * f as f32 / 44_100.0 + 0.3 * c as f32).sin()
		});
		let out = run_pipeline(&path, 44_100, 1.0, 0.0);
		let frames = out.len() / 2;
		assert!(frames > 80_000, "frames={}", frames);
		let est = estimate_hz_drv(&out, 2, 44_100, 512);
		assert!((est - 440.0).abs() < 40.0, "est={}", est);
		let _ = std::fs::remove_file(&path);
	}

	#[test]
	fn pipeline_tempo_and_pitch_change_real_content() {
		let dir = std::env::temp_dir();
		let path = dir.join("vynlore_it_two.wav");
		write_wav(&path, 44_100, 2, 44_100 * 2, 16, |f, _| {
			0.3 * (2.0 * std::f32::consts::PI * 220.0 * f as f32 / 44_100.0).sin()
		});
		let mut out = run_pipeline(&path, 44_100, 2.0, 12.0);
		let frames = out.len() / 2;
		// 2x tempo over 2 s of audio, plus latencies.
		assert!(frames < 48_000, "frames={}", frames);
		assert!(frames > 34_000, "frames={}", frames);
		let est = estimate_hz_drv(&out, 2, 44_100, 1024);
		assert!(
			(est - 440.0).abs() < 90.0,
			"tempo 2 +12st of 220 Hz expected ~440 Hz, got {} (frames={})",
			est,
			frames
		);
		// Rewind pitch down: 220 -> 110 Hz with tempo unchanged.
		out = run_pipeline(&path, 44_100, 1.0, -12.0);
		let est2 = estimate_hz_drv(&out, 2, 44_100, 1024);
		assert!((est2 - 110.0).abs() < 35.0, "est2={}", est2);
		let _ = std::fs::remove_file(&path);
	}

	#[test]
	fn pipeline_resampler_path_produces_audio() {
		let dir = std::env::temp_dir();
		let path = dir.join("vynlore_it_three.wav");
		write_wav(&path, 44_100, 1, 44_100, 16, |f, _| {
			0.3 * (2.0 * std::f32::consts::PI * 330.0 * f as f32 / 44_100.0).sin()
		});
		let out = run_pipeline(&path, 48_000, 1.0, 0.0);
		let frames = out.len();
		let expected = 48_000usize;
		assert!(
			(frames as i64 - expected as i64).abs() < 3000,
			"resampled frames={}, expected~{}",
			frames,
			expected
		);
		let est = estimate_hz_drv(&out, 1, 48_000, 512);
		assert!((est - 330.0).abs() < 40.0, "est={}", est);
		let _ = std::fs::remove_file(&path);
	}

	#[test]
	fn pipeline_decodes_24bit_wav_audibly() {
		let dir = std::env::temp_dir();
		let path = dir.join("vynlore_it_24bit.wav");
		// 24-bit 96 kHz stereo, 1 s of 330 Hz -> decode + resampler 96k -> 48k.
		write_wav(&path, 96_000, 2, 96_000, 24, |f, c| {
			0.35 * (2.0 * std::f32::consts::PI * 330.0 * f as f32 / 96_000.0 + 0.3 * c as f32).sin()
		});
		let out = run_pipeline(&path, 48_000, 1.0, 0.0);
		let frames = out.len() / 2;
		assert!(frames > 45_000, "frames={}", frames);
		let peak = out.iter().fold(0.0f32, |a, s| a.max(s.abs()));
		assert!(peak > 0.2, "24-bit output silent, peak={}", peak);
		let est = estimate_hz_drv(&out, 2, 48_000, 512);
		assert!((est - 330.0).abs() < 60.0, "est={}", est);

		// The exact case from the field: 24-bit at 176.4 kHz (exclusive probe
		// fails -> shared mode -> deep downsample 176400 -> 48000).
		write_wav(&path, 176_400, 2, 176_400, 24, |f, c| {
			0.35 * (2.0 * std::f32::consts::PI * 330.0 * f as f32 / 176_400.0 + 0.3 * c as f32).sin()
		});
		let out = run_pipeline(&path, 48_000, 1.0, 0.0);
		let frames = out.len() / 2;
		assert!(frames > 44_000, "176.4k frames={}", frames);
		let peak = out.iter().fold(0.0f32, |a, s| a.max(s.abs()));
		assert!(peak > 0.2, "176.4k 24-bit output silent, peak={}", peak);
		let est = estimate_hz_drv(&out, 2, 48_000, 1024);
		assert!((est - 330.0).abs() < 60.0, "176.4k est={}", est);

		let _ = std::fs::remove_file(&path);
	}

	#[test]
	#[ignore = "manual realtime-cost benchmark"]
	fn bench_realtime_costs() {
		let dir = std::env::temp_dir();
		let path = dir.join("vynlore_bench.wav");
		let cases: Vec<(u32, u32, f32, f32, bool, usize)> = vec![
			// (in_rate, out_rate, tempo, semi, is_24bit, seconds)
			(44_100, 44_100, 1.0, 0.0, false, 15),
			(176_400, 48_000, 1.0, 0.0, true, 5),
			(96_000, 44_100, 1.0, 0.0, true, 10),
			(48_000, 48_000, 2.0, 0.0, false, 10),
			(48_000, 48_000, 1.0, 6.0, false, 10),
		];
		for (in_rate, out_rate, tempo, semi, b24, secs) in cases {
			let bits = if b24 { 24 } else { 16 };
			write_wav(&path, in_rate, 2, (in_rate as usize) * secs, bits, |f, c| {
				0.35 * (2.0 * std::f32::consts::PI * 220.0 * f as f32 / in_rate as f32 + 0.3 * c as f32).sin()
			});
			let t0 = std::time::Instant::now();
			let _out = run_pipeline(&path, out_rate, tempo, semi);
			let dur = t0.elapsed();
			let rt = dur.as_secs_f64() / secs as f64;
			println!(
				"[bench] in={}k out={}k tempo={} semi={} bit={}: {}s audio in {:.2}s -> x{:.2} realtime",
				in_rate / 1000,
				out_rate / 1000,
				tempo,
				semi,
				bits,
				secs,
				dur.as_secs_f64(),
				rt
			);
			let _ = std::io::Write::flush(&mut std::io::stdout());
			let _ = std::fs::remove_file(&path);
		}
		panic!("bench done");
	}

	#[test]
	fn crossfade_disabled_is_passthrough() {
		let control = control_with_crossfade(0.0);
		let mut buf = vec![0.5f32; 100];
		control.apply_crossfade(&mut buf, 0, 1);
		assert!(buf.iter().all(|s| *s == 0.5));
	}

	#[test]
	fn crossfade_fades_out_before_boundary() {
		let control = control_with_crossfade(2.0);
		control.boundaries_lock().push_back(500);
		control.has_boundary.store(true, Ordering::Relaxed);
		// Frames 350..399 (dist to 500: 150..101) -> gain from 0.75 down to ~0.505
		let mut buf = vec![1.0f32; 50];
		control.apply_crossfade(&mut buf, 350, 1);
		assert!((mono(&buf) - 0.75).abs() < 1e-5, "first={}", mono(&buf));
		assert!((mono(&buf[49..]) - 101.0 / 200.0).abs() < 1e-5, "last={}", mono(&buf[49..]));
	}

	#[test]
	fn crossfade_fades_in_after_crossing() {
		let control = control_with_crossfade(2.0);
		control.boundaries_lock().push_back(500);
		control.has_boundary.store(true, Ordering::Relaxed);
		// Advance played past the boundary: pop marks started at 0.
		control.consume_frames(550);
		assert_eq!(control.last_crossed.load(Ordering::Relaxed), 500);
		// Frame 500 (since 0) -> gain 0; frame 549 (since 49) -> gain ~0.245
		let mut buf = vec![1.0f32; 50];
		control.apply_crossfade(&mut buf, 500, 1);
		assert_eq!(mono(&buf), 0.0);
		assert!((mono(&buf[49..]) - 49.0 / 200.0).abs() < 1e-5, "last={}", mono(&buf[49..]));
	}

	#[test]
	fn crossfade_combines_outs_and_outs() {
		let control = control_with_crossfade(2.0);
		control.boundaries_lock().push_back(500);
		control.boundaries_lock().push_back(900);
		control.has_boundary.store(true, Ordering::Relaxed);
		// played=350..: fade-out toward 500 (dist 150..) and no fade-in yet.
		let mut buf = vec![1.0f32; 50];
		control.apply_crossfade(&mut buf, 350, 1);
		assert!((mono(&buf) - 0.75).abs() < 1e-5);
	}
}
