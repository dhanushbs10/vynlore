use tauri::Manager;
use tauri::Emitter;
mod commands;
mod audio;
mod decoder;
mod error;
mod library;
mod state;

use state::AppState;
use library::db::LibraryDb;
use library::scanner::scan_folder_with_progress as scan_folder_internal;
use library::watcher::WatcherEvent;

fn main() {
tauri::Builder::default()
.plugin(tauri_plugin_dialog::init())
.setup(|app| {
  let db_path = app.path().app_data_dir().expect("Failed to get app data dir").join("library.db");
  std::fs::create_dir_all(db_path.parent().unwrap()).expect("Failed to create data dir");
  let db = LibraryDb::new(&db_path).expect("Failed to open database");

  let state = AppState {
    db: std::sync::Arc::new(std::sync::Mutex::new(db)),
    output: std::sync::Mutex::new(None),
    decoder: std::sync::Mutex::new(None),
    resampler: std::sync::Mutex::new(None),
    volume: std::sync::Arc::new(std::sync::Mutex::new(1.0)),
    current_path: std::sync::Mutex::new(None),
    current_device: std::sync::Mutex::new(None),
    audio_format: std::sync::Mutex::new(None),
  };
  app.manage(state);

  if let Ok(Some(folder)) = commands::get_watched_folder(app.handle().clone()) {
    let db = app.state::<AppState>().db.clone();
    let folder_path = folder.clone();
    let app_handle = app.handle().clone();
    std::thread::spawn(move || {
      let scan_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if let Ok(db) = db.lock() {
          scan_folder_internal(&db, std::path::Path::new(&folder_path), |count| {
            if count % 50 == 0 {
              let _ = app_handle.emit("watcher-event", WatcherEvent {
                title: "Startup scan...".to_string(),
                artist: folder_path.clone(),
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
          let _ = app_handle.emit("watcher-event", WatcherEvent {
            title: "Startup scan complete".to_string(),
            artist: folder_path.clone(),
            count,
          });
        }
        Ok(Err(e)) => {
          let _ = app_handle.emit("watcher-event", WatcherEvent {
            title: "Startup scan failed".to_string(),
            artist: folder_path.clone(),
            count: 0,
          });
          eprintln!("Startup scan error: {}", e);
        }
        Err(e) => {
          let _ = app_handle.emit("watcher-event", WatcherEvent {
            title: "Startup scan panic".to_string(),
            artist: folder_path.clone(),
            count: 0,
          });
          eprintln!("Startup scan panic: {:?}", e);
        }
      }
    });
    let _ = commands::start_watcher(folder, app.handle().clone(), app.state::<AppState>().clone());
  }

  Ok(())
})
.invoke_handler(tauri::generate_handler![
  commands::get_tracks,
  commands::list_devices,
  commands::scan_folder,
  commands::start_watcher,
  commands::set_volume,
  commands::pause_playback,
  commands::resume_playback,
  commands::play_track,
  commands::stop_playback,
  commands::seek_playback,
  commands::create_playlist,
  commands::get_playlists,
  commands::add_track_to_playlist,
  commands::get_playlist_tracks,
  commands::toggle_like_track,
  commands::is_track_liked,
  commands::get_watched_folder,
  commands::set_watched_folder,
  commands::rescan_folder,
  commands::delete_playlist
])
.run(tauri::generate_context!())
.expect("error while running tauri application");
}