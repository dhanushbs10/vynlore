use std::sync::Mutex;

use walkdir::WalkDir;

use crate::library::db::{LibraryDb, UPSERT_TRACK_SQL};
use crate::library::metadata;

const BATCH_SIZE: usize = 100;

/// A file that's being written right now (download in progress, tag editor
/// saving) can change length between stats — bail out so a half-written file
/// is never read, decoded, and ingested into the library.
fn write_stable(path: &std::path::Path) -> bool {
  let Ok(m1) = std::fs::metadata(path) else { return false };
  std::thread::sleep(std::time::Duration::from_millis(120));
  match std::fs::metadata(path) {
    Ok(m2) => m1.len() == m2.len(),
    Err(_) => false,
  }
}

/// Stability gate that only pays the 120 ms double-stat sleep when the file
/// was modified in the last few seconds. Sleeping unconditionally made every
/// first-time scan wait ~2 minutes per 1000 new files for no reason.
fn write_stable_if_fresh(path: &std::path::Path, mtime_secs: i64) -> bool {
  let now = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs() as i64)
    .unwrap_or(i64::MAX);
  if now.saturating_sub(mtime_secs) > 5 {
    return true;
  }
  write_stable(path)
}

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

  // Already-fully-processed files: (mtime, size) so unchanged files are skipped
  // wholesale (no tag read, no ReplayGain re-decode) on every rescan.
  let scanned: std::collections::HashMap<String, (i64, i64)> = {
    let db = db.lock().map_err(|_| "DB lock poisoned during scan".to_string())?;
    let mut out = std::collections::HashMap::new();
    let rows = db
      .get_scanned_states()
      .map_err(|e| format!("scanned-states query failed: {}", e))?;
    for (path, mtime, size) in rows {
      out.insert(path, (mtime, size));
    }
    out
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

  // Metadata extraction + loudness analysis run on a scoped worker pool
  // (phase 1); the DB write stays single-threaded per batch (phase 2). The
  // pool is what makes big first-time scans finish in minutes instead of
  // hours, and the smaller batches keep progress events flowing so the UI
  // never sits at 0 while work is happening.
  let workers = std::thread::available_parallelism()
    .map(|n| n.get())
    .unwrap_or(4)
    .clamp(2, 8);

  for batch in entries.chunks(BATCH_SIZE) {
    // Phase 1 — metadata extraction (heavy I/O, no DB lock held), in parallel.
    let mut items: Vec<(std::path::PathBuf, metadata::TrackMetadata, i64, i64)> =
      Vec::with_capacity(batch.len());
    let mut skipped = 0usize;
    std::thread::scope(|s| {
      let sub = (batch.len() + workers - 1) / workers.max(1);
      // Borrowed slices owned by this vector (not the loop) so `move`
      // closures can legally outlive each iteration — joins happen below.
      let parts: Vec<_> = batch.chunks(sub.max(1)).collect();
      let scanned_ref = &scanned;
      let mut handles = Vec::new();
      for part in parts {
        handles.push(s.spawn(move || {
          let mut local_items: Vec<(std::path::PathBuf, metadata::TrackMetadata, i64, i64)> =
            Vec::with_capacity(part.len());
          let mut local_skipped = 0usize;
          for entry in part {
            let path = entry.path();
            let file_path_str = path.to_string_lossy().to_string();
            let (mtime, size) = metadata::file_signature(path);
            // `scanned` only holds rows that already have loudness analysis,
            // so a signature hit here means fully processed: skip wholesale.
            if let Some(&(db_mtime, db_size)) = scanned_ref.get(&file_path_str) {
              if db_mtime == mtime && db_size == size {
                local_skipped += 1;
                continue;
              }
              // Changed file with an old gain: fall through to a full
              // re-read so tags AND loudness are refreshed (stale-gain fix).
            }
            // New or changed file: make sure it isn't mid-write before touching it.
            if !write_stable_if_fresh(path, mtime) {
              eprintln!("Warning: skipping {:?} (file still being written)", path);
              continue;
            }
            match metadata::read_metadata(path, cover_dir) {
              Ok(mut meta) => {
                if meta.genre.is_empty() {
                  meta.genre = metadata::infer_genre_from_path(path, folder_path).to_string();
                }
                if !scanned_ref.contains_key(&file_path_str) {
                  match crate::audio::replaygain::analyze(path) {
                    Ok(res) => {
                      meta.track_gain = Some(res.track_gain_db);
                      meta.track_peak = Some(res.track_peak);
                    }
                    Err(e) => eprintln!("Warning: loudness analysis failed for {:?}: {}", path, e),
                  }
                }
                local_items.push((path.to_path_buf(), meta, mtime, size));
              }
              Err(e) => {
                eprintln!("Warning: Failed to read {:?}: {}", path, e);
              }
            }
          }
          (local_items, local_skipped)
        }));
      }
      for h in handles {
        let (mut part_items, part_skipped) =
          h.join().map_err(|_| "scan worker thread panicked".to_string())?;
        items.append(&mut part_items);
        skipped += part_skipped;
      }
      Ok::<(), String>(())
    })?;

    // Phase 2 — brief write lock to upsert this batch in one transaction.
    {
      let db = db.lock().map_err(|_| "DB lock poisoned during scan".to_string())?;
      let tx = db.conn.unchecked_transaction()?;
      for (path, meta, mtime, size) in &items {
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
            meta.bitrate,
            mtime,
            size,
          ],
        ) {
          eprintln!("Warning: failed to upsert {:?}: {}", path, e);
          continue;
        }
      }
      tx.commit()?;
    }

    count += items.len() + skipped;
    on_progress(count, total);
  }

  // Album gain = mean of the analyzed track gains within each album, so
  // album-normalized playback levels the whole release. Same-title albums by
  // different artists stay independent; compilations level as one release.
  {
    let db = db.lock().map_err(|_| "DB lock poisoned during scan".to_string())?;
    if let Err(e) = db.recompute_album_gains() {
      eprintln!("Warning: album-gain recompute failed: {}", e);
    }
  }

  println!("Scan complete! Added/Updated {} tracks.", count);
  Ok(count)
}