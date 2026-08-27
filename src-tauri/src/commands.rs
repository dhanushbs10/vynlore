use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::thread;

use cpal::traits::{DeviceTrait, HostTrait};

use tauri::{Emitter, Manager, State};

use crate::audio::player;
use crate::library::scanner::scan_folder_with_progress as scan_folder_internal;
use crate::library::watcher::{start_watcher as spawn_watcher, WatcherEvent};
use crate::state::AppState;

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
  pub track_number: i64,
  pub disc_number: i64,
  pub cover_path: Option<String>,
  pub lyrics: Option<String>,
  pub format: String,
  pub play_count: i64,
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
  pub cover_path: Option<String>,
  pub color: Option<String>,
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
  write_config(&app, &AppConfig { watched_folder: Some(path.clone()) })?;

  spawn_watcher(app.clone(), state.db.clone(), Path::new(&path), &state.cover_dir).map_err(|e| e.to_string())?;

  let db = state.db.clone();
  let app_for_emit = app.clone();
  let cover_dir_scan = state.cover_dir.clone();
  thread::spawn(move || {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
      if let Ok(db) = db.lock() {
        scan_folder_internal(&db, Path::new(&path), &cover_dir_scan, |count| {
          if count % 50 == 0 {
            let _ = app_for_emit.emit("watcher-event", WatcherEvent {
              title: "Scanning...".to_string(),
              artist: path.clone(),
              count,
            });
          }
        })
      } else {
        Err("Failed to lock DB for scan".into())
      }
    }));

    match result {
      Ok(Ok(count)) => {
        let _ = app_for_emit.emit("watcher-event", WatcherEvent {
          title: "Scan complete".to_string(),
          artist: path,
          count,
        });
      }
      Ok(Err(e)) => {
        let _ = app_for_emit.emit("watcher-event", WatcherEvent {
          title: "Scan failed".to_string(),
          artist: String::new(),
          count: 0,
        });
        eprintln!("Background scan error: {}", e);
      }
      Err(e) => {
        eprintln!("Background scan panic: {:?}", e);
      }
    }
  });

  Ok(())
}

#[tauri::command]
pub fn rescan_folder(path: String, app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
  let db = state.db.clone();
  let cover_dir_scan = state.cover_dir.clone();
  thread::spawn(move || {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
      if let Ok(db) = db.lock() {
        scan_folder_internal(&db, Path::new(&path), &cover_dir_scan, |_| {})
      } else {
        Err("Failed to lock DB for scan".into())
      }
    }));

    match result {
      Ok(Ok(count)) => {
        let _ = app.emit("watcher-event", WatcherEvent {
          title: "Rescan complete".to_string(),
          artist: String::new(),
          count,
        });
      }
      Ok(Err(e)) => {
        eprintln!("Background rescan error: {}", e);
      }
      Err(e) => {
        eprintln!("Background rescan panic: {:?}", e);
      }
    }
  });
  Ok(())
}

#[tauri::command]
pub fn get_tracks(state: State<AppState>) -> Result<Vec<UiTrack>, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  let mut stmt = db.conn.prepare("SELECT id, file_path, title, artist, album, genre, sample_rate, bit_depth, channels, duration_secs, COALESCE(track_number,0), COALESCE(disc_number,0), COALESCE(cover_path,''), COALESCE(lyrics,''), COALESCE(NULLIF(format,''), 'FLAC'), COALESCE(play_count,0) FROM tracks ORDER BY id DESC").map_err(|e| e.to_string())?;
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
      track_number: row.get(10)?,
      disc_number: row.get(11)?,
      cover_path: if row.get::<_, String>(12)?.is_empty() { None } else { Some(row.get(12)?) },
      lyrics: if row.get::<_, String>(13)?.is_empty() { None } else { Some(row.get(13)?) },
      format: row.get(14)?,
      play_count: row.get(15)?,
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
  let count = scan_folder_internal(&db, Path::new(&path), &state.cover_dir, |_| {}).map_err(|e| e.to_string())?;
  Ok(count)
}

#[tauri::command]
pub fn start_watcher(path: String, app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
  spawn_watcher(app, state.db.clone(), Path::new(&path), &state.cover_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_volume(volume: f64, state: State<AppState>) -> Result<(), String> {
  let clamped = volume.clamp(0.0, 1.0) as f32;
  state.volume.store(clamped.to_bits(), Ordering::Relaxed);
  Ok(())
}

#[tauri::command]
pub fn set_balance(balance: f64, state: State<AppState>) -> Result<(), String> {
  let clamped = balance.clamp(-1.0, 1.0) as f32;
  state.balance.store(clamped.to_bits(), Ordering::Relaxed);
  Ok(())
}

#[tauri::command]
pub fn set_preamp(preamp: f64, state: State<AppState>) -> Result<(), String> {
  let clamped = preamp.clamp(0.5, 2.0) as f32;
  state.preamp.store(clamped.to_bits(), Ordering::Relaxed);
  Ok(())
}

#[tauri::command]
pub fn pause_playback(state: State<AppState>) -> Result<(), String> {
  if let Some(control) = state.active_control() {
    control.paused.store(true, Ordering::Relaxed);
  }
  Ok(())
}

#[tauri::command]
pub fn resume_playback(state: State<AppState>) -> Result<(), String> {
  if let Some(control) = state.active_control() {
    control.paused.store(false, Ordering::Relaxed);
  }
  Ok(())
}

#[tauri::command]
pub fn play_track(
  file_path: String,
  device_index: Option<usize>,
  exclusive: Option<bool>,
  app: tauri::AppHandle,
  state: State<AppState>,
) -> Result<bool, String> {
  let path = PathBuf::from(&file_path);
  if !path.exists() {
    return Err("File not found".to_string());
  }

  // Atomic take-start-store under the lock to prevent two concurrent
  // play_track calls from interleaving. The old handle is dropped after
  // releasing the lock so the 15ms Drop sleep doesn't block other commands.
  let (handle, exclusive_active, old_handle);
  {
    let mut guard = state.playback.lock().map_err(|e| e.to_string())?;
    old_handle = guard.take();
    let result = player::start(
      &path,
      device_index,
      exclusive.unwrap_or(false),
      state.volume.clone(),
      state.eq.clone(),
      state.spectrum.clone(),
      state.balance.clone(),
      state.preamp.clone(),
      app,
      0.0,
    );
    let r = result?;
    exclusive_active = r.1;
    handle = r.0;
    *guard = Some(handle);
  }
  // Old playback stopped outside the lock so other commands aren't blocked.
  drop(old_handle);
  Ok(exclusive_active)
}

#[tauri::command]
pub fn stop_playback(state: State<AppState>) -> Result<(), String> {
  if let Some(handle) = state.playback.lock().map_err(|e| e.to_string())?.take() {
    handle.request_stop();
  }
  Ok(())
}

#[tauri::command]
pub fn seek_playback(seek_secs: f64, state: State<AppState>) -> Result<(), String> {
  let guard = state.playback.lock().map_err(|e| e.to_string())?;
  if let Some(handle) = guard.as_ref() {
    handle.request_seek(seek_secs.max(0.0));
  }
  Ok(())
}

#[tauri::command]
pub fn get_position(state: State<AppState>) -> Result<f64, String> {
  Ok(state
    .active_control()
    .map_or(0.0, |control| control.position_secs()))
}

#[tauri::command]
pub fn update_eq(
  enabled: bool,
  gains: Vec<f32>,
  parametric: Option<bool>,
  qs: Option<Vec<f32>>,
  band_hz: Option<Vec<f32>>,
  bass_boost_db: Option<f64>,
  treble_boost_db: Option<f64>,
  state: State<AppState>,
) -> Result<(), String> {
  let band_count = gains.len();
  if band_count < crate::audio::eq::MIN_BAND_COUNT || band_count > crate::audio::eq::MAX_BAND_COUNT {
    return Err(format!(
      "expected {}-{} EQ bands, got {}",
      crate::audio::eq::MIN_BAND_COUNT,
      crate::audio::eq::MAX_BAND_COUNT,
      band_count
    ));
  }
  let mut eq = state.eq.lock().map_err(|e| e.to_string())?;
  eq.enabled = enabled;
  eq.gains = gains
    .into_iter()
    .map(|g| g.clamp(-crate::audio::eq::EQ_MAX_GAIN_DB, crate::audio::eq::EQ_MAX_GAIN_DB))
    .collect();
  if let Some(p) = parametric {
    eq.parametric = p;
  }
  if let Some(q) = qs {
    eq.qs = q
      .into_iter()
      .map(|v| v.clamp(0.3, 10.0))
      .collect();
  }
  if let Some(hz) = band_hz {
    eq.band_hz = hz;
  }
  if let Some(bass) = bass_boost_db {
    eq.bass_boost_db = (bass as f32).clamp(-crate::audio::eq::EQ_MAX_BOOST_DB, crate::audio::eq::EQ_MAX_BOOST_DB);
  }
  if let Some(treble) = treble_boost_db {
    eq.treble_boost_db = (treble as f32).clamp(-crate::audio::eq::EQ_MAX_BOOST_DB, crate::audio::eq::EQ_MAX_BOOST_DB);
  }
  Ok(())
}

#[tauri::command]
pub fn queue_next_track(next_path: Option<String>, state: State<AppState>) -> Result<(), String> {
  let guard = state.playback.lock().map_err(|e| e.to_string())?;
  if let Some(handle) = guard.as_ref() {
    handle.set_next(next_path.map(PathBuf::from));
  }
  Ok(())
}

#[tauri::command]
pub fn increment_play_count(file_path: String, state: State<AppState>) -> Result<(), String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  db.increment_play_count(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recently_played(limit: Option<u32>, state: State<AppState>) -> Result<Vec<UiTrack>, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  let rows = db
    .recently_played(limit.unwrap_or(20))
    .map_err(|e| e.to_string())?;
  Ok(rows
    .into_iter()
    .map(|(id, file_path, title, artist, album, genre, sample_rate, bit_depth, channels, duration_secs, track_number, disc_number, cover_path, lyrics, format, play_count)| UiTrack {
      id, file_path, title, artist, album, genre, sample_rate, bit_depth, channels, duration_secs, track_number, disc_number, cover_path, lyrics, format, play_count,
    })
    .collect())
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
    .map(|(id, name, track_count, cover_path, color)| UiPlaylist { id, name, track_count: track_count as _, cover_path, color })
    .collect())
}

#[tauri::command]
pub fn get_playlist_name(playlist_id: i64, state: State<AppState>) -> Result<Option<String>, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  db.get_playlist_name(playlist_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_track_to_playlist(playlist_id: i64, track_id: i64, state: State<AppState>) -> Result<(), String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  db.add_track_to_playlist(playlist_id, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_track_from_playlist(playlist_id: i64, track_id: i64, state: State<AppState>) -> Result<(), String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  db.remove_track_from_playlist(playlist_id, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_playlist_tracks(state: State<AppState>, playlist_id: i64) -> Result<Vec<UiTrack>, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  let rows = db.get_playlist_tracks(playlist_id).map_err(|e| e.to_string())?;
  Ok(rows
    .into_iter()
    .map(|(id, file_path, title, artist, album, genre, sample_rate, bit_depth, channels, duration_secs, track_number, disc_number, cover_path, lyrics, format, play_count)| UiTrack {
      id, file_path, title, artist, album, genre, sample_rate, bit_depth, channels, duration_secs, track_number, disc_number, cover_path, lyrics, format, play_count,
    })
    .collect())
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

#[tauri::command]
pub fn rename_playlist(playlist_id: i64, name: String, state: State<AppState>) -> Result<(), String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  db.rename_playlist(playlist_id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_playlist_cover(playlist_id: i64, cover_path: String, state: State<AppState>) -> Result<(), String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  db.set_playlist_cover(playlist_id, &cover_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_playlist_cover(playlist_id: i64, state: State<AppState>) -> Result<Option<String>, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  db.get_playlist_cover(playlist_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_playlist_color(playlist_id: i64, color: String, state: State<AppState>) -> Result<(), String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  db.set_playlist_color(playlist_id, &color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_playlist_color(playlist_id: i64, state: State<AppState>) -> Result<Option<String>, String> {
  let db = state.db.lock().map_err(|e| e.to_string())?;
  db.get_playlist_color(playlist_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_waveform(
  file_path: String,
  state: State<'_, AppState>,
) -> Result<Vec<f32>, String> {
  // 1. Check cache first.
  {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(cached) = db.get_waveform(&file_path).map_err(|e| e.to_string())? {
      return Ok(cached);
    }
  }

  // 2. Not cached — decode, store, return.
  let peaks = crate::decoder::waveform::extract_peaks(std::path::Path::new(&file_path));

  // Persist for next time.
  {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_waveform(&file_path, &peaks).map_err(|e| e.to_string())?;
  }

  Ok(peaks)
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
  // Security: only allow reading from common media/text directories.
  // This is used for AutoEQ import files — restrict to user's known paths.
  let canonical = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
  // Strip Windows UNC prefix (\\?\) so comparison with dirs:: paths works
  let canonical_str = canonical.to_string_lossy()
    .trim_start_matches(r"\\?\")
    .to_lowercase();
  let allowed = [
    dirs::download_dir().map(|p| p.to_string_lossy().to_lowercase()),
    dirs::audio_dir().map(|p| p.to_string_lossy().to_lowercase()),
    dirs::home_dir().map(|p| p.to_string_lossy().to_lowercase()),
    dirs::document_dir().map(|p| p.to_string_lossy().to_lowercase()),
    dirs::desktop_dir().map(|p| p.to_string_lossy().to_lowercase()),
  ];
  let is_allowed = allowed.iter().any(|opt| {
    if let Some(ref dir) = opt {
      canonical_str.starts_with(dir)
    } else {
      false
    }
  });
  if !is_allowed {
    return Err("Access denied: file path not in allowed directories".into());
  }
  // Limit file size to 1MB to prevent OOM
  let meta = std::fs::metadata(&canonical).map_err(|e| e.to_string())?;
  if meta.len() > 1_048_576 {
    return Err("File too large (max 1MB)".into());
  }
  std::fs::read_to_string(&canonical).map_err(|e| e.to_string())
}
