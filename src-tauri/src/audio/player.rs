use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rubato::{
	calculate_cutoff, Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType,
	WindowFunction,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use cpal::traits::HostTrait;

use crate::audio::config::AudioConfig;
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
}

impl ControlBlock {
	fn boundaries_lock(&self) -> std::sync::MutexGuard<'_, VecDeque<i64>> {
		self.boundaries.lock().unwrap()
	}

	pub fn position_secs(&self) -> f64 {
		let played = self.frames_played.load(Ordering::Relaxed);
		let start = self.track_start_frame.load(Ordering::Relaxed);
		let delta = played.saturating_sub(start) as f64;
		delta / self.output_rate as f64
	}

	/// Shared by both output backends: advances consumption accounting and
	/// flips the audible track position when a gapless boundary is crossed.
	pub fn consume_frames(&self, frames: i64) {
		if frames <= 0 {
			return;
		}
		let prev = self.frames_played.fetch_add(frames, Ordering::Relaxed);
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
			self.pending_change.store(true, Ordering::Relaxed);
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
		self.queue.clear();
		let played = self.control.frames_played.load(Ordering::Relaxed);
		self.control
			.track_start_frame
			.store(played - (secs * rate) as i64, Ordering::Relaxed);
		*self.control.seek_to.lock().unwrap() = Some(secs);
	}

	/// Arms gapless continuation. Pass `None` to disarm (e.g. repeat-one).
	pub fn set_next(&self, path: Option<PathBuf>) {
		*self.control.next_file.lock().unwrap() = path;
	}
}

impl Drop for PlaybackHandle {
	fn drop(&mut self) {
		self.request_stop();
		self.backend.take();
		std::thread::sleep(Duration::from_millis(15));
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
	app: AppHandle,
	initial_seek: f64,
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
		out_rate as usize * out_channels as usize * 2,
	));

	let file_bit_depth = format.bit_depth;
	let mut pipeline = Pipeline::new(decoder, format, out_rate, eq.clone(), preamp.clone())?;
	if initial_seek > 0.0 {
		pipeline.seek(initial_seek);
	}

	let start_offset_frames = if initial_seek > 0.0 {
		-((initial_seek * out_rate as f64) as i64)
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
			unreachable!("exclusive path only compiled on windows");
		}
	} else {
		let (device, stream_config) = shared.as_ref().unwrap_or_else(|| {
			panic!("shared audio device setup must be initialized before starting shared backend")
		});
		let cb_control = control.clone();
		let cb_queue = queue.clone();
		let cb_volume = volume_bits.clone();
		let cb_balance = balance.clone();
		let cb_spectrum = spectrum.clone();
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
				let vol = f32::from_bits(cb_volume.load(Ordering::Relaxed));
				for sample in out_buf[..written].iter_mut() {
					*sample *= vol;
				}
				let ch_count = cb_control.output_channels.max(1) as usize;
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
				// written counts interleaved SAMPLES; consume_frames wants frames.
				cb_control.consume_frames((written / ch_count) as i64);
			}
		})
		.map_err(|e| e.to_string())?;
		Backend::Cpal(audio_output)
	};

	let thread_control = control.clone();
	let thread_queue = queue.clone();
	let thread_preamp = preamp.clone();
	std::thread::Builder::new()
		.name("vynlore-decode".into())
		.spawn(move || {
			run_decoder(pipeline, thread_control, thread_queue, eq, thread_preamp, app);
		})
		.map_err(|e| format!("failed to spawn decode thread: {}", e))?;

	Ok((
		PlaybackHandle {
			control,
			queue,
			backend: Some(backend),
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
	scratch: Vec<f32>,
	eq: crate::audio::eq::EqProcessor,
	preamp: Arc<AtomicU32>,
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
	) -> Result<Self, String> {
		let resampler = if format.sample_rate != out_rate {
			let params = SincInterpolationParameters {
				sinc_len: SINC_LEN,
				f_cutoff: calculate_cutoff(SINC_LEN, WindowFunction::BlackmanHarris2),
				interpolation: SincInterpolationType::Cubic,
				oversampling_factor: 256,
				window: WindowFunction::BlackmanHarris2,
			};
			let ratio = out_rate as f64 / format.sample_rate as f64;
			Some(
				SincFixedIn::<f32>::new(ratio, 1.0, params, CHUNK_IN_FRAMES, format.channels as usize)
					.map_err(|e| format!("resampler init failed: {}", e))?,
			)
		} else {
			None
		};
		let eq_processor =
			crate::audio::eq::EqProcessor::new(eq, out_rate, format.channels as usize);
		Ok(Self {
			decoder,
			format,
			resampler,
			pending: Vec::new(),
			scratch: Vec::new(),
			eq: eq_processor,
			preamp,
			eof: false,
			tail_flushed: false,
		})
	}

	fn seek(&mut self, secs: f64) {
		match audio::seek(&mut self.decoder, secs) {
			Ok(()) => {
				self.pending.clear();
				self.eof = false;
				self.tail_flushed = false;
				if let Some(r) = self.resampler.as_mut() {
					r.reset();
				}
				self.eq.reset();
			}
			Err(e) => eprintln!("seek failed: {}", e),
		}
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

	fn pump(&mut self, queue: &SampleQueue) -> Pushed {
		let ch = self.format.channels as usize;
		let available_frames = self.pending.len() / ch;
		let preamp_gain = f32::from_bits(self.preamp.load(Ordering::Relaxed));

		match self.resampler.as_mut() {
			Some(r) => {
				if available_frames >= CHUNK_IN_FRAMES {
					let mut in_bufs: Vec<Vec<f32>> = (0..ch)
						.map(|_| Vec::with_capacity(CHUNK_IN_FRAMES))
						.collect();
					for frame in 0..CHUNK_IN_FRAMES {
						for c in 0..ch {
							in_bufs[c].push(self.pending[frame * ch + c]);
						}
					}
					self.pending.drain(..CHUNK_IN_FRAMES * ch);
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
				if !self.pending.is_empty() {
					let mut data = std::mem::take(&mut self.pending);
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
		let ch = self.format.channels as usize;
		let available_frames = self.pending.len() / ch;
		let mut total: u64 = 0;
		let preamp_gain = f32::from_bits(self.preamp.load(Ordering::Relaxed));

		if let Some(r) = self.resampler.as_mut() {
			if available_frames > 0 {
				let mut in_bufs: Vec<Vec<f32>> = (0..ch)
					.map(|_| Vec::with_capacity(available_frames))
					.collect();
				for frame in 0..available_frames {
					for c in 0..ch {
						in_bufs[c].push(self.pending[frame * ch + c]);
					}
				}
				self.pending.clear();
				match r.process_partial(Some(&in_bufs), None) {
					Ok(out) => {
						let out_frames = out.first().map_or(0, |c| c.len());
						interleave(&out, out_frames, &mut self.scratch);
						apply_gain(preamp_gain, &mut self.scratch);
						self.eq.process_interleaved(&mut self.scratch);
						if !queue.push_all(&self.scratch) {
							self.tail_flushed = true;
							return Pushed::Closed;
						}
						total += out_frames as u64;
					}
					Err(e) => eprintln!("final resample error: {}", e),
				}
			}
			loop {
				match r.process_partial::<Vec<f32>>(None, None) {
					Ok(out) => {
						let out_frames = out.first().map_or(0, |c| c.len());
						if out_frames == 0 {
							break;
						}
						interleave(&out, out_frames, &mut self.scratch);
						apply_gain(preamp_gain, &mut self.scratch);
						self.eq.process_interleaved(&mut self.scratch);
						if !queue.push_all(&self.scratch) {
							break;
						}
						total += out_frames as u64;
					}
					Err(_) => break,
				}
			}
		} else if !self.pending.is_empty() {
			let mut data = std::mem::take(&mut self.pending);
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

fn apply_gain(gain: f32, data: &mut [f32]) {
	let g = gain.max(0.001);
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
	let next = control.next_file.lock().unwrap().take();
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
			*control.current_file.lock().unwrap() = next_path;
			match Pipeline::new(decoder, format, out_rate, eq, preamp) {
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

	'outer: loop {
		if control.stop.load(Ordering::SeqCst) {
			break;
		}

		// The RT callback flags when playback audibly crossed into the chained
		// file; sync the UI from here, safely off the realtime thread.
		if control.pending_change.swap(false, Ordering::Relaxed) {
			let path = control.current_file.lock().unwrap().display().to_string();
			let _ = app.emit("track-changed", TrackChangedPayload { path });
		}

		if let Some(t) = control.seek_to.lock().unwrap().take() {
			pipeline.seek(t);
		}

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
				if let Some(t) = control.seek_to.lock().unwrap().take() {
					pipeline.seek(t);
					continue 'outer;
				}
				if control.pending_change.swap(false, Ordering::Relaxed) {
					let path = control.current_file.lock().unwrap().display().to_string();
					let _ = app.emit("track-changed", TrackChangedPayload { path });
				}
				if control.next_file.lock().unwrap().is_some() {
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
