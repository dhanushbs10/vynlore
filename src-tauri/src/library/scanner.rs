use walkdir::WalkDir;

use crate::library::db::{LibraryDb, UPSERT_TRACK_SQL};
use crate::library::metadata;

const BATCH_SIZE: usize = 200;

pub fn scan_folder_with_progress<F>(
  db: &LibraryDb,
  folder_path: &std::path::Path,
  cover_dir: &std::path::Path,
  mut on_progress: F,
) -> Result<usize, Box<dyn std::error::Error>>
where
  F: FnMut(usize),
{
  let mut count = 0;
  let folder_str = folder_path.to_string_lossy().to_string();

  println!("Scanning folder: {}", folder_str);

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
  let mut tx = db.conn.unchecked_transaction()?;

  for entry in entries {
    let path = entry.path();

    match metadata::read_metadata(path, cover_dir) {
      Ok(mut meta) => {
        let file_path_str = path.to_string_lossy().to_string();

        if meta.genre.is_empty() {
          meta.genre = metadata::infer_genre_from_path(path, folder_path).to_string();
        }

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
          ],
        ) {
          eprintln!("Warning: failed to upsert {:?}: {}", path, e);
          continue;
        }

        count += 1;
        on_progress(count);

        if count % BATCH_SIZE == 0 {
          tx.commit()?;
          println!("Scanned {} / {} tracks...", count, total);
          tx = db.conn.unchecked_transaction()?;
        }
      }
      Err(e) => {
        eprintln!("Warning: Failed to read {:?}: {}", path, e);
      }
    }
  }

  tx.commit()?;
  println!("Scan complete! Added/Updated {} tracks.", count);
  Ok(count)
}
