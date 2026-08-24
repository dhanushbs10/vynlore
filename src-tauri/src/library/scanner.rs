use walkdir::WalkDir;
use crate::library::db::LibraryDb;
use crate::library::metadata;

pub fn scan_folder(db: &LibraryDb, folder_path: &std::path::Path) -> Result<usize, Box<dyn std::error::Error>> {
  scan_folder_with_progress(db, folder_path, |_| {})
}

pub fn scan_folder_with_progress<F>(
  db: &LibraryDb,
  folder_path: &std::path::Path,
  mut on_progress: F,
) -> Result<usize, Box<dyn std::error::Error>>
where
  F: FnMut(usize),
{
  let mut count = 0;
  let folder_str = folder_path.to_string_lossy().to_string();

  println!("Scanning folder: {}", folder_str);

  for entry in WalkDir::new(folder_path)
    .into_iter()
    .filter_map(|e| e.ok())
  {
    let path = entry.path();

    if path.extension().and_then(|e| e.to_str()) == Some("flac") {
      match metadata::read_metadata(path) {
        Ok(mut meta) => {
          let file_path_str = path.to_string_lossy().to_string();

          if meta.genre.is_empty() {
            meta.genre = metadata::infer_genre_from_path(path, folder_path).to_string();
          }

          db.upsert_track(
            &file_path_str,
            &meta.title,
            &meta.artist,
            &meta.album,
            &meta.genre,
            meta.sample_rate,
            meta.bit_depth,
            meta.channels,
            meta.duration_secs,
            meta.track_number,
            meta.disc_number,
            &folder_str,
            &meta.cover_path,
            &meta.lyrics,
          )?;

          count += 1;
          on_progress(count);

          if count % 50 == 0 {
            println!("Scanned {} tracks...", count);
          }
        }
        Err(e) => {
          eprintln!("Warning: Failed to read {:?}: {}", path, e);
        }
      }
    }
  }

  println!("Scan complete! Added/Updated {} tracks.", count);
  Ok(count)
}
