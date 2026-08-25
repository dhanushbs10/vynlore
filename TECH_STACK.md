# Vynlore Audio — Tech Stack & Architecture

## What Is Vynlore

Vynlore is a **local desktop music player** for Windows (macOS/Linux portable in principle) that plays audio files (FLAC, WAV, AIFF, MP3, M4A/AAC/ALAC, OGG Vorbis) from folders on your hard drive — lossless-first. The frontend is a React app rendered in a Tauri webview window. The backend is Rust: audio playback, file scanning, metadata extraction, and a SQLite library database. No server, no cloud, no network dependency once built.

---

## The Big Picture

```
User's Music Folder
  |  (FLAC files, embedded cover art + lyrics tags)
  v
Rust Backend  ── Tauri IPC/events ──>  React Frontend
  |                                        |
  +-- Lofty       reads tags               +-- React 18 + TypeScript (strict)
  +-- notify      watches folder changes   +-- Plain-CSS design system (variables.css)
  +-- walkdir     recursive scanning       +-- PlayerContext (single playback store)
  +-- rusqlite    library DB (WAL)         +-- invoke() commands / listen() events
   +-- Symphonia   decodes any supported container -> f32
   +-- rubato      resamples (decoder thread)
   +-- cpal        realtime output callback (shared mode)
   +-- windows     WASAPI exclusive output (bit-perfect)
  v
SQLite (library.db in OS app-data dir)      Speakers / Audio Device
```

---

## Layer 1: Desktop Shell (Tauri v2)

Tauri uses the OS webview (**WebView2** on Windows). The React app calls `invoke("command", args)`; Rust `#[tauri::command]` fns return `Result<T, String>`, serialized back as JSON Promises. Backend → frontend push happens through named events (`watcher-event`, `playback-ended`) via `listen()`.

- **Entry point:** `src-tauri/src/main.rs` — builds the Tauri app, opens the DB, manages `AppState`, registers all commands, runs the startup scan + watcher if a watched folder is configured.
- **Config:** `src-tauri/tauri.conf.json` — window 1200×800 "Vynlore", dev port 1420, asset protocol enabled (for cover art via `convertFileSrc`).

---

## Layer 2: Rust Backend

### 2a. Global State (`state.rs`)

```rust
AppState {
    db: Arc<Mutex<LibraryDb>>,            // SQLite connection
    playback: Mutex<Option<PlaybackHandle>>, // active playback engine handle (None = idle)
    volume: Arc<AtomicU32>,               // volume as raw f32 bits; read by the RT callback
    current_path: Mutex<Option<PathBuf>>, // what file is playing
}
```

The volume atomic is the single source of truth for gain: the audio callback reads it lock-free every buffer, and IPC writes it with `f32::to_bits`. `PlaybackHandle` is a cheap cloneable controller (`Arc<ControlBlock>`); dropping it requests engine shutdown.

### 2b. Audio Pipeline (`audio/`)

The design rule: **no decoding, resampling, or locking on the realtime thread.** A dedicated decoder thread produces samples into a queue; the cpal callback only pops and multiplies.

**Playback engine (`audio/player.rs`)**

- `start(path, device_index, exclusive, db_volume)`:
  1. Opens the audio file with Symphonia (container probed from extension; FLAC/WAV/AIFF/MP3/M4A/OGG enabled).
  2. Chooses the output backend:
     - **Exclusive** (Windows, when requested): probes the endpoint with the file's *native* format via WASAPI (`IsFormatSupported` in `AUDCLNT_SHAREMODE_EXCLUSIVE`). On success the whole engine runs at file rate/channels — **no mixer, no resampler**. Failure logs and falls back to shared mode silently.
     - **Shared** (default): picks device/config via `output::find_best_config` (device sample rate wins; channels matched to the file).
  3. Creates the shared `ControlBlock` (`paused`, `stop`, `ended_emitted`, `seek_to: Option<f64>`, frame counters, boundary markers, `next_file`), the bounded `SampleQueue`, and the backend stream.
  4. Spawns the **decoder thread** only after the backend opens successfully (a failed open can't strand a blocked producer).
- Returns `(PlaybackHandle, exclusive_active)`; `request_stop()`, `request_seek(secs)` just flip atomics/options; `set_next(path)` arms gapless continuation. `Drop` stops the engine.

**Bit-perfect exclusive output (`audio/wasapi.rs`, Windows)**

- Event-driven render thread: `IAudioClient::Initialize(EXCLUSIVE, EVENTCALLBACK)` with 10× device-period buffering, retrying once with the aligned size on `AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED`.
- Format negotiation: ≤16-bit files open as native i16 frames; 20/24-bit as i32 containers with `wValidBitsPerSample` set and samples left-justified (`WAVEFORMATEXTENSIBLE`, PCM SubFormat GUID).
- Lossless roundtrip: Symphonia's normalized f32 has a 24-bit mantissa, so f32→int conversion is bit-exact for any source ≤24-bit. At volume 1.0 the multiply is skipped entirely for a pure passthrough path.
- Pause = `client.Stop()`/`Reset()`/`Start()`; consumption accounting goes through the same `ControlBlock::consume_frames` as the cpal callback, so position tracking, gapless boundaries, and underrun-free queue behavior are identical across backends.
- Device index parity with cpal holds because cpal's default host **is** WASAPI and iterates the same endpoint collection.

**Gapless transitions**

Track changes happen inside one continuous stream — no teardown, no IPC roundtrip:

1. The frontend keeps the backend's next-track slot in sync (`queue_next_track`) based on the visible queue + repeat mode, skipping chaining when channel layouts differ.
2. When the decoder hits EOF, it splices the queued file into the *same* pipeline immediately — FIFO queue order preserves audio continuity, so there is no wait and no gap.
3. A **boundary marker** (absolute consumed-frame count) is recorded at the splice point. The realtime callback flips the audible position exactly when the new file's first sample plays, and flags a pending change.
4. The decoder thread observes that flag off the RT thread and emits `track-changed { path }`; the frontend maps the path back to its queue to swap metadata, cover art, and lyrics.
5. If no next track was armed, EOF drains normally and emits `playback-ended`. Incompatible channel counts fall back to a clean stop/start transition.

Position tracking is frame-exact across seams: position = (`frames_played` − `track_start_frame`) / output_rate, where `track_start_frame` is rewritten at each crossed boundary (and on seeks).

**Decoder thread**

- Loop: check stop/pause/seek control flags each packet.
- Decode one frame → interleaved `Vec<f32>` (Symphonia's `SampleBuffer<f32>` already normalizes to −1..1 for any bit depth — no manual rescaling). The decoder layer (`decoder/audio.rs`) is container-agnostic: `open_audio`/`decode_packet`/`seek` work identically for lossless and lossy inputs, which also means gapless chaining works across formats when channel counts match (e.g. FLAC → WAV).
- If file rate ≠ output rate, feed **rubato** `SincFixedIn<f32>` (sinc_len 256, Blackman-Harris² window, cubic interpolation, 1024-frame input chunks). Resampling happens here, off the RT thread. At EOF, `process_partial(None)` flushes the resampler tail so the last samples aren't dropped.
- **Equalizer (`audio/eq.rs`)**: after resampling, before the queue push (both in `pump()` and the EOF tail flush), a 10-band graphic EQ is applied on this same decoder thread — never the RT thread. RBJ-cookbook biquads (low-shelf → peaking ×8, Q = 1.1 → high-shelf) at 31 Hz … 16 kHz, Direct Form I, ±12 dB. `SharedEq` (`Arc<Mutex<EqSettings>>`) lives on `AppState`, so `update_eq` mutates settings live; each `Pipeline`'s `EqProcessor` caches coefficients keyed by (output rate, gains snapshot) and clears filter state when disabled/neutral or on seek.
- Push into the `SampleQueue`; when drained at EOF, emit `playback-ended` exactly once (guarded by an atomic flag).
- Seek path: set `seek_to` on the control block → decoder performs an accurate Symphonia seek, calls `resampler.reset()`, clears the queue.

**Sample queue (`audio/queue.rs`)**

Bounded `Mutex<VecDeque<f32>>` + `Condvar`. Decoder blocks (100 ms wait_timeout slices) when full — natural backpressure. Callback does non-blocking `pop_available`. Underruns are counted, not crashed on.

**Output (`audio/output.rs`)**

Thin cpal wrapper: `start(config, device, callback)` and `select_device_by_number(1-based index)` matching the `list_devices` order shown in the UI.

### 2c. Tauri IPC Commands (`commands.rs`)

| Command | What it does |
|---|---|
| `get_tracks` | All tracks as `UiTrack[]` (incl. genre, track_number, cover_path, lyrics) |
| `list_devices` | Audio output devices as `UiDevice[]` |
| `scan_folder(path)` | One-shot scan of a directory into the DB |
| `set_watched_folder(path)` | Persists config, restarts watcher, background-scans |
| `get_watched_folder` | Reads persisted folder |
| `start_watcher(folder)` | (Re)starts the debounced FS watcher |
| `rescan_folder(path)` | Background re-scan (used by tests/manual triggers) |
| `play_track(filePath, deviceIndex?, exclusive?) -> bool` | Starts the playback engine; returns whether exclusive mode actually engaged |
| `pause_playback` / `resume_playback` | Atomics on the control block |
| `stop_playback` | Drops the handle → engine shutdown |
| `seek_playback(seekSecs)` | Accurate Symphonia seek + pipeline reset |
| `get_position` | Current position in seconds (frame-exact across gapless seams) |
| `queue_next_track(nextPath?)` | Arms/clears the gapless next-track slot |
| `set_volume(volume)` | 0.0–1.0 → f32 bits into the atomic |
| `update_eq(enabled, gains[10])` | Live EQ: enable flag + per-band gains (clamped ±12 dB) into `AppState.eq`; pipelines pick it up on the next decoder chunk |
| `create_playlist(name)` | New playlist |
| `get_playlists` | Playlists with track counts |
| `add_track_to_playlist(playlistId, trackId)` | Append (dedup-safe, `INSERT OR IGNORE`) |
| `remove_track_from_playlist(playlistId, trackId)` | Remove |
| `get_playlist_tracks(playlistId)` | Full track rows in position order |
| `get_playlist_name(playlistId)` | Playlist title |
| `toggle_like_track(trackId)` | Add/remove in the protected "Liked Songs" playlist |
| `is_track_liked(trackId)` | Like state |
| `delete_playlist(playlistId)` | Deletes (refuses "Liked Songs") |
| `queue_next_track(nextPath?)` | Arms/clears the gapless next-track slot |
| `increment_play_count(filePath)` | Bumps play_count/last_played (called on every track start, incl. gapless chains) |
| `get_recently_played(limit?)` | Tracks ordered by last_played desc |

**Events emitted by the backend:**
- `watcher-event` `{ title, artist, count }` — scan progress/completion and file-change batches.
- `playback-ended` — natural end of the final queued track (frontend applies repeat logic).
- `track-changed` `{ path }` — playback audibly crossed into a gapless-chained file.
- `media-key` `"play-pause" \| "next" \| "prev"` — hardware media keys (global-shortcut plugin, registered Rust-side at startup).

### 2d. Library System (`library/`)

**Database (`db.rs`)** — SQLite in WAL mode:

```sql
tracks(id, file_path UNIQUE, title, artist, album, genre,
       sample_rate, bit_depth, channels, duration_secs,
       track_number, disc_number, watched_folder, cover_path, lyrics,
       play_count DEFAULT 0, last_played, format)
playlists(id, name UNIQUE, created_at)
playlist_tracks(playlist_id, track_id, position)   -- unique(track_id, playlist_id)
```

Indexes on album/artist/genre/last_played and playlist position. Schema migration dedupes existing playlist rows before creating the unique constraint. Shared `UPSERT_TRACK_SQL` used everywhere.

**Scanner (`scanner.rs`)** — recursive `walkdir` matching the supported-extension table in `metadata.rs` (FLAC/WAV/AIFF/MP3/M4A/OGG); collects entries first, then upserts inside a transaction committed every 200 files (fast on big libraries); progress callback emits UI events. Each row stores a `format` label derived from the extension.

**Metadata (`metadata.rs`)** — Lofty reads Vorbis comments (title/artist/album/genre/track/duration/lyrics). Cover art is extracted and cached under a content hash filename (`{hash16}.png/jpg`), so identical art across an album is stored once and unchanged files skip rewrites.

**Watcher (`watcher.rs`)** — one global watcher slot (`OnceLock`). Changing folders drops the old watcher and stops its worker (no thread leaks). notify events only enqueue paths with timestamps; a worker thread debounces (800 ms quiet period, 250 ms poll), upserts affected files, and emits one batched `watcher-event`.

### 2e. Errors (`error.rs`)

Small `AudioError` enum (`DecodingError`, `OutputError`, `FileError`, `ConfigError`) with `Display` + `From<io::Error>`; errors are stringified at the Tauri boundary.

---

## Layer 3: Frontend

### 3a. Tooling & Styling

Vite 5 + TypeScript 5 (strict). Styling is a hand-rolled dark design system in plain CSS (`src/styles/variables.css` tokens: `--bg-deep/base/raised/hover`, `--accent #6cb4ee`, `--accent-warm #d4a373`, text tiers, radii) — no Tailwind, no component library. Icons: lucide-react.

### 3b. State Management (`context/PlayerContext.tsx`)

Single React Context provider, no Redux/Zustand. Owns:

- Library/queue state: `libraryTracks`, `displayedTracks` (= play queue), `currentTrackIndex`
- Playback state: `currentTrack`, `isPlaying`, `isPaused`, `currentTime`, `volume`, `isShuffle`, `repeatMode` ("off"/"all"/"one"), `selectedDevice`

Key behaviors:

- **Position:** polls `get_position` every 250 ms while playing (backend counts frames on the RT thread). Outside Tauri (pure browser dev), a simulated timer stands in.
- **Track end:** listens for `playback-ended`; repeat-one replays, otherwise advances through the queue (wrapping on repeat-all, stopping at the end). Mid-queue transitions are gapless via the backend chain; the UI follows `track-changed` events.
- **Gapless sync:** an effect mirrors the visible queue + repeat mode into `queue_next_track` (clearing it for repeat-one or channel-mismatched neighbors).
- **Volume:** persisted to localStorage (`vynlore.volume`, default 0.8) and mirrored into the backend atomic on change/startup.
- **Equalizer:** `eqEnabled` / `eqGains[10]` / `eqAuto` persisted to `vynlore.eq`; every change invokes `update_eq` (and once at startup). **Auto-match genre:** when a track with a recognized genre starts (or auto is toggled on mid-track), the mapped preset from `audio/eqPresets.ts` applies automatically; manual band edits or preset clicks take over until the next genre change. UI lives in the `EqPanel` drawer (sidebar button), vertical range sliders + preset chips + power/reset.
- **Seek:** optimistic local time update + `seek_playback(seekSecs)`.
- **Shuffle:** Fisher-Yates preserving the current track at index 0; pre-shuffle order kept in a ref so toggling off restores the original queue. Shared util in `utils/shuffle.ts`.
- Shared formatting helpers live in `utils/format.ts` (`formatDuration`, `formatSampleRate`, `hasCover`); canonical types in `types.ts`.

### 3c. Views & Routing

String-based view switching in `App.tsx` (no router): `now` (HomeView), `browse` (TracksView), albums/artists/genres + their detail views, playlists + playlist detail. Library loads once from `get_tracks`; `watcher-event`s trigger incremental reloads. Startup scanning is owned entirely by the backend — the frontend never triggers a redundant scan.

All views render real DB data with deterministic ordering (artist→album→track number), proper empty states, and no mock content.

**Global search:** Ctrl+K opens a command-palette overlay (`SearchPalette`) searching tracks/artists/albums/genres with full keyboard navigation (↑↓ Enter Esc); Enter plays a track or jumps to its detail view. Also reachable from the sidebar button.

**Keyboard shortcuts:** Space play/pause, ←/→ seek ±5 s, Ctrl+←/→ prev/next track (suppressed while typing in inputs).

**Queue:** right-hand panel shows upcoming tracks; drag-and-drop reorders via `reorderQueue` in context (current-track index is remapped by id, and the gapless-sync effect re-arms the backend slot).

**Stats:** every track start — manual or gapless-chained — bumps `play_count`/`last_played`; Home shows a Recently Played row refreshed on each track change.

**OS integration:** hardware media keys are registered at startup (Rust-side, global-shortcut plugin) and forwarded as `media-key` events; selected output device and volume persist across restarts (localStorage with backend fallback if a device disappears); the window title mirrors "Artist – Title · Vynlore".

### 3d. Data Flow: Playing a Track

1. Click → `PlayerContext.playTrack(track, queue)` → updates context state.
2. `invoke("stop_playback")` then `invoke("play_track", { filePath, deviceIndex })`.
3. Backend starts the engine: decode thread → queue → cpal callback → speakers.
4. Frontend polls `get_position` for the progress bar; on `playback-ended`, applies repeat logic.
5. Volume slider writes the backend atomic (lock-free RT read) + localStorage.

---

## Layer 4: Build & Release

Development: `npm run dev` (Vite on :1420) + `npm run tauri dev`. Production: `npm run build` (tsc + vite) then `npm run tauri build`.

Release profile: `opt-level = 3`, `lto = true`, `codegen-units = 1`, `panic = "abort"`.

---

## Key Dependencies

| Crate | Purpose |
|---|---|
| `cpal 0.15` | Cross-platform audio I/O (shared mode) |
| `windows 0.58` | WASAPI exclusive output (`Win32_Media_Audio` + COM/threading) |
| `symphonia 0.5` (flac, wav, aiff, pcm, adpcm, mp3, aac, alac, isomp4, ogg, vorbis) | Multi-container demux + decode → f32 |
| `rubato 0.14` | Sinc resampling on the decoder thread |
| `lofty 0.8` | Tag/metadata reading |
| `rusqlite 0.30` (bundled) | SQLite library DB |
| `notify 8` | Filesystem watching |
| `walkdir 2.5` | Recursive scans |
| `tauri 2` (+dialog, global-shortcut plugins) | Shell, IPC, native pickers, media keys |

| JS Package | Purpose |
|---|---|
| `react` / `react-dom` | UI |
| `@tauri-apps/api` | `invoke`, `listen`, `convertFileSrc` |
| `@tauri-apps/plugin-dialog` | Folder picker |
| `lucide-react` | Icons |
| `vite` + `typescript` | Build toolchain |

---

## Known Gaps (roadmap)

- Opus decode (Symphonia 0.5 demuxes .opus but has no codec; excluded from scanning)
- Gapless is same-channel-count only (mismatched layouts take the clean restart path)
- Exclusive mode is format-gated per device (e.g. a 48 kHz-only endpoint refuses 44.1 kHz files → silent shared fallback); no automatic rate-matching retry
- No replay-gain / loudness normalization yet (the 10-band EQ shipped; auto-genre preset matching included)
- No play-count analytics beyond Recently Played (no top-charts/stats view)
- Single-window UI; no mini-player
