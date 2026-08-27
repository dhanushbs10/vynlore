use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;

use crate::library::db::LibraryDb;
use crate::library::metadata;

const DEBOUNCE: Duration = Duration::from_millis(800);
const POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, serde::Serialize)]
pub struct WatcherEvent {
	pub title: String,
	pub artist: String,
	pub count: usize,
}

fn watcher_slot() -> &'static Mutex<Option<(RecommendedWatcher, Arc<std::sync::atomic::AtomicBool>)>> {
	static SLOT: OnceLock<
		Mutex<Option<(RecommendedWatcher, Arc<std::sync::atomic::AtomicBool>)>>,
	> = OnceLock::new();
	SLOT.get_or_init(|| Mutex::new(None))
}

pub fn start_watcher(
	app: tauri::AppHandle,
	db: Arc<Mutex<LibraryDb>>,
	folder_path: &Path,
	cover_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
	let mut slot = watcher_slot().lock().unwrap_or_else(|e| e.into_inner());
	if let Some((_, stop_flag)) = slot.take() {
		stop_flag.store(true, std::sync::atomic::Ordering::SeqCst);
	}

	let pending: Arc<Mutex<HashMap<PathBuf, Instant>>> = Arc::new(Mutex::new(HashMap::new()));
	let removals: Arc<Mutex<HashMap<PathBuf, Instant>>> = Arc::new(Mutex::new(HashMap::new()));
	let root = folder_path.to_path_buf();
	let cover_dir_owned = cover_dir.to_path_buf();

	let cb_pending = pending.clone();
	let cb_removals = removals.clone();
	let mut watcher: RecommendedWatcher = RecommendedWatcher::new(
		move |res: Result<notify::Event, notify::Error>| {
			if let Ok(event) = res {
				if !matches!(
					event.kind,
					EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
				) {
					return;
				}
				let is_removal = matches!(event.kind, EventKind::Remove(_));
				let now = Instant::now();
				let mut map = cb_pending.lock().unwrap_or_else(|e| e.into_inner());
				for path in event.paths {
					let supported = path
						.extension()
						.and_then(|e| e.to_str())
						.map_or(false, |e| metadata::is_supported_extension(e));
					if !supported {
						continue;
					}
					if is_removal {
						// A vanished file cancels any queued add for it.
						map.remove(&path);
						cb_removals.lock().unwrap_or_else(|e| e.into_inner()).insert(path, now);
					} else if path.is_file() {
						// It's back (or still there) — drop queued removals.
						cb_removals.lock().unwrap_or_else(|e| e.into_inner()).remove(&path);
						map.insert(path, now);
					}
				}
			}
		},
		Config::default(),
	)?;

	watcher.watch(folder_path, RecursiveMode::Recursive)?;
	println!("Watching folder: {:?}", folder_path);

	let worker_stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
	*slot = Some((watcher, worker_stop.clone()));
	drop(slot);

	let app_for_worker = app;
	std::thread::Builder::new()
		.name("vynlore-watch".into())
		.spawn(move || {
			loop {
				if worker_stop.load(std::sync::atomic::Ordering::SeqCst) {
					break;
				}
				std::thread::sleep(POLL_INTERVAL);

				let due: Vec<PathBuf> = {
					let mut map = pending.lock().unwrap_or_else(|e| e.into_inner());
					let cutoff = Instant::now() - DEBOUNCE;
					let expired: Vec<PathBuf> = map
						.iter()
						.filter(|(_, seen)| **seen < cutoff)
						.map(|(p, _)| p.clone())
						.collect();
					for p in &expired {
						map.remove(p);
					}
					expired
				};

				let due_removed: Vec<PathBuf> = {
					let mut map = removals.lock().unwrap_or_else(|e| e.into_inner());
					let cutoff = Instant::now() - DEBOUNCE;
					let expired: Vec<PathBuf> = map
						.iter()
						.filter(|(_, seen)| **seen < cutoff)
						.map(|(p, _)| p.clone())
						.collect();
					for p in &expired {
						map.remove(p);
					}
					expired
				};

				if due.is_empty() && due_removed.is_empty() {
					continue;
				}

				let mut added: Vec<(String, String)> = Vec::new();
				let mut removed_count = 0usize;
				if let Ok(db) = db.lock() {
					for path in due_removed {
						match db.remove_track_by_path(&path.to_string_lossy()) {
							Ok(n) => removed_count += n,
							Err(e) => eprintln!("DB remove failed for {:?}: {}", path, e),
						}
					}
					for path in due {
						match metadata::read_metadata(&path, &cover_dir_owned) {
							Ok(mut meta) => {
								if meta.genre.is_empty() {
									meta.genre =
										metadata::infer_genre_from_path(&path, &root).to_string();
								}
								let folder_str = root.to_string_lossy().to_string();
								if let Err(e) = db.upsert_track(
									&path.to_string_lossy(),
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
								&meta.format,
							) {
									eprintln!("DB update failed for {:?}: {}", path, e);
								} else {
									added.push((meta.title, meta.artist));
								}
							}
							Err(_) => {}
						}
					}
				}

				if !added.is_empty() {
					let count = added.len();
					let titles: Vec<String> = added.into_iter().map(|(t, _)| t).collect();
					let _ = app_for_worker.emit(
						"watcher-event",
						WatcherEvent {
							title: titles.join(", "),
							artist: root.to_string_lossy().to_string(),
							count,
						},
					);
				}

				if removed_count > 0 {
					// Frontend treats "removed" specially: refresh, no toast.
					let _ = app_for_worker.emit(
						"watcher-event",
						WatcherEvent {
							title: "removed".to_string(),
							artist: root.to_string_lossy().to_string(),
							count: removed_count,
						},
					);
				}
			}
		})?;

	Ok(())
}
