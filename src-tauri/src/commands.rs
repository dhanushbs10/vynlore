use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use cpal::traits::{HostTrait, DeviceTrait};
use std::fs;
use std::path::Path;

use tauri::State;
use tauri::Manager;
use tauri::Emitter;
use std::thread;

use crate::state::AppState;
use crate::audio::config::AudioConfig;
use crate::audio::resampler::AudioResampler;
use crate::audio::output::{self, AudioOutput};
use crate::decoder::flac;
use crate::library::watcher::{start_watcher as spawn_watcher, WatcherEvent};
use crate::library::scanner::scan_folder_with_progress as scan_folder_internal;

#[derive(Serialize, Deserialize, Clone)]
pub struct UiTrack {
  pub id: i64,
  pub file_path: String,
  pub title: String,
  pub artist: String,
  pub album: String,
  pub genre: Option<String>,
  pub sample_rate: u32,
  pub bit_depth: u32,
  pub channels: u8,
  pub duration_secs: f64,
  pub cover_path: Option<String>,
  pub lyrics: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UiDevice {
  pub index: usize,
  pub name: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UiPlaylist {
  pub id: i64,
  pub name: String,
  pub track_count: i64,
}

#[derive(Serialize, Deserialize)]
struct AppConfig {
  pub watched_folder: Option<String>,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
  Ok(app_data_dir.join("config.json"))
}

fn read_config(app: &tauri::AppHandle) -> Result<AppConfig, String> {
  let path = config_path(app)?;
  if !path.exists() {
    return Ok(AppConfig { watched_folder: None });
  }
  let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
  let config: AppConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;
  Ok(config)
}

fn write_config(app: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
  let path = config_path(app)?;
  let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
  fs::write(&path, content).map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn get_watched_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
  let config = read_config(&app)?;
  Ok(config.watched_folder)
}

#[tauri::command]
pub fn set_watched_folder(path: String, app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
  let config = AppConfig {
    watched_folder: Some(path.clone()),
  };
  write_config(&app, &config)?;

  let db_for_watcher = state.db.clone();
  let _ = spawn_watcher(app.clone(), db_for_watcher, Path::new(&path));

  let db_for_scan = state.db.clone();
  let path_for_scan = path.clone();
  let app_for_emit = app.clone();
  thread::spawn(move || {
    let scan_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
      if let Ok(db) = db_for_scan.lock() {
        scan_folder_internal(&db, Path::new(&path_for_scan), |count| {
          if count % 50 == 0 {
            let _ = app_for_emit.emit("watcher-event", WatcherEvent {
              title: "Scanning...".to_string(),
              artist: path_for_scan.clone(),
              count,
            });
          }
        })
      } else {
        Err("Failed to lock DB for scan".into())
      }
    }));

    match scan_result {
      Ok(Ok(count)) => {
        let _ = app_for_emit.emit("watcher-event", WatcherEvent {
          title: "Scan complete".to_string(),
          artist: path_for_scan.clone(),
          count,
        });
      }
      Ok(Err(e)) => {
        let _ = app_for_emit.emit("watcher-event", WatcherEvent {
          title: "Scan failed".to_string(),
          artist: path_for_scan.clone(),
          count: 0,
        });
        eprintln!("Background scan error: {}", e);
      }
      Err(e) => {
        let _ = app_for_emit.emit("watcher-event", WatcherEvent {
          title: "Scan panic".to_string(),
          artist: path_for_scan.clone(),
          count: 0,
        });
        eprintln!("Background scan panic: {:?}", e);
      }
    }
  });

  Ok(())
}

#[tauri::command]
pub fn rescan_folder(path: String, app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
  let db = state.db.clone();
  let path_for_scan = path.clone();
  thread::spawn(move || {
    let scan_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
      if let Ok(db) = db.lock() {
        scan_folder_internal(&db, Path::new(&path_for_scan), |count| {
          if count % 50 == 0 {
            let _ = app.emit("watcher-event", WatcherEvent {
              title: "Rescanning...".to_string(),
              artist: path_for_scan.clone(),
              count,
            });
          }
        })
      } else {
        Err("Failed to lock DB for scan".into())
      }
    }));

    match scan_result {
      Ok(Ok(count)) => {
        let _ = app.emit("watcher-event", WatcherEvent {
          title: "Rescan complete".to_string(),
          artist: path_for_scan.clone(),
          count,
        });
      }
      Ok(Err(e)) => {
        let _ = app.emit("watcher-event", WatcherEvent {
          title: "Rescan failed".to_string(),
          artist: path_for_scan.clone(),
          count: 0,
        });
        eprintln!("Background rescan error: {}", e);
      }
      Err(e) => {
        let _ = app.emit("watcher-event", WatcherEvent {
          title: "Rescan panic".to_string(),
          artist: path_for_scan.clone(),
          count: 0,
        });
        eprintln!("Background rescan panic: {:?}", e);
      }
    }
  });
  Ok(())
}

#[tauri::command]
pub fn get_tracks(state: State<AppState>) -> Result<Vec<UiTrack>, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  let mut stmt = db.conn.prepare("SELECT id, file_path, title, artist, album, genre, sample_rate, bit_depth, channels, duration_secs, COALESCE(cover_path,''), COALESCE(lyrics,'') FROM tracks ORDER BY id DESC").map_err(|e| e.to_string())?;
  let track_iter = stmt.query_map([], |row| {
    Ok(UiTrack {
      id: row.get(0)?,
      file_path: row.get(1)?,
      title: row.get(2)?,
      artist: row.get(3)?,
      album: row.get(4)?,
      genre: row.get::<_, Option<String>>(5)?,
      sample_rate: row.get(6)?,
      bit_depth: row.get(7)?,
      channels: row.get(8)?,
      duration_secs: row.get(9)?,
      cover_path: if row.get::<_, String>(10)?.is_empty() { None } else { Some(row.get(10)?) },
      lyrics: if row.get::<_, String>(11)?.is_empty() { None } else { Some(row.get(11)?) },
    })
  }).map_err(|e| e.to_string())?;

  let mut tracks = Vec::new();
  for track in track_iter {
    tracks.push(track.map_err(|e| e.to_string())?);
  }
  Ok(tracks)
}

#[tauri::command]
pub fn list_devices() -> Result<Vec<UiDevice>, String> {
  let host = cpal::default_host();
  let devices: Vec<_> = host.output_devices().map_err(|e| e.to_string())?.collect();
  let mut ui_devices = Vec::new();
  for (idx, device) in devices.iter().enumerate() {
    let name = device.name().unwrap_or_else(|_| "Unknown".to_string());
    ui_devices.push(UiDevice { index: idx + 1, name });
  }
  Ok(ui_devices)
}

#[tauri::command]
pub fn scan_folder(path: String, state: State<AppState>) -> Result<usize, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  let count = scan_folder_internal(&db, Path::new(&path), |_| {}).map_err(|e| e.to_string())?;
  Ok(count)
}

#[tauri::command]
pub fn start_watcher(path: String, app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
  spawn_watcher(app, state.db.clone(), Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_volume(volume: f64, state: State<AppState>) -> Result<(), String> {
  let mut vol = state.volume.lock().map_err(|e| e.to_string())?;
  *vol = volume as f32;
  Ok(())
}

#[tauri::command]
pub fn pause_playback(state: State<AppState>) -> Result<(), String> {
  let output = state.output.lock().map_err(|e| e.to_string())?;
  if let Some(out) = output.as_ref() {
    out.pause();
  }
  Ok(())
}

#[tauri::command]
pub fn resume_playback(state: State<AppState>) -> Result<(), String> {
  let output = state.output.lock().map_err(|e| e.to_string())?;
  if let Some(out) = output.as_ref() {
    out.resume();
  }
  Ok(())
}

#[tauri::command]
pub fn play_track(file_path: String, _device_index: Option<usize>, state: State<AppState>) -> Result<(), String> {
  let path = PathBuf::from(&file_path);
  if !path.exists() {
    return Err("File not found".to_string());
  }

  let (decoder, format) = flac::open_flac(&path).map_err(|e| e.to_string())?;

  let host = cpal::default_host();
  let device = host.default_output_device().ok_or_else(|| "No default output device found".to_string())?;
  let device_config = output::find_best_config(&device, format.channels).map_err(|e| e.to_string())?;
  let device_sample_rate = device_config.sample_rate().0;
  let device_channels = device_config.channels();

  let output_config = AudioConfig {
    sample_rate: device_sample_rate,
    channels: device_channels,
    bits_per_sample: 32,
    exclusive_mode: true,
  };

  let decoder_arc = Arc::new(Mutex::new(decoder));
  let decoder_clone = decoder_arc.clone();

  let needs_resample = device_sample_rate != format.sample_rate;
  let resampler = if needs_resample {
    Some(Arc::new(Mutex::new(
      AudioResampler::new(format.sample_rate, device_sample_rate, format.channels as usize).map_err(|e| e.to_string())?,
    )))
  } else { None };
  let resampler_clone = resampler.clone();
  let volume_clone = state.volume.clone();
  let path_for_error = path.clone();

  let audio_output = AudioOutput::start(&output_config, Some(&device), move |output_buffer| {
    if let Some(ref resampler_arc) = resampler_clone {
      let mut dec = decoder_clone.lock().unwrap();
      let mut resampler = resampler_arc.lock().unwrap();
      while !resampler.has_enough_for_samples(output_buffer.len()) {
        match flac::decode_packet(&mut *dec) {
          Some(samples) => resampler.add_input(&samples),
          None => {
            resampler.flush();
            break;
          }
        }
      }
      let written = resampler.get_output(output_buffer);
      if written < output_buffer.len() {
        output_buffer[written..].fill(0.0);
      }
    } else {
      let mut dec = decoder_clone.lock().unwrap();
      flac::fill_buffer(&mut *dec, output_buffer);
    }
    let vol = *volume_clone.lock().unwrap();
    for sample in output_buffer.iter_mut() { *sample *= vol; }
  }).map_err(|e| e.to_string())?;

  *state.output.lock().map_err(|e| e.to_string())? = Some(audio_output);
  *state.decoder.lock().map_err(|e| e.to_string())? = Some(decoder_arc);
  *state.resampler.lock().map_err(|e| e.to_string())? = resampler;
  *state.current_path.lock().map_err(|e| e.to_string())? = Some(path);
  Ok(())
}

#[tauri::command]
pub fn stop_playback(state: State<AppState>) -> Result<(), String> {
  *state.output.lock().map_err(|e| e.to_string())? = None;
  *state.decoder.lock().map_err(|e| e.to_string())? = None;
  *state.resampler.lock().map_err(|e| e.to_string())? = None;
  *state.current_path.lock().map_err(|e| e.to_string())? = None;
  Ok(())
}

#[tauri::command]
pub fn seek_playback(seek_secs: f64, state: State<AppState>) -> Result<(), String> {
  if let Some(decoder_arc) = state.decoder.lock().map_err(|e| e.to_string())?.as_ref() {
    let mut dec = decoder_arc.lock().map_err(|e| e.to_string())?;
    crate::decoder::flac::seek(&mut *dec, seek_secs).map_err(|e| e.to_string())?;
  }
  if let Some(resampler_arc) = state.resampler.lock().map_err(|e| e.to_string())?.as_ref() {
    let mut res = resampler_arc.lock().map_err(|e| e.to_string())?;
    res.clear();
  }
  Ok(())
}

#[tauri::command]
pub fn create_playlist(name: String, state: State<AppState>) -> Result<i64, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  db.create_playlist(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_playlists(state: State<AppState>) -> Result<Vec<UiPlaylist>, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  let rows = db.get_playlists().map_err(|e| e.to_string())?;
  Ok(rows
    .into_iter()
    .map(|(id, name, track_count)| UiPlaylist { id, name, track_count: track_count as _ })
    .collect())
}

#[tauri::command]
pub fn add_track_to_playlist(playlist_id: i64, track_id: i64, state: State<AppState>) -> Result<(), String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  db.add_track_to_playlist(playlist_id, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_playlist_tracks(state: State<AppState>, playlist_id: i64) -> Result<Vec<UiTrack>, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  let rows = db.get_playlist_tracks(playlist_id).map_err(|e| e.to_string())?;
  let mut tracks = Vec::with_capacity(rows.len());
  for (file_path, title, artist, sample_rate, duration_secs, cover_path) in rows {
    tracks.push(UiTrack {
      id: 0,
      file_path,
      title,
      artist,
      album: String::new(),
      genre: None,
      sample_rate,
      bit_depth: 0,
      channels: 0,
      duration_secs,
      cover_path,
      lyrics: None,
    });
  }
  Ok(tracks)
}

#[tauri::command]
pub fn toggle_like_track(track_id: i64, state: State<AppState>) -> Result<bool, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  let liked_id = db.get_or_create_liked_playlist().map_err(|e| e.to_string())?;
  db.toggle_track_in_playlist(liked_id, track_id)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_track_liked(track_id: i64, state: State<AppState>) -> Result<bool, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  let liked_id = db.get_or_create_liked_playlist().map_err(|e| e.to_string())?;
  db.is_track_in_playlist(liked_id, track_id)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_playlist(playlist_id: i64, state: State<AppState>) -> Result<(), String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  db.delete_playlist(playlist_id).map_err(|e| e.to_string())
}
