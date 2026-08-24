use notify::{RecommendedWatcher, RecursiveMode, Watcher, Config, EventKind};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

use crate::library::db::LibraryDb;
use crate::library::metadata;

#[derive(Clone, serde::Serialize)]
pub struct WatcherEvent {
	pub title: String,
	pub artist: String,
	pub count: usize,
}

pub fn start_watcher(app: tauri::AppHandle, db: Arc<Mutex<LibraryDb>>, folder_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
	let folder_path_buf = folder_path.to_path_buf();
	let folder_path_for_watch = folder_path.to_path_buf();

	let last_added = Arc::new(Mutex::new(None::<(String, Instant)>));
	let batch = Arc::new(Mutex::new(Vec::new()));

	std::thread::spawn(move || {
		// Clone handles for the watcher closure so the loop below keeps the originals
		let closure_batch = Arc::clone(&batch);
		let closure_last = Arc::clone(&last_added);
		let closure_db = Arc::clone(&db);
		let closure_path_buf = folder_path_buf.clone();
		let closure_path_for_watch = folder_path_for_watch.clone();

		let mut watcher = match RecommendedWatcher::new(
			move |res: Result<notify::Event, notify::Error>| {
				if let Ok(event) = res {
					let is_create_or_modify = matches!(
						event.kind,
						EventKind::Create(_) | EventKind::Modify(_)
					);

					if is_create_or_modify {
						for path in event.paths {
							if path.extension().and_then(|e| e.to_str()) != Some("flac") {
								continue;
							}

							let file_path_str = path.to_string_lossy().to_string();

							let should_process = {
								let mut last = closure_last.lock().unwrap();
								match *last {
									Some((ref last_path, ref time)) => {
										if last_path == &file_path_str && time.elapsed() < Duration::from_secs(2) {
											false
										} else {
											*last = Some((file_path_str.clone(), Instant::now()));
											true
										}
									}
									None => {
										*last = Some((file_path_str.clone(), Instant::now()));
										true
									}
								}
							};

							if !should_process { continue; }

							std::thread::sleep(Duration::from_millis(500));

							match metadata::read_metadata(&path) {
								Ok(mut meta) => {
									let folder_str = closure_path_buf.to_string_lossy().to_string();

                  if meta.genre.is_empty() {
                    meta.genre = metadata::infer_genre_from_path(&path, &closure_path_buf).to_string();
                  }

									if let Ok(db) = closure_db.lock() {
										if let Err(e) = db.upsert_track(
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
										) {
											eprintln!("DB update failed: {}", e);
										} else {
											let mut b = closure_batch.lock().unwrap();
											b.push((meta.title.clone(), meta.artist.clone()));
										}
									}
								}
								Err(_) => {}
							}
						}
					}
				}
			},
			Config::default(),
		) {
			Ok(w) => w,
			Err(e) => {
				eprintln!("Error creating file watcher: {}", e);
				return;
			}
		};

		if let Err(e) = watcher.watch(&folder_path_for_watch, RecursiveMode::Recursive) {
			eprintln!("Error watching directory: {}", e);
			return;
		}

		println!("Watching folder: {:?}", folder_path_for_watch);

		loop {
			std::thread::sleep(Duration::from_secs(3));
			let mut b = batch.lock().unwrap();
			if !b.is_empty() {
				let count = b.len();
				let titles: Vec<String> = b.iter().map(|(t, _)| t.clone()).collect();
				let _ = app.emit("watcher-event", WatcherEvent {
					title: titles.join(", "),
					artist: b[0].1.clone(),
					count,
				});
				b.clear();
			}
		}
	});

	Ok(())
}