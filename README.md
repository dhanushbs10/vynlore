<div align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="96" alt="Vynlore logo" />
  <h1>Vynlore</h1>
  <p><b>A local-first lossless music player for Windows.</b></p>
  <p>Native Rust playback, WASAPI exclusive output, gapless, parametric EQ and ReplayGain.<br/>No account. No cloud library. No telemetry.</p>

  <p>
    <a href="https://github.com/dhanushbs10/vynlore/releases/latest"><b>Download for Windows</b></a>
    &nbsp;·&nbsp;
    <a href="docs/ROADMAP.md">Roadmap</a>
    &nbsp;·&nbsp;
    <a href="CONTRIBUTING.md">Contributing</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Windows_10%2F11-0078D6?logo=windows&logoColor=white" alt="Windows 10/11" />
    <img src="https://img.shields.io/badge/Tauri_v2-FFC131?logo=tauri&logoColor=black" alt="Tauri v2" />
    <img src="https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white" alt="Rust" />
    <img src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB" alt="React" />
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" />
    <img src="https://github.com/dhanushbs10/vynlore/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </p>
</div>

<!-- Add a hero screenshot or demo GIF here once docs/screenshots/ has assets. See docs/screenshots/README.md. -->

## Why Vynlore?

- **A real audio path.** Files are decoded natively with Symphonia, processed off the realtime thread, and sent through WASAPI exclusive mode when the device allows it. No Electron, no browser audio.
- **Built for album listening.** Gapless playback, crossfade, ReplayGain, a parametric EQ, and a queue you can reorder.
- **A library that stays local.** SQLite plus a folder watcher. No account, no cloud, no analytics. Your files never leave the machine.
- **Open source and hackable.** Rust + Tauri v2 + React + TypeScript. Small enough to understand, real enough to learn from.

## Features

### Playback

- Gapless playback within one channel layout, with a clean restart across layout changes
- Crossfade slider (0–8 s, off by default) layered over gapless transitions
- WASAPI exclusive output at the file's native rate, channels and bit depth, with shared-mode fallback per track
- Shared-mode output that prefers standard rates and does not monopolise the audio session
- Per-device output selection with System Default fallback
- Native decoding of FLAC, WAV, AIFF, MP3, M4A and OGG, including 24-bit and 96/176.4 kHz files
- Accurate seeking and first-decodable-track probing for multi-stream files
- Adaptive resampling that scales filter depth to the conversion
- Parametric EQ with 5–32 bands (10 by default), per-band Q, and bass and treble shelves
- Soft limiter plus hard clamp so EQ boosts never clip, with click-free coefficient smoothing
- 13 built-in EQ presets with genre auto-match across dozens of genre keywords
- AutoEQ profile import with band-count validation
- Clickable frequency-response curve and selectable band counts
- Preamp (0.5×–2×), left/right balance with centre detent, and 0–100 % volume
- ReplayGain loudness normalisation (off, per-track default, per-album) analysed at scan time
- Playback speed 0.5×–2× with pitch-preserving stretch, plus pitch shift up to ±6 semitones
- 64-bar spectrum analyser, full-file RMS waveform seekbar, and a clip-detecting output meter
- Live format badge and lossless indicator on whatever is playing
- Shuffle that keeps the current track first, repeat off/all/one, and a drag-reorderable Up Next queue
- Sleep timer presets that pause playback and survive restarts
- Frame-exact position tracking across gapless seams

### Library

- Watched folder with parallel scanning, live progress and manual rescan
- Unchanged files skipped without re-decoding; new files get a write-stability check first
- Filesystem watcher with debounce: new rips appear and retags refresh on their own
- Library pruning is skipped when the watched folder is unreachable, so an unplugged drive does not wipe the library
- Home with recently played, most played, recently added, and smart suggestions
- Track, album, artist and genre browsing with grouped detail views and hero controls
- Folder-based genre guessing when a file has no genre tag
- Like button feeding a protected Liked Songs playlist
- Playlists with custom covers, 12 colour presets, inline rename, per-row remove and in-list shuffle
- M3U import that plays as a queue, and M3U export of whatever is queued
- In-app tag editor (title, artist, album, genre, track/disc) that writes to files and refreshes the library
- Cover art stored once per unique image; unknown art never mislabelled
- Local SQLite library with play counts and last-played stamps, including gapless chains

### Interface and system

- Global search palette (`Ctrl+K`) with grouped results and keyboard navigation
- Shortcuts for play/pause, 5-second seeking, track change and closing dialogs
- Media keys, taskbar media controls with cover art and seeking, and live metadata push
- System tray with playback menu, close-to-tray, launch on startup and unfocused track notifications
- ListenBrainz scrobbling with a retry queue and now-playing pings (opt-in)
- Synced lyrics from embedded tags plus online lookup, with auto-scroll, click-to-seek and approx-sync labelling
- Fullscreen now-playing view with blurred artwork backdrop and transport controls
- File associations for FLAC, WAV, AIFF, MP3, M4A and OGG
- In-app toasts for scans, watcher events and saved tags
- Window title follows the playing track
- Every setting remembered across restarts (volume, device, EQ, balance, ReplayGain, speed, pitch, crossfade, sleep, theme)

### Appearance

- 9 built-in skins including the light Paper theme, with live previews
- Custom JSON skins: import, export, delete, 17 colour tokens, custom variables and custom CSS
- Monochrome distraction-free design with a reorderable queue panel

## Project status

Vynlore is at **v1.2.0** and under active development. The core playback path, library, EQ and ReplayGain work; the rough edges are tracked in [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) and the [roadmap](docs/ROADMAP.md).

Known limitations:

- **Very large libraries (100k+ tracks) are not optimised yet.** The UI currently loads the whole library and renders every row; pagination and virtualisation are planned.
- **“Open with” / double-click uses a lightweight transient entry** without full tags, cover art or a stable library id. A proper registration path is planned.
- **Mono and 5.1 files need a device that accepts that channel count.** Downmixing to stereo-only devices is planned.
- **Windows only.** The audio path depends on WASAPI; macOS and Linux are not supported.

If one of these blocks you, open an issue. They are good candidates for contribution.

## Install

1. Download the installer from [Releases](https://github.com/dhanushbs10/vynlore/releases/latest).
2. Run it. The current installer is unsigned, so Windows SmartScreen may ask you to confirm.
3. Pick your music folder when prompted.
4. Optional: set Vynlore as the default player in **Windows Settings → Apps → Default apps**.

Requires **Windows 10/11 (64-bit)** and the WebView2 runtime. The installer bootstraps WebView2 if it is missing.

## How it works

```
Music folder -> Scanner -> SQLite library -> Library views
                                             |
Press play -> Decode -> Resample -> EQ / ReplayGain -> Sample queue -> WASAPI -> Speakers
```

1. **Scan.** Vynlore walks the chosen folder with parallel workers, reads tags and cover art, analyses loudness for ReplayGain, and stores everything in a local SQLite database. Cover art is stored once per unique image; files without a genre tag get one guessed from their folder. A file watcher keeps the library in sync.
2. **Decode.** On play, the Rust backend opens the file with Symphonia and decodes it on a dedicated decoder thread. Decoding never happens on the realtime audio thread.
3. **Shape.** If the file sample rate differs from the output device, it is resampled with a filter sized to the conversion. EQ, ReplayGain, preamp and balance are applied on that background thread.
4. **Output.** Finished samples go into a bounded queue. The output thread writes to the device through WASAPI exclusive mode when available, or shared mode otherwise.
5. **Chain.** For gapless albums, the next track is decoded into the same continuous stream. No gap, no click, no restart between tracks.
6. **Display.** The React frontend polls playback position twice per second and listens for backend events (track changes, library updates) to keep the progress bar, queue and views in sync.

## Supported formats

| Format | Playback | Type |
|---|---|---|
| FLAC | Yes | Lossless |
| WAV | Yes | Lossless PCM |
| AIFF | Yes | Lossless PCM |
| M4A (AAC/ALAC) | Yes | Lossy / lossless |
| MP3 | Yes | Lossy |
| OGG Vorbis | Yes | Lossy |
| Opus | No | — |

Opus is not supported because the decoder cannot decode it. WMA and APE are also out of scope.

## Shortcuts

| Keys | Action |
|---|---|
| `Space` | Play / pause |
| `Left` / `Right` | Seek back / forward 5 s |
| `Ctrl` + `Left` / `Right` | Previous / next track |
| `Ctrl` + `K` | Search everything |

## Under the hood

| Layer | Stack |
|---|---|
| Desktop shell | Tauri v2 |
| Audio engine | Rust, Symphonia, CPAL/WASAPI, Rubato, WSOLA |
| Library | Rust, rusqlite (SQLite), Lofty, notify |
| UI | React 18, TypeScript (strict), Tailwind v4, Vite |

Decode and DSP run off the realtime thread; the audio callback only moves samples. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the process/thread model and a map of the codebase.

<details>
<summary><b>Build from source</b></summary>

Requires [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) stable, the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), and Windows 10/11.

```bash
git clone https://github.com/dhanushbs10/vynlore.git
cd vynlore
npm install
npx tauri dev      # run the app
npx tauri build    # installer lands in src-tauri/target/release/bundle/
```

Run the backend tests and a production frontend build before opening a PR:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

</details>

## Contributing

Contributions are welcome, especially from people who care about audio correctness, Windows audio, Rust, React or documentation.

- Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, coding rules and the manual audio checklist.
- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the code map and thread model.
- Pick something from the [roadmap](docs/ROADMAP.md) or look for a `good first issue`.
- Join the conversation in [Discussions](https://github.com/dhanushbs10/vynlore/discussions).

There is **no CLA**. Contributions are accepted under the MIT license.

## Changelog

See [CHANGELOG.md](CHANGELOG.md). Currently at **v1.2.0**.

## License

MIT. See [LICENSE](LICENSE) for the full text.

Vynlore bundles third-party libraries with their own licenses (for example, Symphonia is MPL-2.0 and CPAL is Apache-2.0). Keep their notices when redistributing; a generated third-party notice file is on the release checklist.
