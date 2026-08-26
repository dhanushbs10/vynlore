//! WASAPI exclusive-mode output (Windows only).
//!
//! Opens an endpoint in AUDCLNT_SHAREMODE_EXCLUSIVE with the FILE's native
//! format (rate/channels/bit-depth), bypassing the Windows mixer entirely.
//! No resampling happens on this path: the engine requests the file's exact
//! rate, and Symphonia's normalized f32 samples convert back to integers
//! losslessly for any source â‰¤ 24-bit (f32 mantissa is 24 bits).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::core::GUID;
use windows::Win32::Media::Audio::{
	IAudioClient, IAudioRenderClient, IMMDeviceCollection, IMMDeviceEnumerator,
	AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED, AUDCLNT_SHAREMODE_EXCLUSIVE, EDataFlow,
	MMDeviceEnumerator, WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVE_FORMAT_PCM,
	DEVICE_STATE_ACTIVE, eConsole,
};
use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
use windows::Win32::System::Com::{
	CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

use crate::audio::player::ControlBlock;
use crate::audio::queue::SampleQueue;
use crate::audio::spectrum::SpectrumAnalyzer;

// KSDATAFORMAT_SUBTYPE_PCM {00000001-0000-0010-8000-00AA00389B71}
const KSDATAFORMAT_SUBTYPE_PCM: GUID =
	GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);

#[derive(Clone, Copy)]
pub struct TargetFormat {
	pub sample_rate: u32,
	pub channels: u16,
	pub valid_bits: u16,
}

fn build_waveformat(fmt: TargetFormat) -> WAVEFORMATEXTENSIBLE {
	let container: u16 = if fmt.valid_bits <= 16 { 16 } else { 32 };
	let block_align = fmt.channels * container / 8;

	let mut ext: WAVEFORMATEXTENSIBLE = unsafe { std::mem::zeroed() };
	ext.Format = WAVEFORMATEX {
		wFormatTag: if container > 16 {
			WAVE_FORMAT_EXTENSIBLE as u16
		} else {
			WAVE_FORMAT_PCM as u16
		},
		nChannels: fmt.channels,
		nSamplesPerSec: fmt.sample_rate,
		nAvgBytesPerSec: fmt.sample_rate * block_align as u32,
		nBlockAlign: block_align,
		wBitsPerSample: container,
		cbSize: if container > 16 {
			std::mem::size_of::<GUID>() as u16 + 2
		} else {
			0
		},
	};

	if container > 16 {
		ext.Samples.wValidBitsPerSample = fmt.valid_bits;
	}

	ext.dwChannelMask = if fmt.channels >= 18 {
		u32::MAX
	} else {
		(1u32 << fmt.channels) - 1
	};
	ext.SubFormat = KSDATAFORMAT_SUBTYPE_PCM;
	ext
}

/// Handle owning the exclusive render session. Dropping it signals the render
/// thread to shut down cleanly (client Stop + join).
pub struct WasapiStream {
	stop_flag: Arc<AtomicBool>,
	join: Option<JoinHandle<()>>,
}

unsafe impl Send for WasapiStream {}

impl Drop for WasapiStream {
	fn drop(&mut self) {
		self.stop_flag.store(true, Ordering::SeqCst);
		if let Some(join) = self.join.take() {
			let _ = join.join();
		}
	}
}

/// Pre-acquired exclusive session handed to the render thread. COM interface
/// pointers are single-owned and joined before drop, so moving them to one
/// dedicated thread is sound.
struct Session {
	client: IAudioClient,
	render: IAudioRenderClient,
	buffer_frames: u32,
}

/// Everything the render thread needs, bundled so the spawned closure has
/// exactly one (Send) capture regardless of the individual field types.
struct RenderJob {
	session: Session,
	fmt: TargetFormat,
	queue: Arc<SampleQueue>,
	control: Arc<ControlBlock>,
	volume_bits: Arc<std::sync::atomic::AtomicU32>,
	spectrum: Arc<SpectrumAnalyzer>,
	balance: Arc<std::sync::atomic::AtomicU32>,
	stop_flag: Arc<AtomicBool>,
}
unsafe impl Send for RenderJob {}

/// Attempts to open `device_index` (1-based, matching list_devices order;
/// None = default endpoint) exclusively with the file's native format.
///
/// ALL device negotiation happens here on the caller's thread: any failure
/// returns Err and `player::start` falls back to shared mode while the old
/// output can still be (re)opened â€” no silent dead sessions.
pub fn open_exclusive(
	device_index: Option<usize>,
	fmt: TargetFormat,
	queue: Arc<SampleQueue>,
	control: Arc<ControlBlock>,
	volume_bits: Arc<std::sync::atomic::AtomicU32>,
	spectrum: Arc<SpectrumAnalyzer>,
	balance: Arc<std::sync::atomic::AtomicU32>,
) -> Result<WasapiStream, String> {
	let stop_flag = Arc::new(AtomicBool::new(false));

	let session = unsafe { acquire_session(device_index, fmt)? };
	unsafe { CoUninitialize(); }

	let thread_stop = stop_flag.clone();
	let job = RenderJob {
		session,
		fmt,
		queue: queue.clone(),
		control,
		volume_bits,
		spectrum,
		balance,
		stop_flag: thread_stop,
	};
	let join = std::thread::Builder::new()
		.name("vynlore-wasapi".into())
		// NB: the closure must only capture `job` whole. Destructuring inside
		// the closure would make edition-2021 capture each field separately
		// and reject the raw HANDLE/COM pointers.
		.spawn(move || unsafe {
			run_render_job(job);
		})
		.map_err(|e| format!("failed to spawn wasapi thread: {}", e))?;

	Ok(WasapiStream {
		stop_flag,
		join: Some(join),
	})
}

/// Full synchronous acquisition of an exclusive-mode endpoint: device â†’ client
/// â†’ format negotiation â†’ Initialize (with the aligned-buffer retry dance) â†’
/// event handle â†’ render service.
unsafe fn acquire_session(
	device_index: Option<usize>,
	fmt: TargetFormat,
) -> Result<Session, String> {
	let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

	let enumerator: IMMDeviceEnumerator =
		CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
			.map_err(|e| format!("CoCreateInstance(MMDeviceEnumerator): {}", e))?;

	let device = resolve_device(&enumerator, device_index)?;
	let client: IAudioClient = device
		.Activate(CLSCTX_ALL, None)
		.map_err(|e| format!("Activate: {}", e))?;

	let wf = build_waveformat(fmt);
	let hr = client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, &wf.Format, None);
	if hr.is_err() {
		return Err(format!(
			"{}Hz/{}ch/{}bit unsupported exclusive (hr=0x{:08X})",
			fmt.sample_rate, fmt.channels, fmt.valid_bits, hr.0 as u32
		));
	}

	let mut default_period: i64 = 0;
	let mut min_period: i64 = 0;
	client
		.GetDevicePeriod(Some(&mut default_period), Some(&mut min_period))
		.map_err(|e| format!("GetDevicePeriod: {}", e))?;
	let _ = min_period;

	// ~10x device period of buffering keeps the poll loop lazy without
	// audible latency on an output-only path.
	let buffer_duration = default_period * 10;

	let mut init = client.Initialize(
		AUDCLNT_SHAREMODE_EXCLUSIVE,
		0,
		buffer_duration,
		0,
		&wf.Format,
		None,
	);
	if let Err(e) = init.as_ref() {
		if e.code() == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED {
			// Classic dance: the aligned size is discoverable even after the
			// failed Initialize; retry once with that exact duration.
			let aligned_frames = client
				.GetBufferSize()
				.map_err(|e| format!("GetBufferSize after align error: {}", e))?;
			let aligned_duration =
				(aligned_frames as i64) * 10_000_000i64 / fmt.sample_rate.max(1) as i64;
			init = client.Initialize(
				AUDCLNT_SHAREMODE_EXCLUSIVE,
				0,
				aligned_duration,
				0,
				&wf.Format,
				None,
			);
		}
	}
	init.map_err(|e| format!("Initialize(EXCLUSIVE): {}", e))?;

	let render: IAudioRenderClient = client
		.GetService()
		.map_err(|e| format!("GetService(IAudioRenderClient): {}", e))?;

	let buffer_frames = client
		.GetBufferSize()
		.map_err(|e| format!("GetBufferSize: {}", e))?;

	Ok(Session {
		client,
		render,
		buffer_frames,
	})
}

/// Whether exclusive mode can plausibly succeed before committing to the
/// backend switch. Runs the full negotiation synchronously on the caller's
/// thread; cheap (no buffers allocated).
///
/// Returns Ok(()) when the endpoint accepts the exact format exclusively.
pub fn probe_exclusive(device_index: Option<usize>, fmt: TargetFormat) -> Result<(), String> {
	unsafe {
		let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
		let enumerator: IMMDeviceEnumerator =
			CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
				.map_err(|e| format!("CoCreateInstance(MMDeviceEnumerator): {}", e))?;
		let device = resolve_device(&enumerator, device_index)?;
		let client: IAudioClient = device
			.Activate(CLSCTX_ALL, None)
			.map_err(|e| format!("Activate: {}", e))?;
		let wf = build_waveformat(fmt);
		let hr = client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, &wf.Format, None);
		if hr.is_err() {
			return Err(format!(
				"{}Hz/{}ch/{}bit unsupported exclusive (hr=0x{:08X})",
				fmt.sample_rate, fmt.channels, fmt.valid_bits, hr.0 as u32
			));
		}
		CoUninitialize();
		Ok(())
	}
}

unsafe fn resolve_device(
	enumerator: &IMMDeviceEnumerator,
	device_index: Option<usize>,
) -> Result<windows::Win32::Media::Audio::IMMDevice, String> {
	match device_index {
		Some(idx) if idx > 0 => {
			let collection: IMMDeviceCollection = enumerator
				.EnumAudioEndpoints(EDataFlow(0), DEVICE_STATE_ACTIVE)
				.map_err(|e| format!("EnumAudioEndpoints: {}", e))?;
			let count = collection.GetCount().map_err(|e| e.to_string())?;
			if idx as u32 > count {
				return Err(format!("device index {} out of range ({})", idx, count));
			}
			collection.Item(idx as u32 - 1).map_err(|e| e.to_string())
		}
		_ => enumerator
			.GetDefaultAudioEndpoint(EDataFlow(0), eConsole)
			.map_err(|e| format!("GetDefaultAudioEndpoint: {}", e)),
	}
}

/// Entry point on the render thread: unpacks the job and runs the loop.
unsafe fn run_render_job(job: RenderJob) {
	let RenderJob {
		session,
		fmt,
		queue,
		control,
		volume_bits,
		spectrum,
		balance,
		stop_flag,
	} = job;
	let Session {
		client,
		render,
		buffer_frames,
	} = session;

	if let Err(e) =
		run_render_loop(client, render, buffer_frames, fmt, &queue, &control, &volume_bits, &spectrum, &balance, &stop_flag)
	{
		eprintln!("exclusive output ended: {}", e);
		// Wake/stop the decoder so a dead exclusive session never leaves
		// playback hanging in silence.
		queue.close();
	}
}

/// Converts interleaved f32 from `scratch` into the endpoint container and
/// releases the frames. `account` controls position tracking — prefill
/// happens before the device clock runs, so it must not advance the playhead.
unsafe fn write_samples(
	render: &IAudioRenderClient,
	scratch: &[f32],
	frames: usize,
	fmt: TargetFormat,
	container_bits: u16,
	control: &Arc<ControlBlock>,
	volume_bits: &Arc<std::sync::atomic::AtomicU32>,
	balance_bits: &Arc<std::sync::atomic::AtomicU32>,
	account: bool,
) -> Result<usize, String> {
	if frames == 0 {
		return Ok(0);
	}
	let ch = fmt.channels as usize;
	let vol = f32::from_bits(volume_bits.load(Ordering::Relaxed));
	let bal = f32::from_bits(balance_bits.load(Ordering::Relaxed));
	let left_gain = if bal > 0.01 { 1.0 - bal } else { 1.0 };
	let right_gain = if bal < -0.01 { 1.0 + bal } else { 1.0 };
	let passthrough = (vol - 1.0).abs() < 1e-6 && (bal).abs() < 0.01;
	let data_ptr = render.GetBuffer(frames as u32).map_err(|e| format!("GetBuffer: {}", e))?;

	if container_bits == 16 {
		let dst = data_ptr as *mut i16;
		for (frame, chunk) in scratch[..frames * ch].chunks_exact(ch).enumerate() {
			for (c, s) in chunk.iter().enumerate() {
				let balanced = match c {
					0 => s * left_gain,
					1 if ch >= 2 => s * right_gain,
					_ => *s,
				};
				let scaled = if passthrough { *s } else { balanced * vol };
				let v = (scaled.clamp(-1.0, 1.0) * 32768.0).round() as i32;
				*dst.add(frame * ch + c) = v.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
			}
		}
	} else {
		let dst = data_ptr as *mut i32;
		let shift = 32 - fmt.valid_bits as i32;
		let full_scale = 1i64 << (fmt.valid_bits.saturating_sub(1));
		for (frame, chunk) in scratch[..frames * ch].chunks_exact(ch).enumerate() {
			for (c, s) in chunk.iter().enumerate() {
				let balanced = match c {
					0 => s * left_gain,
					1 if ch >= 2 => s * right_gain,
					_ => *s,
				};
				let scaled = if passthrough { *s } else { balanced * vol };
				let v = (scaled.clamp(-1.0, 1.0) * full_scale as f32).round() as i64;
				// Left-justify into the container (MSB aligned).
				*dst.add(frame * ch + c) =
					((v.clamp(-full_scale, full_scale - 1)) as i32) << shift;
			}
		}
	}

	render
		.ReleaseBuffer(frames as u32, 0)
		.map_err(|e| format!("ReleaseBuffer: {}", e))?;
	if account {
		control.consume_frames(frames as i64);
	}
	Ok(frames)
}

/// Zero-fills `frames` frames to keep the exclusive device clock fed during
/// decoder starvation (an underrun on an exclusive stream can latch stale
/// buffer content or mute until restart).
unsafe fn write_silence(
	render: &IAudioRenderClient,
	frames: usize,
	ch: usize,
	container_bytes: usize,
) -> Result<(), String> {
	let data_ptr = render.GetBuffer(frames as u32).map_err(|e| format!("GetBuffer(silence): {}", e))?;
	std::ptr::write_bytes(data_ptr, 0, frames * ch * container_bytes);
	render
		.ReleaseBuffer(frames as u32, 0)
		.map_err(|e| format!("ReleaseBuffer(silence): {}", e))
}

/// Polling render loop over a pre-acquired exclusive session. Any device
/// failure returns Err so the spawner can close the queue — the engine
/// unwinds and reports playback-ended instead of hanging in silence.
#[allow(clippy::too_many_arguments)]
unsafe fn run_render_loop(
	client: IAudioClient,
	render: IAudioRenderClient,
	buffer_frames: u32,
	fmt: TargetFormat,
	queue: &Arc<SampleQueue>,
	control: &Arc<ControlBlock>,
	volume_bits: &Arc<std::sync::atomic::AtomicU32>,
	spectrum: &Arc<SpectrumAnalyzer>,
	balance_bits: &Arc<std::sync::atomic::AtomicU32>,
	stop_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
	let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

	let ch = fmt.channels as usize;
	let container_bits: u16 = if fmt.valid_bits <= 16 { 16 } else { 32 };
	let container_bytes = (container_bits / 8) as usize;
	spectrum.set_channels(ch);
	let diag = std::env::var("VYNLORE_EXCL_DIAG").map(|v| v != "0").unwrap_or(false);
	let mut scratch: Vec<f32> = vec![0.0f32; buffer_frames as usize * ch];

	// ---- Prefill: load the whole device buffer BEFORE starting the clock.
	// A dry start leaves the engine in an underrun state some drivers never
	// audibly recover from, and period events may not fire until audio exists.
	let prefill_deadline = Instant::now() + Duration::from_millis(800);
	loop {
		if control.stop.load(Ordering::SeqCst) || stop_flag.load(Ordering::SeqCst) {
			break;
		}
		let padding = client.GetCurrentPadding().map_err(|e| format!("padding(prefill): {}", e))?;
		let avail = buffer_frames.saturating_sub(padding) as usize;
		if avail == 0 {
			break;
		}
		let got = queue.pop_available(&mut scratch[..avail * ch]);
		let frames = got / ch;
		if frames == 0 {
			if Instant::now() >= prefill_deadline {
				eprintln!("excl: prefill short (decoder cold), starting anyway");
				break;
			}
			std::thread::sleep(Duration::from_millis(2));
			continue;
		}
		write_samples(&render, scratch.as_slice(), frames, fmt, container_bits, control, volume_bits, balance_bits, false)?;
	}

	client.Start().map_err(|e| format!("Start: {}", e))?;
	eprintln!(
		"exclusive session live: {}Hz / {}ch / {}bit",
		fmt.sample_rate, fmt.channels, fmt.valid_bits
	);

	let loop_start = Instant::now();
	let mut ticks: u64 = 0;
	let mut starve_ticks: u64 = 0;
	let mut written_total: u64 = 0;
	let mut was_paused = false;
	let mut report_at = Instant::now();

	// Service cadence: ~2ms per tick; the 100ms buffer gives enormous slack
	// against Windows' default timer granularity (~15ms).
	let service_sleep = Duration::from_millis(2);

	loop {
		ticks += 1;

		if stop_flag.load(Ordering::SeqCst) || control.stop.load(Ordering::SeqCst) {
			break;
		}

		let paused = control.paused.load(Ordering::Relaxed);
		if paused != was_paused {
			if paused {
				if let Err(e) = client.Stop() {
					eprintln!("exclusive pause: Stop() failed: {}", e);
				}
				if let Err(e) = client.Reset() {
					eprintln!("exclusive pause: Reset() failed: {}", e);
				}
			} else {
				if let Err(e) = client.Start() {
					eprintln!("exclusive unpause: Start() failed: {}", e);
				}
			}
			was_paused = paused;
		}
		if paused {
			std::thread::sleep(Duration::from_millis(30));
			continue;
		}

		let padding = client.GetCurrentPadding().map_err(|e| e.to_string())?;
		let avail = buffer_frames.saturating_sub(padding) as usize;
		if avail == 0 {
			std::thread::sleep(service_sleep);
			continue;
		}

		let want = avail * ch;
		let got = queue.pop_available(&mut scratch[..want]);
		let frames = got / ch;
		if frames == 0 {
			// Starvation filler keeps the clock moving; position accounting
			// deliberately skips silent frames so the UI playhead stays true.
			starve_ticks += 1;
			control.underruns.fetch_add(1, Ordering::Relaxed);
			write_silence(&render, avail.min(buffer_frames as usize), ch, container_bytes)?;
		} else {
			let frames_written = write_samples(
				&render,
				scratch.as_slice(),
				frames,
				fmt,
				container_bits,
				control,
				volume_bits,
				balance_bits,
				true,
			)?;
			// Push raw (pre-volume) samples to spectrum so the visualizer
			// isn't double-gained by the volume/balance adjustment below.
			spectrum.push_samples(&scratch[..frames_written * ch]);
			let vol = f32::from_bits(volume_bits.load(Ordering::Relaxed));
			let bal = f32::from_bits(balance_bits.load(Ordering::Relaxed));
			let lg = if bal > 0.01 { 1.0 - bal } else { 1.0 };
			let rg = if bal < -0.01 { 1.0 + bal } else { 1.0 };
			for chunk in scratch[..frames_written * ch].chunks_exact_mut(ch) {
				chunk[0] *= lg * vol;
				if ch >= 2 {
					chunk[1] *= rg * vol;
				}
				for s in chunk[2..].iter_mut() {
					*s *= vol;
				}
			}
			written_total += frames_written as u64;
		}

		if diag && report_at.elapsed() >= Duration::from_secs(2) {
			eprintln!(
				"[excl-diag] t={}s ticks={} starve={} written={} buf={}",
				loop_start.elapsed().as_secs(),
				ticks,
				starve_ticks,
				written_total,
				buffer_frames
			);
			report_at = Instant::now();
		}

		std::thread::sleep(service_sleep);
	}

	let _ = client.Stop();
	CoUninitialize();
	Ok(())
}

/// Headless self-test (`--excl-test`): renders a 440 Hz sine exclusively on
/// the default endpoint for four seconds with verbose diagnostics, isolating
/// exclusive-mode health from the GUI and engine entirely.
pub fn run_diagnostic_sine() {
	// SAFETY: This function is only called from a fresh process (before any threads spawn)
	// via `--excl-test` CLI flag, so set_var is safe here.
	#[allow(unused_unsafe)]
	unsafe { std::env::set_var("VYNLORE_EXCL_DIAG", "1"); }
	println!("=== exclusive-mode diagnostic: default endpoint, 44100Hz/2ch/16bit ===");

	let queue = Arc::new(SampleQueue::new(44100usize * 2 * 8));
	let control = Arc::new(ControlBlock {
		paused: AtomicBool::new(false),
		stop: AtomicBool::new(false),
		ended_emitted: AtomicBool::new(false),
		seek_to: std::sync::Mutex::new(None),
		output_rate: 44100,
		output_channels: 2,
		underruns: std::sync::atomic::AtomicU64::new(0),
		frames_played: std::sync::atomic::AtomicI64::new(0),
		track_start_frame: std::sync::atomic::AtomicI64::new(0),
		frames_pushed: std::sync::atomic::AtomicU64::new(0),
		boundaries: std::sync::Mutex::new(std::collections::VecDeque::new()),
		has_boundary: AtomicBool::new(false),
		pending_change: AtomicBool::new(false),
		next_file: std::sync::Mutex::new(None),
		current_file: std::sync::Mutex::new(std::path::PathBuf::from("sine")),
	});
	let volume_bits = Arc::new(std::sync::atomic::AtomicU32::new(1.0f32.to_bits()));
	let spectrum = Arc::new(SpectrumAnalyzer::new());
	let balance = Arc::new(std::sync::atomic::AtomicU32::new(0.0f32.to_bits()));

	let feeder_q = queue.clone();
	std::thread::spawn(move || {
		let mut phase = 0.0f64;
		let mut buf = vec![0.0f32; 2205 * 2];
		loop {
			for frame in buf.chunks_exact_mut(2) {
				frame[0] = (phase * std::f64::consts::PI * 2.0).sin() as f32 * 0.25;
				frame[1] = frame[0];
				phase += 440.0 / 44100.0;
			}
			if !feeder_q.push_all(&buf) {
				return;
			}
			std::thread::sleep(Duration::from_millis(15));
		}
	});

	match open_exclusive(
		None,
		TargetFormat {
			sample_rate: 44100,
			channels: 2,
			valid_bits: 16,
		},
		queue.clone(),
		control.clone(),
		volume_bits.clone(),
		spectrum.clone(),
		balance.clone(),
	) {
		Ok(stream) => {
			println!("session opened — a 440Hz tone should now be audible for ~4s");
			std::thread::sleep(Duration::from_secs(4));
			drop(stream);
			queue.close();
			println!(
				"=== done | frames_rendered={} underruns={} ===",
				control.frames_played.load(Ordering::Relaxed),
				control.underruns.load(Ordering::Relaxed)
			);
		}
		Err(e) => println!("EXCLUSIVE OPEN FAILED: {}", e),
	}
}
