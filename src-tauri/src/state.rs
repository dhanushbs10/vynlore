use std::sync::atomic::AtomicU32;
use std::sync::{Arc, Mutex};

use crate::audio::player::{ControlBlock, PlaybackHandle};
use crate::audio::spectrum::SpectrumAnalyzer;
use crate::library::db::LibraryDb;

pub struct AppState {
	pub db: Arc<Mutex<LibraryDb>>,
	pub playback: Mutex<Option<PlaybackHandle>>,
	pub volume: Arc<AtomicU32>,
	pub eq: crate::audio::eq::SharedEq,
	pub current_path: Mutex<Option<std::path::PathBuf>>,
	pub spectrum: Arc<SpectrumAnalyzer>,
	pub balance: Arc<AtomicU32>,
	pub preamp: Arc<AtomicU32>,
}

// SAFETY: PlaybackHandle contains a cpal::Stream which lacks Send/Sync impls on some
// platforms; see the safety note on PlaybackHandle. All other fields are Send+Sync.
unsafe impl Send for AppState {}
unsafe impl Sync for AppState {}

impl AppState {
	pub fn active_control(&self) -> Option<Arc<ControlBlock>> {
		self.playback
			.lock()
			.ok()?
			.as_ref()
			.map(|handle| handle.control.clone())
	}
}
