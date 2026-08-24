use std::sync::{Arc, Mutex};
use crate::audio::config::AudioConfig;
use crate::library::db::LibraryDb;

pub struct AppState {
	pub db: Arc<Mutex<LibraryDb>>,
	pub output: Mutex<Option<crate::audio::output::AudioOutput>>,
	pub decoder: Mutex<Option<std::sync::Arc<Mutex<crate::decoder::flac::FlacDecoder>>>>,
	pub resampler: Mutex<Option<std::sync::Arc<Mutex<crate::audio::resampler::AudioResampler>>>>,
	pub volume: std::sync::Arc<std::sync::Mutex<f32>>,
	pub current_path: Mutex<Option<std::path::PathBuf>>,
	pub current_device: Mutex<Option<usize>>,
	pub audio_format: Mutex<Option<AudioConfig>>,
}

unsafe impl Send for AppState {}
unsafe impl Sync for AppState {}
