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
use std::time::Duration;

use windows::core::GUID;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
	IAudioClient, IAudioRenderClient, IMMDeviceCollection, IMMDeviceEnumerator,
	AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED, AUDCLNT_SHAREMODE_EXCLUSIVE,
	AUDCLNT_STREAMFLAGS_EVENTCALLBACK, EDataFlow, MMDeviceEnumerator, WAVEFORMATEX,
	WAVEFORMATEXTENSIBLE, WAVE_FORMAT_PCM, DEVICE_STATE_ACTIVE, eConsole,
};
use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
use windows::Win32::System::Com::{
	CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};

use crate::audio::player::ControlBlock;
use crate::audio::queue::SampleQueue;

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
/// thread to shut down cleanly (client Stop + event wake + join).
pub struct WasapiStream {
	stop_flag: Arc<AtomicBool>,
	event: HANDLE,
	join: Option<JoinHandle<()>>,
}

unsafe impl Send for WasapiStream {}

impl Drop for WasapiStream {
	fn drop(&mut self) {
		self.stop_flag.store(true, Ordering::SeqCst);
		unsafe {
			let _ = SetEvent(self.event);
		}
		if let Some(join) = self.join.take() {
			let _ = join.join();
		}
		unsafe {
			let _ = CloseHandle(self.event);
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
	event: HANDLE,
	fmt: TargetFormat,
	queue: Arc<SampleQueue>,
	control: Arc<ControlBlock>,
	volume_bits: Arc<std::sync::atomic::AtomicU32>,
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
) -> Result<WasapiStream, String> {
	let stop_flag = Arc::new(AtomicBool::new(false));
	let event = unsafe {
		CreateEventW(None, false, false, None)
			.map_err(|e| format!("CreateEventW failed: {}", e))?
	};

	let session = unsafe { acquire_session(device_index, fmt, event)? };

	let thread_stop = stop_flag.clone();
	let job = RenderJob {
		session,
		event,
		fmt,
		queue: queue.clone(),
		control,
		volume_bits,
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
		event,
		join: Some(join),
	})
}

/// Full synchronous acquisition of an exclusive-mode endpoint: device â†’ client
/// â†’ format negotiation â†’ Initialize (with the aligned-buffer retry dance) â†’
/// event handle â†’ render service.
unsafe fn acquire_session(
	device_index: Option<usize>,
	fmt: TargetFormat,
	event: HANDLE,
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

	// ~10x device period of buffering keeps the render loop lazy without
	// audible latency on an output-only path.
	let buffer_duration = default_period * 10;

	let mut init = client.Initialize(
		AUDCLNT_SHAREMODE_EXCLUSIVE,
		AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
		buffer_duration,
		buffer_duration,
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
				AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
				aligned_duration,
				aligned_duration,
				&wf.Format,
				None,
			);
		}
	}
	init.map_err(|e| format!("Initialize(EXCLUSIVE): {}", e))?;

	client
		.SetEventHandle(event)
		.map_err(|e| format!("SetEventHandle: {}", e))?;

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
		event,
		fmt,
		queue,
		control,
		volume_bits,
		stop_flag,
	} = job;
	let Session {
		client,
		render,
		buffer_frames,
	} = session;

	if let Err(e) =
		run_render_loop(client, render, buffer_frames, fmt, event, &queue, &control, &volume_bits, &stop_flag)
	{
		eprintln!("exclusive output ended: {}", e);
		// Wake/stop the decoder so a dead exclusive session never leaves
		// playback hanging in silence.
		queue.close();
	}
}

/// Event-driven render loop over a pre-acquired session. Any device failure
/// returns Err so the spawner can close the queue — the engine unwinds and
/// reports playback-ended instead of hanging in silence.
unsafe fn run_render_loop(
	client: IAudioClient,
	render: IAudioRenderClient,
	buffer_frames: u32,
	fmt: TargetFormat,
	event: HANDLE,
	queue: &Arc<SampleQueue>,
	control: &Arc<ControlBlock>,
	volume_bits: &Arc<std::sync::atomic::AtomicU32>,
	stop_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
	let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

	let ch = fmt.channels as usize;
	let mut scratch: Vec<f32> = vec![0.0f32; buffer_frames as usize * ch];

	client.Start().map_err(|e| format!("Start: {}", e))?;
	eprintln!(
		"exclusive session live: {}Hz / {}ch / {}bit",
		fmt.sample_rate, fmt.channels, fmt.valid_bits
	);

	let mut was_paused = false;

	loop {
		if stop_flag.load(Ordering::SeqCst) || control.stop.load(Ordering::SeqCst) {
			break;
		}

		let paused = control.paused.load(Ordering::Relaxed);
		if paused != was_paused {
			if paused {
				let _ = client.Stop();
				let _ = client.Reset();
			} else {
				let _ = client.Start();
			}
			was_paused = paused;
		}
		if paused {
			continue;
		}

		if WaitForSingleObject(event, 100) != WAIT_OBJECT_0 {
			continue;
		}
		if stop_flag.load(Ordering::SeqCst) || control.stop.load(Ordering::SeqCst) {
			break;
		}

		let padding = client.GetCurrentPadding().map_err(|e| e.to_string())?;
		let avail = buffer_frames.saturating_sub(padding) as usize;
		if avail == 0 {
			continue;
		}

		let want = avail * ch;
		let got = queue.pop_available(&mut scratch[..want]);
		let frames = got / ch;
		if frames == 0 {
			// Decoder hasn't caught up; skip this tick instead of writing
			// silence into an exclusive stream (clicks).
			std::thread::sleep(Duration::from_millis(4));
			continue;
		}

		let vol = f32::from_bits(volume_bits.load(Ordering::Relaxed));
		let passthrough = (vol - 1.0).abs() < 1e-6;
		let container_bits: u16 = if fmt.valid_bits <= 16 { 16 } else { 32 };

		let data_ptr = render.GetBuffer(frames as u32).map_err(|e| e.to_string())?;

		if container_bits == 16 {
			let dst = data_ptr as *mut i16;
			for (frame, chunk) in scratch[..got].chunks_exact(ch).enumerate() {
				for (c, s) in chunk.iter().enumerate() {
					let scaled = if passthrough { *s } else { s * vol };
					let v = (scaled.clamp(-1.0, 1.0) * 32768.0).round() as i32;
					*dst.add(frame * ch + c) =
						v.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
				}
			}
		} else {
			let dst = data_ptr as *mut i32;
			let shift = 32 - fmt.valid_bits as i32;
			let full_scale = 1i64 << (fmt.valid_bits.saturating_sub(1));
			for (frame, chunk) in scratch[..got].chunks_exact(ch).enumerate() {
				for (c, s) in chunk.iter().enumerate() {
					let scaled = if passthrough { *s } else { s * vol };
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

		control.consume_frames(frames as i64);
	}

	let _ = client.Stop();
	Ok(())
}
