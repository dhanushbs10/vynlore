# Vynlore Audio — Tech Stack & Architecture

## What Is Vynlore

Vynlore is a **desktop music player** that runs locally on Windows (and would run on macOS/Linux too). It plays FLAC (and potentially other lossless formats) from folders on your hard drive. The frontend is a React app rendered inside a Tauri window. The backend is Rust code that handles actual audio playback, file scanning, metadata extraction, and a SQLite library database. There is no server, no cloud, no network dependency once built.

---

## The Big Picture

```
User's Music Folder
  |  (FLAC files, cover art embedded in metadata)
  v
Rust Backend  ── Tauri IPC ──>  React Frontend
  |                                    |
  +-- Lofty      reads tags            +-- Tailwind CSS + React components
  +-- notify     watches for new       +-- PlayerContext (React Context)
  +-- rusqlite   stores library        +-- invoke() calls Rust commands
  +-- Symphonia  decodes FLAC
  +-- Rubato     resamples audio
  +-- cpal       sends PCM to speakers
  v
  SQLite DB (library.db in OS app data dir)
  Speakers / Audio Device
```

---

## Layer 1: The Desktop Shell (Tauri v2)

**Tauri** is an Electron alternative. Instead of shipping an entire Chromium browser (100MB+), it uses the OS's existing webview: **WebView2** on Windows (Edge's engine), WKWebView on macOS, WebKitGTK on Linux. This gives you a modern browser with much less bloat.

How it works here:
- Tauri spawns a **native window** (1200x800, title "Vynlore").
- Inside that window it loads a React app served by Vite (dev mode) or a built HTML bundle (production).
- The React app calls `invoke("some_command")` — Tauri serializes those arguments, sends them across the IPC boundary to the Rust backend.
- Rust functions marked `#[tauri::command]` receive the data, do work, return `Result<T, String>` — the result gets serialized back to JSON and arrives as a Promise in the frontend.

**Entry point:** `src-tauri/src/main.rs` — the `fn main()` that builds the Tauri app, creates `AppState`, registers all commands.

**Config:** `src-tauri/tauri.conf.json` — window size, dev port (1420), build paths.

---

## Layer 2: The Rust Backend

### 2a. Global State (`state.rs`)

`AppState` is a struct holding everything the backend needs, wrapped in `Mutex` for thread-safe mutable access from multiple IPC calls:

```
AppState
  db: Mutex<LibraryDb>            -- SQLite connection
  output: Mutex<Option<AudioOutput>>  -- active audio stream (None when nothing playing)
  decoder: Mutex<Option<Arc<Mutex<FlacDecoder>>>>  -- current file decoder
  resampler: Mutex<Option<Arc<Mutex<AudioResampler>>>>  -- resampler for rate conversion
  volume: Arc<Mutex<f32>>         -- shared volume (0.0 to 1.0)
  current_path: Mutex<Option<PathBuf>>  -- what file is playing
  current_device: Mutex<Option<usize>>  -- selected output device index
  audio_format: Mutex<Option<AudioConfig>>  -- negotiated sample rate / channels / bit depth
```

Tauri calls `app.manage(state)` to make this globally available to all command handlers via `State<AppState>`.

### 2b. The CLI Binary (`commands.rs` — also `tauri_app.rs`)

There are **two Rust binaries** in this project:

1. **`vynlore-ui`** (the Tauri app, entry point `tauri_app.rs`) — runs as a desktop GUI app.
2. **The CLI** (entry point `commands.rs`) — a standalone command-line tool you can run with flags:
   - `vynlore --scan C:\Music` — scan a folder, build the library DB
   - `vynlore --play "song name"` — search the DB and play a track
   - `vynlore --list-devices` — enumerate audio output devices
   - `vynlore --query` — print all tracks in the DB
   - `vynlore --watch C:\Music` — watch a folder for new files (background mode)
   - `vynlore somefile.flac` — play a FLAC file directly

Both binaries share the same audio engine code. The Tauri commands in `commands.rs` delegate to the same functions the CLI calls directly.

### 2c. Tauri IPC Commands (`commands.rs`)

These are the functions the React frontend can invoke:

| Command | What it does |
|---|---|
| `get_tracks` | Returns all tracks from SQLite as `UiTrack[]` |
| `list_devices` | Lists audio output devices as `UiDevice[]` |
| `scan_folder(path)` | Walks a directory, scans FLACs, populates DB, returns track count |
| `set_volume(volume)` | Sets the f32 volume (0.0–1.0) |
| `play_track(filePath, deviceIndex?)` | Opens a FLAC, decodes it, resamples, streams to speakers |
| `pause_playback()` | Pauses the audio callback |
| `resume_playback()` | Resumes the audio callback |
| `stop_playback()` | Stops audio, drops decoder/resampler/output |
| `seek_playback(seekSecs)` | Seeks the decoder to a time offset |
| `create_playlist(name)` | Creates a playlist, returns new ID |
| `get_playlists` | Returns all playlists with track counts |
| `add_track_to_playlist(playlistId, trackId)` | Adds a track to a playlist |
| `get_playlist_tracks(playlistId)` | Gets tracks in a playlist |
| `toggle_like_track(trackId)` | Adds/removes a track from a "Liked" playlist |
| `is_track_liked(trackId)` | Checks if a track is liked |
| `delete_playlist(playlistId)` | Deletes a playlist |

### 2d. The Audio Pipeline

This is the core of what makes Vynlore a music player rather than just a file browser.

**FLAC Decoding (`decoder/flac.rs`)**

Uses **Symphonia**, a Rust multimedia framework. The FLAC decoder reads the FLAC container, decompresses the audio frames, and yields raw PCM samples as `f32` (32-bit float) arrays.

Key functions:
- `open_flac(path)` → opens file, returns `(FlacDecoder, AudioFormat)` where format has sample_rate, channels, bits_per_sample, total duration.
- `decode_packet(&mut decoder)` → reads one FLAC frame, returns `Some(Vec<f32>)` or `None` at EOF.
- `fill_buffer(&mut decoder, &mut [f32])` → fills a buffer directly (no-resample path).
- `seek(&mut decoder, secs)` → seeks to a time offset.

**Audio Output (`audio/output.rs`)**

Uses **cpal** (Cross-Platform Audio Library). CPAL interacts with the OS audio subsystem — ASIO/WASAPI on Windows, CoreAudio on macOS, ALSA/PulseAudio on Linux.

The flow:
1. CPAL opens the selected audio device and requests a stream configuration.
2. The app negotiates: the device has its own preferred sample rate and channel count (e.g. 48000 Hz, stereo). The file has its own (e.g. 44100 Hz, stereo).
3. If they match → fill the output buffer directly from the decoder. Bit-perfect path.
4. If they differ → route through the resampler.
5. CPAL calls the audio callback on a real-time thread repeatedly. The callback pulls decoded samples, resamples if needed, applies volume, fills the hardware buffer.

**Resampling (`audio/resampler.rs`)**

Uses **Rubato**, a high-quality sample rate converter. When the FLAC is 44.1kHz and your speakers need 48kHz (common on Windows), Rubato buffers decoded samples and resamples them up. Same for downsampling.

The resampler acts as a FIFO:
- `add_input(&samples)` — pushes decoded PCM in
- `has_enough_for_samples(n)` — checks if enough resampled data is ready
- `get_output(&mut [f32])` — pulls resampled PCM out into the hardware buffer

**Audio Config (`audio/config.rs`)** — simple struct holding the negotiated output format.

### 2e. Volume Control

Volume is applied inside the audio callback: after resampling/buffering, every sample is multiplied by `volume` (a `f32` from 0.0 to 1.0). This happens on the audio thread so you get real-time volume changes without touching the decoder.

### 2f. Library System (`library/`)

**Database (`library/db.rs`)**

SQLite database with three tables:

```sql
tracks
  id, file_path (UNIQUE), title, artist, album, genre,
  sample_rate, bit_depth, channels, duration_secs,
  track_number, disc_number, watched_folder, cover_path

playlists
  id, name, created_at

playlist_tracks
  playlist_id, track_id, position
```

Uses WAL (Write-Ahead Logging) mode for better concurrent read performance. `cover_path` stores the filesystem path to an extracted cover art image file (PNG/JPG).

Methods: `upsert_track`, `get_all_tracks`, `search_tracks`, `get_playlists`, `create_playlist`, `add_track_to_playlist`, `get_playlist_tracks`, `get_or_create_liked_playlist`, `toggle_track_in_playlist`, `is_track_in_playlist`, `delete_playlist`.

**Metadata (`library/metadata.rs`)**

Uses **Lofty** to read audio file tags. Lofty supports FLAC (Vorbis comments), MP3 (ID3), MP4/M4A, OGG, WMA, WAV, ALAC, etc. It extracts title, artist, album, genre, track number, disc number, duration, and embedded cover art (METADATA_BLOCK_PICTURE in FLAC).

**Cover Art (`library/cover.rs`)**

Extracts the cover art image from audio file metadata, decompresses it (FLAC pictures are zlib-compressed PNG/JPEG), and saves it to disk. The `cover_path` field in the DB points to this file. The frontend loads it via Tauri's `asset://` protocol.

**Scanner (`library/scanner.rs`)**

Recursively walks a directory using `walkdir` (or `notify`'s recursive walker), identifies audio files, calls Lofty for metadata, and upserts each into SQLite.

**Watcher (`library/watcher.rs`)**

Uses the **notify** crate to watch a folder in the background. When a new file is created/modified/removed, it updates the DB automatically. This is the "add new music to library without re-scanning" feature.

### 2g. Error Handling (`error.rs`)

A custom `AudioError` enum with five variants: `DecodingError`, `OutputError`, `FileError`, `ConfigError`, `ResampleError`. Implements `Display`, `std::error::Error`, and `From<io::Error>`. Most things in `commands.rs` return `Result<..., String>` — errors are just stringified at the Tauri boundary.

---

## Layer 3: The Frontend

### 3a. Build Tooling

**Vite 5** is the dev server and build tool. It serves the React app on port 1420 during development with HMR. For production it bundles everything into `dist/`. The `@vitejs/plugin-react` plugin enables JSX transformation and Fast Refresh.

**TypeScript 5** — strict mode, no emit (Vite handles transpilation), `jsx: react-jsx` transform.

### 3b. Styling

**Tailwind CSS** via utility classes. The design token system lives in `src/styles/variables.css`:

```
Dark palette:
  bg-deep:   #0c0d12   (darkest background)
  bg-base:   #13151d   (main background)
  bg-raised: #181b25   (cards/panels)
  bg-hover:  #1f2330   (hover states)
  accent:    #6cb4ee   (bright blue — primary actions, active states)
  text:      #e4e6eb / #8b919e / #555a66  (primary / secondary / tertiary)
  font:      Inter (system fallback stack)
```

No separate CSS framework or component library — styles are inline Tailwind classes in JSX, with a small CSS file for custom scrollbars and the player bar animation.

### 3c. State Management

**React Context** (`src/context/PlayerContext.tsx`). No Redux, no Zustand, no Jotai.

The `PlayerProvider` wraps the entire app and provides:
- **Library state:** `libraryTracks`, `displayedTracks` (what the current view shows)
- **Playback state:** `currentTrack`, `currentTrackIndex`, `isPlaying`, `isPaused`, `currentTime`
- **Queue state:** `displayedTracks` doubles as the queue, `preShuffleQueueRef` remembers pre-shuffle order
- **Control state:** `isShuffle`, `repeatMode` ("off"/"all"/"one"), `selectedDevice`

Key behaviors:
- A `setInterval` timer fires every second, incrementing `currentTime`. When time reaches `duration_secs`, it triggers `buildTrackEndHandler` which calls `playNext`, `playTrack(currentTrack)` (repeat-one), or `stop()` (repeat-off).
- Shuffle mode is deterministic-per-toggle: it uses Fisher-Yates on the queue (preserving current track at index 0), and remembers the pre-shuffle order in a ref so toggling shuffle off restores the original queue.
- Seek: sets `currentTime` in React, and calls `invoke("seek_playback")` in Rust which seeks the decoder + clears the resampler buffers.

### 3d. Routing

**String-based view switching** in `App.tsx`. There's no React Router. A single `currentView` state variable (type `View`) determines which component renders in the main area:

| View string | Component |
|---|---|
| `"now"` | `HomeView` — recently added + recently played |
| `"browse"` | `TracksView` — full track list |
| `"albums"` | `AlbumsView` — album grid/list |
| `"album-detail"` | `AlbumDetailView` — tracks for one album |
| `"artists"` | `ArtistsView` — artist list |
| `"artist-detail"` | `ArtistDetailView` — tracks by one artist |
| `"genres"` | `GenresView` |
| `"genre-detail"` | `GenreDetailView` |
| `"playlists"` | `PlaylistsView` |
| `"playlist-detail"` | `PlaylistDetailView` |
| `"stats"` | `StatsView` — library statistics |

Clicking an album/artist/genre/playlist sets the view and the relevant filter state. The Back button resets it.

### 3e. Data Flow: Playing a Track

Frontend → Backend:
1. User clicks a track in any view.
2. `playTrack(track, libraryTracks)` is called.
3. Sets `currentTrack`, `currentTrackIndex`, starts the progress timer.
4. Calls `invoke("stop_playback")` to clean up any existing playback.
5. Calls `invoke("play_track", { filePath, deviceIndex })`.

Backend processing in `play_track`:
1. Opens the FLAC file with Symphonia → `(decoder, format)`.
2. Gets the system default audio device via cpal.
3. Negotiates output config (sample rate, channels) — finds best match between file format and device capabilities.
4. If sample rates differ, creates a Rubato resampler.
5. Starts cpal audio stream with a closure (callback) that:
   - Locks the decoder mutex, pulls decoded PCM frames
   - If resampling: feeds samples into Rubato, pulls resampled output into the hardware buffer
   - If matching rates: fills buffer directly from decoder
   - Applies volume multiplier
6. Stores the AudioOutput, decoder Arc, resampler Arc in AppState.

The audio callback runs on a **real-time OS audio thread** — if it stalls, the audio glitches. The mutex locks are held for very short durations (just long enough to grab a few samples) to avoid priority inversion.

### 3f. Components

| Component | Role |
|---|---|
| `Sidebar` | Navigation + Add Folder button (opens Tauri dialog, triggers scan) |
| `PlayerBar` | Bottom bar: album art thumbnail, track info, play/pause/skip, progress bar (slider), volume |
| `QueuePanel` | Right sidebar showing `displayedTracks` with current track highlighted |
| `NowPlaying` | Compact now-playing widget (may render inside views) |
| `FullscreenNowPlaying` | Expanded full-screen now-playing view (blurred album art background) |
| `TrackList` | Shared track row component (used by TracksView, playlists, album detail, etc.) |
| `HomeView` | Landing page with recently added tracks + recently played |
| Views | Each browse view filters/group `libraryTracks` by album/artist/genre/playlist |

---

## Layer 4: Build & Release

### Development

Two parallel terminals:
1. **Frontend:** `npm run dev` → Vite dev server on `localhost:1420`
2. **Backend:** Tauri watches `src-tauri/src/` for Rust changes, recompiles automatically

Tauri's `beforeDevCommand` and `beforeBuildCommand` handle the sequencing.

### Production Build

`npm run build` → TypeScript check + Vite production bundle into `dist/`.
Then `npm run tauri build` → compiles Rust, bundles the frontend into the Rust binary, produces a Windows `.exe` (or macOS `.app`, Linux binary).

Release profile optimizations:
```toml
[profile.release]
opt-level = 3      # maximum optimizations
lto = true         # link-time optimization (smaller binary, faster code)
codegen-units = 1  # better optimization at cost of compile time
panic = "abort"    # smaller binary, no unwinding
```

---

## Key Dependencies Summary

| Crate | Purpose |
|---|---|
| `cpal` | Cross-platform audio I/O — the sound card interface |
| `symphonia` | Audio demuxer + decoder — FLAC → PCM samples |
| `rubato` | Sample rate conversion — 44.1kHz → 48kHz etc. |
| `lofty` | Audio metadata — ID3/Vorbis/MP4 tag reading |
| `rusqlite` | SQLite — local library database |
| `notify` | File system events — auto-detect new music files |
| `walkdir` | Directory traversal — recursive folder scanning |
| `clap` | CLI argument parsing — standalone binary mode |
| `tauri` | Desktop app framework — IPC + webview + windowing |
| `tauri-plugin-dialog` | Native file picker |

| JS Package | Purpose |
|---|---|
| `react` | UI component library |
| `react-dom` | React renderer |
| `@tauri-apps/api` | Frontend half of Tauri IPC — `invoke()`, `isTauri()` |
| `@tauri-apps/plugin-dialog` | Native file/folder picker from JS |
| `vite` | Dev server + bundler |
| `typescript` | Type system |
| `tailwindcss` (via classes) | Utility-first CSS |
| `@radix-ui/react-slider` | Accessible range slider (seek bar, volume) |
| `lucide-react` | Icon set |
| `clsx` + `tailwind-merge` | Class name composition |

---

## What This Project Does NOT Have (yet)

- Search/filter in the UI (scans show all tracks, no search bar visible)
- gapless playback (current play_track tears down the old stream and starts a new one)
- Format support beyond FLAC (Symphonia has MP3/OGG/AAC codecs available as features but they're not enabled)
- Settings/preferences (volume isn't persisted, no EQ, no theme toggle)
- Drag-and-drop queue reordering
- Album art display in the track list (cover_path is stored but the UI code wasn't read)
- Lyrics, radio, podcasts, streaming
- Playback statistics (play count, last played timestamp)
- Shuffle algorithm beyond simple Fisher-Yates