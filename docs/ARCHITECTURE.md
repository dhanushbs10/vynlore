# Architecture

This is a map of the codebase for contributors. It describes the current design, the thread model, and where to change things. It is not a promise that the design is perfect; known rough edges are tracked in [PROJECT_STATUS.md](PROJECT_STATUS.md) and [ROADMAP.md](ROADMAP.md).

## The short version

```
┌─────────────────────────────────────────────────────────────┐
│ React UI (src/)                                             │
│  App shell · PlayerContext · views · modals                 │
└──────────────────────────────┬──────────────────────────────┘
                               │ Tauri commands / events
┌──────────────────────────────▼──────────────────────────────┐
│ src-tauri/src/commands.rs — the IPC boundary                │
└───────┬──────────────────────┬──────────────────────────────┘
        │                      │
┌───────▼─────────┐   ┌────────▼─────────────────────────────┐
│ Library         │   │ Playback                              │
│ scanner         │   │ player.rs → Pipeline → SampleQueue    │
│ watcher         │   │   decode → resample → EQ → gain      │
│ SQLite (db.rs)  │   │   → WASAPI exclusive / CPAL shared   │
│ metadata        │   │   → output callback (realtime)       │
└─────────────────┘   └───────────────────────────────────────┘
```

The UI never decodes audio and never touches SQLite directly. It calls commands, receives events, and polls the playhead.

## Process and thread model

### UI process

- The Tauri webview runs the React app. `src/context/PlayerContext.tsx` owns the queue, current track, play state, position, EQ and settings persistence.
- `src/App.tsx` owns routing, the scan lifecycle, global shortcuts and library reloads.
- The frontend polls `get_position` every 500 ms and listens for backend events (`playback-ended`, `track-changed`, `watcher-event`, `open-file`, `media-key`, `smtc-*`).

### Tauri command handlers

- Commands are synchronous Rust functions unless they explicitly spawn a thread. They validate input, take the minimum lock needed, and return a `Result<_, String>`.
- `AppState` (`src-tauri/src/state.rs`) holds:
  - `Arc<Mutex<LibraryDb>>` — the global database handle
  - `Mutex<Option<PlaybackHandle>>` — the current playback engine
  - atomics for volume, balance, preamp, ReplayGain mode, speed, pitch and crossfade
  - the shared EQ processor and spectrum analyser
  - `cover_dir`
- The database mutex must only be held for short queries/transactions. Never hold it while decoding, reading files or waiting on the audio device.

### Scanner

- `library/scanner.rs` walks the watched folder, filters by supported extension, and processes files in batches of 100.
- Metadata, cover extraction and ReplayGain analysis run in a scoped thread pool **without** the DB lock. Only the per-batch upsert transaction takes the lock.
- Files modified in the last few seconds get a 120 ms double-stat stability check before being read.
- Progress is emitted as `watcher-event` with `kind: "scan"`.
- Album gain is recomputed after the scan (`db.rs::recompute_album_gains`).

### Watcher

- `library/watcher.rs` uses `notify` with a recursive watch and an 800 ms debounce.
- Create/Modify events queue an add; Remove events queue a removal. A worker thread processes due events every 250 ms.
- Deleted rows are stashed for 120 s so a quick delete/recreate (tag editor atomic save) can restore likes, play counts, gain and waveform.
- Renames currently leave the old path behind until the next startup prune; see the roadmap.

### Playback engine

`audio/player.rs` is the core. For each track:

1. `play_track` in `commands.rs` probes the device and calls `player::start`.
2. `player::start` opens the file with `decoder/audio.rs`, chooses exclusive WASAPI (`audio/wasapi.rs`) when requested and supported, otherwise shared CPAL (`audio/output.rs`), and starts:
   - a **decoder thread** that decodes packets, applies tempo/pitch (`audio/dsp.rs`), resamples (`rubato`), runs EQ (`audio/eq.rs`), ReplayGain/preamp/balance, and pushes samples into a bounded queue;
   - an **output backend** that pops from the queue and writes to the device.
3. The output callback is realtime-safe: it only moves samples, applies volume and the crossfade envelope, updates atomics, and pops the queue. No allocation, logging, file I/O or unbounded locking.
4. `ControlBlock` holds the atomics shared between the controller, decoder and callback: `frames_played`, `track_start_frame`, boundaries for gapless/crossfade, pause/stop flags, seek target, ReplayGain values.
5. Gapless: when the decoder reaches EOF and a next file is queued, `try_chain` opens it and pushes a boundary marker. The callback flips `track_start_frame` when playback crosses the marker and emits `track-changed`.
6. Position is computed from consumed output frames, `track_start_frame`, output rate and tempo (`player.rs::position_secs`).

### Events

| Event | Emitted by | Consumed by |
|---|---|---|
| `playback-ended` | playback backend | `PlayerContext` → next track / stop |
| `track-changed` | gapless boundary | `PlayerContext` → update current track, scrobble, play count |
| `watcher-event` | scanner/watcher | `App` → progress, toasts, library reload |
| `open-file` | `main.rs` argv | `PlayerContext` → play; `App` → fullscreen |
| `media-key` | global shortcuts / SMTC | `PlayerContext` → play/pause/next/prev |
| `smtc-seek` / `smtc-seek-by` | SMTC | `PlayerContext` → seek |

## Directory map

| Path | Responsibility | Change here for |
|---|---|---|
| `src-tauri/src/main.rs` | App setup, window/tray, DB open, startup scan, argv, command registration | Startup, tray, file associations |
| `src-tauri/src/commands.rs` | IPC boundary and feature orchestration | New commands, play/seek/scan/tag/playlist APIs |
| `src-tauri/src/state.rs` | Shared app state | New global atomics/handles |
| `src-tauri/src/audio/player.rs` | Pipeline, gapless, crossfade, position | Playback behaviour |
| `src-tauri/src/audio/wasapi.rs` | WASAPI exclusive output | Exclusive-mode bugs |
| `src-tauri/src/audio/output.rs` | CPAL shared output and device config | Device selection, sample formats |
| `src-tauri/src/audio/queue.rs` | Bounded sample queue | Buffering/latency |
| `src-tauri/src/audio/eq.rs` | Biquads, limiter, EQ smoothing | EQ/limiter |
| `src-tauri/src/audio/dsp.rs` | Tempo/pitch (WSOLA) | Speed and pitch |
| `src-tauri/src/audio/replaygain.rs` | EBU R128 analysis and gain resolution | Loudness |
| `src-tauri/src/audio/spectrum.rs` | FFT/spectrum data | Visualiser |
| `src-tauri/src/decoder/audio.rs` | Symphonia open/decode/seek | Format support, seeking |
| `src-tauri/src/decoder/waveform.rs` | Waveform peaks | Seekbar waveform |
| `src-tauri/src/library/scanner.rs` | Folder walk, batching, progress | Import performance/correctness |
| `src-tauri/src/library/db.rs` | Schema, migrations, queries | Library data model |
| `src-tauri/src/library/metadata.rs` | Tags, covers, extensions | New formats/tags |
| `src-tauri/src/library/watcher.rs` | Live folder updates | Rename/delete handling |
| `src-tauri/src/smtc.rs` | Windows taskbar media controls | SMTC |
| `src/context/PlayerContext.tsx` | Playback/queue/settings state | Playback UX |
| `src/App.tsx` | Shell, routing, scan lifecycle | Navigation, global UI |
| `src/components/` | Reusable UI | Player bar, queue, EQ, settings |
| `src/components/views/` | Browse/detail screens | Library views |
| `src/audio/` | Lyrics, scrobbling, AutoEQ, presets | Online features, imports |

## Data model notes

- `tracks.file_path` is `UNIQUE`. A track is identified by its path, not by tags.
- `watched_folder` groups rows by the folder that produced them. Album gain is keyed by `(album, watched_folder)`.
- Externally opened files have no watched folder and are excluded from album-gain recomputation.
- `playlists` + `playlist_tracks` handle user playlists; the Liked Songs playlist is system-managed and protected by name.
- Schema changes must be additive migrations. Existing installs must keep their play counts, likes and playlists.
- The UI uses the numeric `id` for queue identity. The open-with path currently uses an in-memory `id: -1`; that is a known rough edge, not a model to copy.

## How to add a feature

### A new Tauri command

1. Add `#[tauri::command] pub fn ...` in `commands.rs` (or the relevant module).
2. Validate paths/inputs at the boundary.
3. Register it in the `invoke_handler` list in `main.rs`.
4. Call it from the frontend with `invoke("command_name", { ... })`.
5. Return a serialisable type; errors are strings today.
6. Add a Rust test if the logic is non-trivial.

### A new view

1. Add the component under `src/components/views/`.
2. Add a `View` union member in `src/App.tsx` and route to it in the render switch.
3. Add a sidebar entry if it belongs in the main navigation.
4. Use `usePlayer()` for playback actions; do not duplicate queue logic.
5. Test empty, loading and large-library states.

### A DSP stage

1. Add it to `Pipeline` in `audio/player.rs` on the decoder side, never in the output callback.
2. Keep it allocation-free per block or pre-allocate scratch buffers.
3. Add a unit test with generated audio and assert output shape/levels.
4. Document the CPU cost in the PR.

### A new setting

1. Store it in `AppState` as an atomic if the audio thread reads it.
2. Add a command plus a localStorage key for persistence.
3. Add a control in `SettingsModal.tsx` or the relevant panel.
4. Include it in “every setting remembered across restarts” if it should persist.

## Testing map

| Area | Tests |
|---|---|
| DSP | `audio/dsp.rs` |
| EQ/limiter | `audio/eq.rs` |
| Player pipeline | `audio/player.rs` (generated WAV; realtime benchmark is `#[ignore]`) |
| ReplayGain | `audio/replaygain.rs` |
| Database | `library/db.rs` |
| Commands/import parsing | `commands.rs` |
| Frontend | No test runner yet; `npm run build` is the gate |

Run backend tests:

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Invariants and pitfalls

- **Do not block the audio callback.** No allocation, logging, file/network I/O or unbounded locking.
- **Do not hold the DB mutex across IO.** The scanner deliberately reads metadata outside the lock.
- **Do not trust the webview.** Validate every path, size and extension in Rust.
- **Do not change the meaning of `track_start_frame`.** Position, seek and gapless boundaries all depend on its output-frame convention.
- **Do not add remote code or telemetry.** The CSP and the local-first promise are part of the product.
- **Keep migrations backward-compatible.** A bad migration destroys play counts and likes.

Known issues that touch the architecture are listed in [PROJECT_STATUS.md](PROJECT_STATUS.md).
