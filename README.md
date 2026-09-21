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

## Highlights

<details>
<summary><b>Sound that respects the source</b></summary>

- Gapless playback with optional 0-8s crossfade layered on top
- WASAPI exclusive mode with per-device output selection
- 24-bit and high-sample-rate files (96/176.4 kHz) play clean, end to end
- Parametric EQ (5-32 bands, adjustable Q) with shelf filters, preamp, balance, and 13 built-in presets
- ReplayGain loudness normalization: off, per-track, or per-album
- AutoEQ profile import plus genre auto-match that follows your music
- Player bar shows the live format of whatever is playing
- Speed 0.25x-4x (pitch-preserving) and +-12 semitone pitch shift
- Live spectrum analyzer and full-file RMS waveform seekbar
</details>

<details>
<summary><b>A library that manages itself</b></summary>

- Folder watching with live progress and a manual rescan button: new files appear automatically, retags refresh instantly
- Browse by tracks, albums, artists, and genres, plus recently played, most played, and recently added
- Like any track into the protected Liked Songs playlist
- Safe by design: offline drives never wipe your library, retags keep likes and play counts
- Playlists with custom covers and color coding, rename and delete, M3U import and export
- Missing genre tags are guessed from the folder the file lives in; cover art is stored once per unique image
- In-app tag editor that writes straight to your files
</details>

<details>
<summary><b>Control from anywhere</b></summary>

- Global search palette (`Ctrl+K`) with fuzzy search across everything
- Media keys, taskbar controls (SMTC), system tray with close-to-tray, launch on startup, and track notifications
- Shuffle and repeat modes, with every setting (volume, device, EQ, balance, ReplayGain, speed, pitch, crossfade, theme) remembered across restarts
- Sleep timer, ListenBrainz scrobbling, synced lyrics (embedded tags plus online lookup)
- Fullscreen now-playing view with click-to-seek lyrics
- Double-click any audio file to play it instantly
</details>

<details>
<summary><b>Looks that adapt to you</b></summary>

- Clean monochrome design, distraction-free
- Custom skins: import, export, and share the whole UI as JSON
- Reorderable queue panel, global shortcuts, smooth dark interface
</details>

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

FLAC, WAV, AIFF, MP3, M4A, OGG. Lossless first, lossy welcome.

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

MIT
