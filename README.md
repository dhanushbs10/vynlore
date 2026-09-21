<div align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="96" alt="Vynlore logo" />
  <h1>Vynlore</h1>
  <p><b>Your music, decoded in Rust, played the way it was mastered.</b></p>
  <p>A lossless-first desktop player for Windows. Gapless, fast, and obsessive about sound.</p>

  <p>
    <img src="https://img.shields.io/badge/Windows-0078D6?logo=windows&logoColor=white" alt="Windows" />
    <img src="https://img.shields.io/badge/Tauri_v2-FFC131?logo=tauri&logoColor=black" alt="Tauri v2" />
    <img src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB" alt="React" />
    <img src="https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white" alt="Rust" />
  </p>

  <p>
    <a href="https://github.com/dhanushbs10/vynlore/releases/tag/v1.2.0"><b>Download v1.2.0 for Windows</b></a>
  </p>
</div>

---

## Why Vynlore?

- **Serious sound engine.** Native Rust decoding, gapless playback, WASAPI exclusive output, and a real parametric EQ.
- **Instant library.** Point it at a folder and thousands of tracks are scanned, tagged, and browsable in seconds.
- **Yours to skin.** Monochrome by default, fully themeable via shareable JSON skins.

No accounts. No cloud. No streaming. Just your files, played properly.

## Get it

Grab the `.exe` (NSIS installer) from [Releases](https://github.com/dhanushbs10/vynlore/releases), install, then go to **Settings > Apps > Default Apps** and set Vynlore as the default player for your audio formats.

| Platform | Installer |
|----------|-----------|
| Windows  | `.exe` (NSIS installer) |

## How it works

```
Music folder -> Scanner -> SQLite library -> Your library view
                                              |
Press play -> Decode -> Resample -> EQ / ReplayGain -> Sample queue -> Output -> Speakers
```

1. **Scan.** You pick a music folder. Vynlore walks it with parallel workers, reads tags and cover art, analyzes loudness for ReplayGain, and stores everything in a local SQLite database. Cover art is stored once per unique image, and files with no genre tag get one guessed from their folder. A file watcher keeps the library in sync, so new rips appear and retags refresh on their own.
2. **Decode.** When you press play, the Rust backend opens the file with Symphonia and decodes it on a dedicated decoder thread. Decoding never happens on the realtime audio thread, so the UI and playback stay smooth.
3. **Shape.** If the file sample rate differs from the output device, it is resampled with a filter sized to the conversion depth. EQ, ReplayGain, preamp, and balance are applied on that same background thread.
4. **Output.** Finished samples go into a bounded queue. The output thread pulls from it and writes to your device through WASAPI exclusive mode when available, or shared mode otherwise. Exclusive mode runs at the file native rate with no system mixer in the path.
5. **Chain.** For gapless albums, the next track is decoded into the same continuous stream. No gap, no click, no restart between tracks.
6. **Display.** The React frontend polls playback position several times per second and listens for backend events (track changes, library updates) to keep the progress bar, queue, and views in sync.

## Features

### Playback

- Gapless playback within one channel layout, with a clean restart across layout changes
- Crossfade slider (0-8s, off by default) layered over gapless transitions
- WASAPI exclusive output at the file native rate, channels, and bit depth, with automatic shared-mode fallback per track
- Shared-mode output that prefers standard rates and never hogs the session
- Per-device output selection with System Default fallback
- Native decoding of FLAC, WAV, AIFF, MP3, M4A, and OGG, including 24-bit and 96/176.4 kHz files
- Accurate seeking and first-decodable-track probing for multi-stream files
- Adaptive resampling that scales filter depth to the conversion
- Parametric EQ with 5-32 bands (10 by default), per-band Q, and bass and treble shelves
- Soft limiter plus hard clamp so EQ boosts never clip, with click-free coefficient smoothing
- 13 built-in EQ presets with genre auto-match across dozens of genre keywords
- AutoEQ profile import with band-count validation
- A/B snapshot compare, clickable frequency-response curve, and selectable band counts
- Preamp (0.5x-2x), left/right balance with center detent, and 0-100 percent volume
- ReplayGain loudness normalization (off, per-track default, per-album) analyzed at scan time
- Playback speed 0.25x-4x with pitch-preserving stretch, plus pitch shift up to +/-12 semitones
- 64-bar spectrum analyzer, full-file RMS waveform seekbar, and clip-detecting output meter
- Live format badge and lossless indicator on whatever is playing
- Shuffle that keeps the current track first, repeat off/all/one, and a drag-reorderable Up Next queue
- Sleep timer presets that pause playback and survive restarts
- Frame-exact position tracking across gapless seams

### Library

- Watched folder with fast parallel scanning, live progress, manual rescan, and a 10-minute failsafe
- Unchanged files skipped without re-decoding; brand-new files get a stability check first
- Filesystem watcher with debounce: new rips appear and retags refresh on their own
- Offline drives never wipe the library; retags keep likes, play counts, and analysis
- Home with recently played, most played, recently added, and smart suggestions
- Track, album, artist, and genre browsing with grouped detail views and hero controls
- Collaboration-aware artists (splits on feat., &, /) plus folder-based genre guessing
- Like button feeding a protected Liked Songs playlist
- Playlists with custom covers, 12 color presets, inline rename, per-row remove, and in-list shuffle
- M3U import that plays as a queue, and M3U export of whatever is queued
- In-app tag editor (title, artist, album, genre, track/disc) that writes to files and refreshes the library
- Cover art stored once per unique image; unknown art never mislabeled
- Local SQLite library with play counts and last-played stamps on every start, including gapless chains

### Control and system

- Global search palette (Ctrl+K) with instant grouped results and full keyboard navigation
- Shortcuts for play/pause, 5-second seeking, track change, and closing dialogs
- Media keys, taskbar controls with cover art and seeking, and live metadata push
- System tray with playback menu, close-to-tray, launch on startup, and unfocused track notifications
- ListenBrainz scrobbling with retry queue and now-playing pings
- Synced lyrics from embedded tags plus online lookup, with auto-scroll, click-to-seek, and approx-sync labeling
- Fullscreen now-playing view with blurred artwork backdrop and transport controls
- Double-click any supported file to play it without adding it to the library
- In-app toasts for scans, watcher events, and saved tags
- Window title follows the playing track
- Every setting remembered across restarts (volume, device, EQ, balance, ReplayGain, speed, pitch, crossfade, sleep, theme)

### Appearance

- 9 built-in skins including the light Paper theme, with live previews
- Custom JSON skins: import, export, delete, 17 color tokens, custom variables, and raw CSS
- Monochrome distraction-free design with a reorderable queue panel

## Up and running in 60 seconds

1. **Install** the `.exe` from [Releases](https://github.com/dhanushbs10/vynlore/releases).
2. **Add music** by picking a folder when prompted (or later in settings).
3. **Press play.** Browse, hit `Ctrl+K` to find anything, double-click to play.

## Shortcuts

| Keys | Action |
|------|--------|
| `Space` | Play / pause |
| `Left` / `Right` | Seek back / forward 5s |
| `Ctrl` + `Left` / `Right` | Previous / next track |
| `Ctrl` + `K` | Search everything |

## Formats

FLAC, WAV, AIFF, MP3, M4A, OGG. Lossless first, lossy welcome. (Opus is not supported: the decoder library cannot decode it.)

## Under the hood

Rust (Tauri v2, Symphonia, CPAL, WASAPI) plus React 18, TypeScript, Tailwind v4, and Vite. Decode and DSP run off the realtime thread. The audio callback only moves samples.

<details>
<summary><b>Build from source</b></summary>

Requires [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) stable, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/dhanushbs10/vynlore.git
cd vynlore
npm install
npx tauri dev      # run it
npx tauri build    # installer lands in src-tauri/target/release/bundle/
```

</details>

## Changelog

See [CHANGELOG.md](CHANGELOG.md). Currently at **v1.2.0**.

## License

MIT. See [LICENSE](LICENSE) for the full text.
