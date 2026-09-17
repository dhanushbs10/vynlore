//! Windows taskbar media controls (SMTC) via `souvlaki`.
//!
//! The OS only allows one `MediaControls` handle per window, attached once at
//! startup. Commands push metadata/playback updates through a leaked
//! `&'static mut` handle (the process lives as long as the player), and OS
//! events are forwarded on the same IPC the global media shortcuts use so the
//! frontend handles play/pause/next/prev identically.

use souvlaki::{
  MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

pub static ENABLED: AtomicBool = AtomicBool::new(true);

static CONTROLS: OnceLock<Mutex<Option<&'static mut MediaControls>>> = OnceLock::new();

fn with_controls<F: FnOnce(&mut MediaControls)>(f: F) {
  if let Some(m) = CONTROLS.get() {
    if let Ok(mut guard) = m.lock() {
      if let Some(c) = guard.as_mut() {
        f(c);
      }
    }
  }
}

/// Attach to Windows' system media transport controls. Call once at startup
/// (a second call is a no-op so a duplicate attach can never double events).
pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
  if CONTROLS.get().is_some() {
    return Ok(());
  }  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "main window not found for SMTC".to_string())?;

  use raw_window_handle::{HasWindowHandle, RawWindowHandle};
  let raw = window.window_handle().map_err(|e| e.to_string())?;
  let hwnd: *mut std::ffi::c_void = match raw.as_raw() {
    RawWindowHandle::Win32(win) => win.hwnd.get() as *mut std::ffi::c_void,
    _ => return Err("not a Win32 window — SMTC unavailable".to_string()),
  };

  let config = PlatformConfig {
    display_name: "Vynlore",
    dbus_name: "host.vynlore.vynlore-audio",
    hwnd: Some(hwnd),
  };

  let mut controls = MediaControls::new(config).map_err(|e| e.to_string())?;

  let app = app.clone();
  controls
    .attach(move |event| match event {
      MediaControlEvent::Play
      | MediaControlEvent::Pause
      | MediaControlEvent::Toggle
      | MediaControlEvent::Stop => {
        let _ = app.emit("media-key", "play-pause");
      }
      MediaControlEvent::Next => {
        let _ = app.emit("media-key", "next");
      }
      MediaControlEvent::Previous => {
        let _ = app.emit("media-key", "prev");
      }
      MediaControlEvent::Seek(direction) => {
        let delta = match direction {
          souvlaki::SeekDirection::Backward => -10.0,
          souvlaki::SeekDirection::Forward => 10.0,
        };
        let _ = app.emit("smtc-seek-by", delta);
      }
      MediaControlEvent::SeekBy(direction, dur) => {
        let delta = match direction {
          souvlaki::SeekDirection::Backward => -(dur.as_secs_f64()),
          souvlaki::SeekDirection::Forward => dur.as_secs_f64(),
        };
        let _ = app.emit("smtc-seek-by", delta);
      }
      MediaControlEvent::SetPosition(pos) => {
        // Scrubber drags report an absolute position (seconds since start).
        let _ = app.emit("smtc-seek", pos.0.as_secs_f64());
      }
      MediaControlEvent::Raise => {
        if let Some(w) = app.get_webview_window("main") {
          let _ = w.show();
          let _ = w.set_focus();
        }
      }
      MediaControlEvent::Quit => {
        if let Some(w) = app.get_webview_window("main") {
          let _ = w.destroy();
        }
      }
      _ => {}
    })
    .map_err(|e| e.to_string())?;

  // The handle must outlive every command; leak it exactly once.
  let leaked: &'static mut MediaControls = Box::leak(Box::new(controls));
  let _ = CONTROLS.set(Mutex::new(Some(leaked)));
  Ok(())
}

pub fn set_enabled(enabled: bool) {
  ENABLED.store(enabled, Ordering::Relaxed);
  with_controls(|c| {
    // When disabled hide the OS controls by dropping to a stopped state and
    // clearing metadata; when re-enabled the next metadata push repaints them.
    if !enabled {
      let _ = c.set_playback(MediaPlayback::Stopped);
      let _ = c.set_metadata(MediaMetadata {
        title: None,
        album: None,
        artist: None,
        cover_url: None,
        duration: None,
      });
    }
  });
}

pub fn set_metadata(
  title: &str,
  artist: &str,
  album: &str,
  cover_path: Option<&str>,
  duration_secs: f64,
  playing: bool,
) {
  if !ENABLED.load(Ordering::Relaxed) {
    return;
  }
  let cover_url = cover_path.filter(|p| std::path::Path::new(p).is_file()).map(|p| {
    // Windows SMTC loads a file:// URI automatically; percent-encode what a
    // raw Windows path would otherwise mangle (spaces survive, # and ? don't).
    let forward = p.replace('\\', "/");
    format!("file:///{}", forward)
  });
  with_controls(|c| {
    let meta = MediaMetadata {
      title: Some(title),
      album: Some(album),
      artist: Some(artist),
      cover_url: cover_url.as_deref(),
      duration: Some(std::time::Duration::from_secs_f64(duration_secs.max(0.0))),
    };
    let _ = c.set_metadata(meta);
    let _ = c.set_playback(if playing {
      MediaPlayback::Playing { progress: None }
    } else {
      MediaPlayback::Paused { progress: None }
    });
  });
}

#[tauri::command]
pub fn set_smtc_enabled(enabled: bool) {
  set_enabled(enabled);
}

#[tauri::command]
pub fn update_smtc_metadata(
  title: String,
  artist: String,
  album: String,
  cover_path: Option<String>,
  duration_secs: f64,
  playing: bool,
) {
  set_metadata(&title, &artist, &album, cover_path.as_deref(), duration_secs, playing);
}