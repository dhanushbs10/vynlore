use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;

use crate::library::db::{LibraryDb, StashedTrackState};
use crate::library::metadata;

const DEBOUNCE: Duration = Duration::from_millis(800);
const POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, serde::Serialize)]
pub struct WatcherEvent {
    pub title: String,
    pub artist: String,
    pub count: usize,
    #[serde(default)]
    pub total: Option<usize>,
    /// "scan" for scanner lifecycle/progress, "library" for watcher file
    /// add/remove batches. The frontend routes on this instead of sniffing
    /// titles (a track literally named "Scanner" used to hijack scan UI).
    #[serde(default)]
    pub kind: Option<String>,
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
	// Recently deleted rows, kept briefly so a file that vanishes and comes
	// straight back (tag editor atomic save, temp-file replace) regains its
	// likes, play counts, loudness analysis and waveform instead of starting
	// over as a brand-new row.
	let mut stash: HashMap<PathBuf, (Instant, StashedTrackState)> = HashMap::new();
	std::thread::Builder::new()
		.name("vynlore-watch".into())
		.spawn(move || {
			loop {
				if worker_stop.load(std::sync::atomic::Ordering::SeqCst) {
					break;
				}
				std::thread::sleep(POLL_INTERVAL);
				stash.retain(|_, (seen, _)| seen.elapsed() < Duration::from_secs(120));

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
						let key = path.to_string_lossy().to_string();
						if let Some(state) = db.stash_track_state(&key) {
							stash.insert(path.clone(), (Instant::now(), state));
						}
						match db.remove_track_by_path(&key) {
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
								// New files get the same loudness analysis as scanned
								// ones so ReplayGain stays consistent within a session
								// (the scanner skips re-analysis only when a gain is
								// already stored).
								let key = path.to_string_lossy().to_string();
								let existing_gain = db.get_replaygain(&key).unwrap_or((None, None, None));
								let (gain, peak) = match existing_gain.0 {
									Some(g) => (Some(g), existing_gain.2),
									None => match crate::audio::replaygain::analyze(&path) {
										Ok(res) => (Some(res.track_gain_db), Some(res.track_peak)),
										Err(e) => {
											eprintln!("Warning: loudness analysis failed for {:?}: {}", path, e);
											(None, None)
										}
									},
								};
								let folder_str = root.to_string_lossy().to_string();
								let (mtime, size) = metadata::file_signature(&path);
								if let Err(e) = db.conn.execute(
									crate::library::db::UPSERT_TRACK_SQL,
									rusqlite::params![
										key,
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
										gain,
										peak,
										meta.bitrate as i64,
										mtime,
										size,
									],
								) {
									eprintln!("DB update failed for {:?}: {}", path, e);
								} else {
									added.push((meta.title, meta.artist));
									// File came back after a brief delete (editor
									// save): restore likes/counts/analysis/waveform.
									if let Some((seen, state)) = stash.remove(&path) {
										if seen.elapsed() < Duration::from_secs(120) {
											let _ = db.restore_track_state(&key, &state);
										}
									}
								}
							}
							Err(e) => eprintln!("Warning: failed to read added file {:?}: {}", path, e),
						}
					}
				}

				if !added.is_empty() {
					// A newcomer can shift its album's mean gain — refresh.
					if let Ok(dbg) = db.lock() {
						let _ = dbg.recompute_album_gains();
					}
					let count = added.len();
					let titles: Vec<String> = added.into_iter().map(|(t, _)| t).collect();
					let _ = app_for_worker.emit(
						"watcher-event",
					WatcherEvent {
                            title: titles.join(", "),
                            artist: root.to_string_lossy().to_string(),
                            count,
                            total: None,
                            kind: Some("library".to_string()),
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
                            total: None,
                            kind: Some("library".to_string()),
                        },
					);
				}
			}
		})?;

	Ok(())
}
