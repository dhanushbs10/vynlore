#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri::Emitter;
mod commands;
mod audio;
mod decoder;
mod error;
mod library;
mod smtc;
mod state;

use state::AppState;
use library::db::LibraryDb;
use library::scanner::scan_folder_with_progress as scan_folder_internal;

/// Per-process preference switches the frontend sets via commands.
pub static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);
pub static NOTIFY_TRACK_CHANGE: AtomicBool = AtomicBool::new(true);

/// Post a notification about the track now playing, but only when the window
/// is unfocused and track notifications are enabled — a gapless boundary
/// otherwise spams the action center on every track.
pub fn notify_track_change(app: &tauri::AppHandle, title: &str, artist: &str, album: &str) {
  if !NOTIFY_TRACK_CHANGE.load(Ordering::Relaxed) {
    return;
  }
  if let Some(w) = app.get_webview_window("main") {
    if w.is_focused().unwrap_or(false) {
      return;
    }
  }
  use tauri_plugin_notification::NotificationExt;
  let body = if artist.is_empty() && album.is_empty() {
    "Now playing".to_string()
  } else if artist.is_empty() {
    format!("{}\nNow playing", album)
  } else if album.is_empty() {
    format!("{}\nNow playing", artist)
  } else {
    format!("{} – {}\nNow playing", artist, album)
  };
  let _ = app
    .notification()
    .builder()
    .title(title.to_string())
    .body(body)
    .show();
}
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
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        // Default behaviour: minimize to the tray instead of quitting, so
        // playback keeps the library alive in the background. The tray
        // "Quit" item bypasses this via app.exit().
        if CLOSE_TO_TRAY.load(Ordering::Relaxed) {
          let _ = window.hide();
          api.prevent_close();
        }
      }
    })
    .plugin({
      use std::str::FromStr;
      use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};
      let play_pause = Shortcut::from_str("MediaPlayPause").expect("valid media-key shortcut");
      let next = Shortcut::from_str("MediaTrackNext").expect("valid media-key shortcut");
      let prev = Shortcut::from_str("MediaTrackPrevious").expect("valid media-key shortcut");
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
        Err(e) => panic!("Failed to get app data dir (cannot run without state): {}", e),
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

      // The asset protocol scope check canonicalizes the requested path, and on
      // Windows canonicalize produces a `\\?\` verbatim prefix that never matches
      // the static `$APPDATA/**/*` glob in tauri.conf.json, so cover art 403s in
      // packaged builds. Register the canonicalized cover directory in the runtime
      // asset scope so existing cover files on disk actually resolve.
      {
        let scope = app.asset_protocol_scope();
        match std::fs::canonicalize(&cover_dir) {
          Ok(canon) => {
            if let Err(e) = scope.allow_directory(&canon, true) {
              eprintln!("Failed to allow cover dir in asset scope: {}", e);
            }
          }
          Err(e) => eprintln!("Failed to canonicalize cover dir for asset scope: {}", e),
        }
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
      // unplayable ghost entries. Guard: if a folder IS configured but its
      // drive/path is unreachable right now (unplugged USB, sleeping NAS),
      // pruning would nuke the entire library including likes and playlists —
      // skip it instead of destroying data.
      let watched_gone = commands::get_watched_folder(app.handle().clone())
        .map(|opt| opt.map(|f| !std::path::Path::new(&f).is_dir()).unwrap_or(false))
        .unwrap_or(false);
      if watched_gone {
        eprintln!("Watched folder unreachable — skipping library prune to protect data");
      } else {
        match db.prune_missing_files() {
          Ok(n) if n > 0 => println!("Pruned {} missing track(s) from library", n),
          Ok(_) => {}
          Err(e) => eprintln!("Library prune failed: {}", e),
        }
      }

      let state = AppState {
        db: std::sync::Arc::new(std::sync::Mutex::new(db)),
        playback: std::sync::Mutex::new(None),
        volume: std::sync::Arc::new(std::sync::atomic::AtomicU32::new(1.0f32.to_bits())),
        eq: crate::audio::eq::shared_eq(),
        spectrum: std::sync::Arc::new(crate::audio::spectrum::SpectrumAnalyzer::new()),
        balance: std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0.0f32.to_bits())),
        preamp: std::sync::Arc::new(std::sync::atomic::AtomicU32::new(1.0f32.to_bits())),
        replaygain_mode: std::sync::Arc::new(std::sync::atomic::AtomicU32::new(1)),
        playback_rate: std::sync::Arc::new(std::sync::atomic::AtomicU32::new(1.0f32.to_bits())),
        pitch_semitones: std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0.0f32.to_bits())),
        crossfade: std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0.0f32.to_bits())),
        cover_dir: cover_dir.clone(),
      };
      app.manage(state);

      // Windows taskbar / SMTC media controls. Failure is non-fatal (e.g.
      // non-Windows or a missing window) but Vynlore is Windows-only anyway.
      if let Err(e) = crate::smtc::start(app.handle()) {
        eprintln!("SMTC unavailable: {}", e);
      }

      // System tray: playback control + app lifecycle. The tray always exists
      // so playback can be controlled and relaunched with no visible window
      // (close-to-tray is the default close behaviour above).
      {
        use tauri::menu::{Menu, MenuItem};
        use tauri::tray::TrayIconBuilder;
        let show = MenuItem::with_id(app, "show", "Show Vynlore", true, None::<&str>)?;
        let play_pause =
          MenuItem::with_id(app, "play-pause", "Play / Pause", true, None::<&str>)?;
        let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
        let prev = MenuItem::with_id(app, "prev", "Previous", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &play_pause, &next, &prev, &quit])?;
        let mut builder = TrayIconBuilder::new()
          .menu(&menu)
          .show_menu_on_left_click(false)
          .tooltip("Vynlore")
          .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
              if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
              }
            }
            "play-pause" | "next" | "prev" => {
              let _ = app.emit("media-key", event.id.as_ref());
            }
            "quit" => app.exit(0),
            _ => {}
          });
        if let Some(icon) = app.default_window_icon() {
          builder = builder.icon(icon.clone());
          let _ = builder.build(app);
        } else {
          // No embedded icon available; a tray icon is mandatory on Windows,
          // so fall back to the bundled 512px PNG.
          use tauri::image::Image;
          if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/icon.png").as_slice()) {
            let _ = builder.icon(icon).build(app);
          }
        }
      }

      let spectrum = app.state::<AppState>().spectrum.clone();
      let app_handle_clone = app.handle().clone();
      let spectrum_running = std::sync::Arc::new(AtomicBool::new(true));
      let spectrum_running_clone = spectrum_running.clone();
      std::thread::Builder::new()
        .name("vynlore-spectrum".into())
        .spawn(move || {
          // Only keep emitting while audio is actually reaching the analyzer.
          // When playback goes idle, send one all-zero frame so the UI bars
          // fall silent, then stop emitting entirely (saves a cold ~30fps IPC).
          let mut was_active = false;
          while spectrum_running_clone.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(33));
            let active = spectrum.is_active();
            let bins = if active {
              spectrum.compute();
              spectrum.snapshot()
            } else if was_active {
              vec![0.0; 64]
            } else {
              continue;
            };
            let (peak, clipped) = spectrum.levels();
            let _ = app_handle_clone.emit(
              "spectrum-data",
              crate::audio::spectrum::SpectrumPayload { bins, peak, clipped },
            );
            was_active = active;
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
            scan_folder_internal(
              db.as_ref(),
              std::path::Path::new(&folder_path),
              &cover_dir_scan,
              |count, total| {
                if count == 0 || count % 50 == 0 {
                  let _ = app_handle.emit("watcher-event", WatcherEvent {
                    title: "Startup scan...".to_string(),
                    artist: folder_path.clone(),
                    count,
                    total: Some(total),
                    kind: Some("scan".to_string()),
                  });
                }
              },
            )
          }));

          match result {
            Ok(Ok(count)) => {
              // Drop tracks from a previously configured folder that is no
              // longer watched (folder switched while the app was off).
              if let Ok(dbg) = db.lock() {
                if let Err(e) = dbg.remove_tracks_not_in_folder(&folder_path) {
                  eprintln!("Failed to prune old-folder tracks: {}", e);
                }
              }
              let _ = app_handle.emit("watcher-event", WatcherEvent {
                title: "Startup scan complete".to_string(),
                artist: folder_path,
                count,
                total: None,
                kind: Some("scan".to_string()),
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

      // Handle file association: if launched with an audio file path, emit it
      // to the frontend. Only associations the engine can actually decode are
      // accepted (see metadata.rs SUPPORTED_EXTENSIONS — no Opus/WMA/APE/etc.).
      let audio_exts = ["flac", "wav", "wave", "aiff", "aif", "aifc", "mp3", "m4a", "m4b", "ogg", "oga"];
      for arg in std::env::args().skip(1) {
        if let Some(ext) = std::path::Path::new(&arg)
          .extension()
          .and_then(|e| e.to_str())
        {
          if audio_exts.contains(&ext.to_lowercase().as_str()) {
            // This runs in setup(), before the webview has registered its
            // "open-file" listener — defer the emit so it isn't lost. Emit
            // twice (fast + slow boot cover); the frontend dedups by path.
            let app_for_emit = app.handle().clone();
            std::thread::spawn(move || {
              std::thread::sleep(std::time::Duration::from_millis(1200));
              let _ = app_for_emit.emit("open-file", arg.clone());
              std::thread::sleep(std::time::Duration::from_millis(2800));
              let _ = app_for_emit.emit("open-file", arg);
            });
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
      commands::set_playback_rate,
      commands::set_pitch_semitones,
      commands::set_crossfade,
      commands::set_replaygain_mode,
      commands::pause_playback,
      smtc::set_smtc_enabled,
      smtc::update_smtc_metadata,
      commands::set_close_to_tray,
      commands::get_close_to_tray,
      commands::set_notify_track,
      commands::get_notify_track,
      commands::notify_now_playing,
      commands::set_autostart,
      commands::get_autostart,
      commands::read_playlist_file,
      commands::write_playlist_file,
      commands::edit_tags,
      commands::resume_playback,
      commands::play_track,
      commands::stop_playback,
      commands::seek_playback,
      commands::get_position,
      commands::update_eq,
      commands::queue_next_track,
      commands::increment_play_count,
      commands::add_external_track,
      commands::get_recently_played,
      commands::get_recently_added,
      commands::get_top_played,
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
      commands::read_text_file,
      commands::list_theme_files,
      commands::save_theme_file,
      commands::delete_theme_file,
      commands::export_theme_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
