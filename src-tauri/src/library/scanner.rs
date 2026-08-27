use std::sync::Mutex;

use walkdir::WalkDir;

use crate::library::db::{LibraryDb, UPSERT_TRACK_SQL};
use crate::library::metadata;

const BATCH_SIZE: usize = 200;

/// Scans `folder_path` for supported audio files, upsampling metadata and
/// upserting rows into the library.
///
/// The slow work (walking + decoding tags + cover extraction) happens WITHOUT
/// holding the global `LibraryDb` mutex, so other commands (`get_tracks`,
/// playlists, playback bookkeeping, …) can run concurrently while a large
/// first-time scan is in progress. The mutex is only taken briefly per batch to
/// upsert rows inside a short transaction — this keeps the app responsive
/// during a big initial scan instead of freezing until every file is parsed.
///
/// `on_progress(count, total)` is invoked at the start (`0, total`) and after
/// every batch, letting callers surface a live progress bar.
pub fn scan_folder_with_progress<F>(
  db: &Mutex<LibraryDb>,
  folder_path: &std::path::Path,
  cover_dir: &std::path::Path,
  mut on_progress: F,
) -> Result<usize, Box<dyn std::error::Error>>
where
  F: FnMut(usize, usize),
{
  let folder_str = folder_path.to_string_lossy().to_string();

  println!("Scanning folder: {}", folder_str);

  // Tracks that already have loudness analysis; new files get ReplayGain
  // computed during the scan (the analysis is the one slow part that only
  // runs once per file).
  let analyzed: std::collections::HashSet<String> = {
    let db = db.lock().map_err(|_| "DB lock poisoned during scan".to_string())?;
    let mut stmt = db
      .conn
      .prepare("SELECT file_path FROM tracks WHERE track_gain IS NOT NULL")
      .map_err(|e| format!("replaygain query failed: {}", e))?;
    let rows = stmt
      .query_map([], |r| r.get::<_, String>(0))
      .map_err(|e| e.to_string())?;
    let mut set = std::collections::HashSet::new();
    for r in rows {
      if let Ok(p) = r {
        set.insert(p);
      }
    }
    set
  };

  let entries: Vec<_> = WalkDir::new(folder_path)
    .into_iter()
    .filter_map(|e| e.ok())
    .filter(|e| {
      e.path()
        .extension()
        .and_then(|ext| ext.to_str())
        .map_or(false, |ext| metadata::is_supported_extension(ext))
    })
    .collect();

  let total = entries.len();
  on_progress(0, total);

  let mut count = 0;

  for batch in entries.chunks(BATCH_SIZE) {
    // Phase 1 — metadata extraction (heavy I/O, no DB lock held).
    let mut items: Vec<(std::path::PathBuf, metadata::TrackMetadata)> = Vec::with_capacity(batch.len());
    for entry in batch {
      let path = entry.path();
      match metadata::read_metadata(path, cover_dir) {
        Ok(mut meta) => {
          if meta.genre.is_empty() {
            meta.genre = metadata::infer_genre_from_path(path, folder_path).to_string();
          }
          let file_path_str = path.to_string_lossy().to_string();
          if !analyzed.contains(&file_path_str) {
            match crate::audio::replaygain::analyze(path) {
              Ok(res) => {
                meta.track_gain = Some(res.track_gain_db);
                meta.track_peak = Some(res.track_peak);
              }
              Err(e) => eprintln!("Warning: loudness analysis failed for {:?}: {}", path, e),
            }
          }
          items.push((path.to_path_buf(), meta));
        }
        Err(e) => {
          eprintln!("Warning: Failed to read {:?}: {}", path, e);
        }
      }
    }

    // Phase 2 — brief write lock to upsert this batch in one transaction.
    {
      let db = db.lock().map_err(|_| "DB lock poisoned during scan".to_string())?;
      let mut tx = db.conn.unchecked_transaction()?;
      for (path, meta) in &items {
        let file_path_str = path.to_string_lossy().to_string();
        if let Err(e) = tx.execute(
          UPSERT_TRACK_SQL,
          rusqlite::params![
            file_path_str,
            meta.title,
            meta.artist,
            meta.album,
            meta.genre,
            meta.sample_rate,
            meta.bit_depth,
            meta.channels,
            meta.duration_secs,
            meta.track_number,
            meta.disc_number,
            folder_str,
            meta.cover_path,
            meta.lyrics,
            meta.format,
            meta.track_gain,
            meta.track_peak,
          ],
        ) {
          eprintln!("Warning: failed to upsert {:?}: {}", path, e);
          continue;
        }
      }
      tx.commit()?;
    }

    count += items.len();
    on_progress(count, total);
  }

  // Album gain = mean of the analyzed track gains within each album, so
  // album-normalized playback levels the whole release.
  {
    let db = db.lock().map_err(|_| "DB lock poisoned during scan".to_string())?;
    let _ = db.conn.execute(
      "UPDATE tracks SET album_gain = (
         SELECT AVG(track_gain) FROM tracks t2
         WHERE t2.album = tracks.album AND t2.track_gain IS NOT NULL
       ) WHERE track_gain IS NOT NULL",
      [],
    );
  }

  println!("Scan complete! Added/Updated {} tracks.", count);
  Ok(count)
}