use std::sync::atomic::{AtomicBool, Ordering};
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
  // Headless exclusive-mode self test: `vynlore-audio --excl-test`
  if std::env::args().any(|a| a == "--excl-test") {
    #[cfg(windows)]
    crate::audio::wasapi::run_diagnostic_sine();
    return;
  }

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin({
      use std::str::FromStr;
      use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};
      let play_pause = Shortcut::from_str("MediaPlayPause").unwrap();
      let next = Shortcut::from_str("MediaTrackNext").unwrap();
      let prev = Shortcut::from_str("MediaTrackPrevious").unwrap();
      match tauri_plugin_global_shortcut::Builder::new()
        .with_shortcuts(["MediaPlayPause", "MediaTrackNext", "MediaTrackPrevious"])
        .and_then(|b| Ok(b))
      {
        Ok(b) => b
          .with_handler(move |app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
              return;
            }
            let key = if shortcut == &play_pause {
              "play-pause"
            } else if shortcut == &next {
              "next"
            } else if shortcut == &prev {
              "prev"
            } else {
              return;
            };
            use tauri::Emitter;
            let _ = app.emit("media-key", key);
          })
          .build(),
        Err(e) => {
          eprintln!("Media key registration unavailable: {}", e);
          tauri_plugin_global_shortcut::Builder::new().build()
        }
      }
    })
    .setup(|app| {
      let db_path = match app.path().app_data_dir() {
        Ok(dir) => dir.join("library.db"),
        Err(e) => { eprintln!("Failed to get app data dir: {}", e); return Ok(()); }
      };
      if let Some(parent) = db_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
          eprintln!("Failed to create data dir: {}", e);
          return Ok(());
        }
      }
      let db = LibraryDb::new(&db_path).expect("Failed to open database");

      let cover_dir = db_path.parent().unwrap_or(&db_path).join("covers");
      if let Err(e) = std::fs::create_dir_all(&cover_dir) {
        eprintln!("Failed to create cover dir: {}", e);
      }

      // Migrate cover art from old cache dir to new app data dir
      if let Some(old_cache) = dirs::cache_dir() {
        let old_dir = old_cache.join("vynlore-art");
        if old_dir.is_dir() {
          let new_dir = cover_dir.clone();
          match std::fs::read_dir(&old_dir) {
            Ok(entries) => {
              let mut moved = 0u32;
              for entry in entries.flatten() {
                let src = entry.path();
                if src.is_file() {
                  let file_name = src.file_name().unwrap();
                  let dst = new_dir.join(file_name);
                  if !dst.exists() {
                    if std::fs::rename(&src, &dst).is_ok() {
                      moved += 1;
                    }
                  }
                }
              }
              if moved > 0 {
                println!("Migrated {} cover art files to app data dir", moved);
              }
              // Update DB cover_path references from old dir to new dir
              let old_prefix = old_dir.to_string_lossy().to_string();
              let new_prefix = new_dir.to_string_lossy().to_string();
              let _ = db.conn.execute(
                "UPDATE tracks SET cover_path = REPLACE(cover_path, ?1, ?2) WHERE cover_path LIKE ?3",
                rusqlite::params![old_prefix, new_prefix, format!("{}%", old_prefix)],
              );
              let _ = db.conn.execute(
                "UPDATE playlists SET cover_path = REPLACE(cover_path, ?1, ?2) WHERE cover_path LIKE ?3",
                rusqlite::params![old_prefix, new_prefix, format!("{}%", old_prefix)],
              );
              let _ = std::fs::remove_dir_all(&old_dir);
            }
            Err(e) => eprintln!("Failed to read old cover dir: {}", e),
          }
        }
      }

      // Files deleted/moved while the app was off would otherwise linger as
      // unplayable ghost entries.
      match db.prune_missing_files() {
        Ok(n) if n > 0 => println!("Pruned {} missing track(s) from library", n),
        Ok(_) => {}
        Err(e) => eprintln!("Library prune failed: {}", e),
      }

      let state = AppState {
        db: std::sync::Arc::new(std::sync::Mutex::new(db)),
        playback: std::sync::Mutex::new(None),
        volume: std::sync::Arc::new(std::sync::atomic::AtomicU32::new(1.0f32.to_bits())),
        eq: crate::audio::eq::shared_eq(),
        spectrum: std::sync::Arc::new(crate::audio::spectrum::SpectrumAnalyzer::new()),
        balance: std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0.0f32.to_bits())),
        preamp: std::sync::Arc::new(std::sync::atomic::AtomicU32::new(1.0f32.to_bits())),
        cover_dir: cover_dir.clone(),
      };
      app.manage(state);

      let spectrum = app.state::<AppState>().spectrum.clone();
      let app_handle_clone = app.handle().clone();
      let spectrum_running = std::sync::Arc::new(AtomicBool::new(true));
      let spectrum_running_clone = spectrum_running.clone();
      std::thread::Builder::new()
        .name("vynlore-spectrum".into())
        .spawn(move || {
          while spectrum_running_clone.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(33));
            spectrum.compute();
            let bins = spectrum.snapshot();
            let _ = app_handle_clone.emit(
              "spectrum-data",
              crate::audio::spectrum::SpectrumPayload { bins },
            );
          }
        })
        .expect("failed to spawn spectrum thread");

      if let Ok(Some(folder)) = commands::get_watched_folder(app.handle().clone()) {
        let db = app.state::<AppState>().db.clone();
        let folder_path = folder.clone();
        let app_handle = app.handle().clone();
        let cover_dir_scan = cover_dir.clone();
        let _ = std::thread::Builder::new()
          .name("vynlore-startup-scan".into())
          .spawn(move || {
          let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if let Ok(db) = db.lock() {
              scan_folder_internal(&db, std::path::Path::new(&folder_path), &cover_dir_scan, |count| {
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

          match result {
            Ok(Ok(count)) => {
              let _ = app_handle.emit("watcher-event", WatcherEvent {
                title: "Startup scan complete".to_string(),
                artist: folder_path,
                count,
              });
            }
            Ok(Err(e)) => {
              eprintln!("Startup scan error: {}", e);
            }
            Err(e) => {
              eprintln!("Startup scan panic: {:?}", e);
            }
          }
        });

        if let Err(e) = commands::start_watcher(folder, app.handle().clone(), app.state::<AppState>()) {
          eprintln!("Failed to start watcher: {}", e);
        }
      }

      // Handle file association: if launched with an audio file path, emit it to frontend
      let audio_exts = ["flac","wav","wave","aiff","aif","mp3","m4a","m4b","ogg","oga","opus","wma","ape","wv","dsf","dff"];
      for arg in std::env::args().skip(1) {
        if let Some(ext) = std::path::Path::new(&arg)
          .extension()
          .and_then(|e| e.to_str())
        {
          if audio_exts.contains(&ext.to_lowercase().as_str()) {
            let _ = app.emit("open-file", arg);
            break;
          }
        }
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::get_tracks,
      commands::list_devices,
      commands::scan_folder,
      commands::start_watcher,
      commands::set_volume,
      commands::set_balance,
      commands::set_preamp,
      commands::pause_playback,
      commands::resume_playback,
      commands::play_track,
      commands::stop_playback,
      commands::seek_playback,
      commands::get_position,
      commands::update_eq,
      commands::queue_next_track,
      commands::increment_play_count,
      commands::get_recently_played,
      commands::create_playlist,
      commands::get_playlists,
      commands::add_track_to_playlist,
      commands::remove_track_from_playlist,
      commands::get_playlist_tracks,
      commands::get_playlist_name,
      commands::toggle_like_track,
      commands::is_track_liked,
      commands::get_watched_folder,
      commands::set_watched_folder,
      commands::rescan_folder,
      commands::delete_playlist,
      commands::rename_playlist,
      commands::set_playlist_cover,
      commands::get_playlist_cover,
      commands::set_playlist_color,
      commands::get_playlist_color,
      commands::get_waveform,
      commands::read_text_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
