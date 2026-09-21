<div align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="96" alt="Vynlore logo" />
  <h1>Vynlore</h1>
  <p><b>Your music, decoded in Rust, played the way it was mastered.</b></p>
  <p>A lossless-first desktop player for Windows — gapless, fast, and obsessive about sound.</p>

  <p>
    <img src="https://img.shields.io/badge/Windows-0078D6?logo=windows&logoColor=white" alt="Windows" />
    <img src="https://img.shields.io/badge/Tauri_v2-FFC131?logo=tauri&logoColor=black" alt="Tauri v2" />
    <img src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB" alt="React" />
    <img src="https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white" alt="Rust" />
    <img src="https://img.shields.io/badge/FLAC%E2%80%A2WAV%E2%80%A2MP3%E2%80%A2M4A-18181b" alt="Formats" />
  </p>

  <p>
    <a href="https://github.com/dhanushbs10/vynlore/releases/tag/v1.2.0"><b>⬇ Download v1.2.0 for Windows</b></a>
  </p>
</div>

---

## Why Vynlore?

- 🎧 **Serious sound engine** — native Rust decoding, gapless playback, WASAPI exclusive output, and a real parametric EQ.
- ⚡ **Instant library** — point it at a folder and thousands of tracks are scanned, tagged, and browsable in seconds.
- 🎨 **Yours to skin** — monochrome by default, fully themeable via shareable JSON skins.

No accounts. No cloud. No streaming. Just your files, played properly.

## Get it

Grab the `.exe` (NSIS installer) from [Releases](https://github.com/dhanushbs10/vynlore/releases), install, then go to **Settings → Apps → Default Apps** and set Vynlore as the default player for your audio formats.

| Platform | Installer |
|----------|-----------|
| Windows  | `.exe` (NSIS installer) |

## Highlights

<details>
<summary><b>🔊 Sound that respects the source</b></summary>

- Gapless playback with optional 0–8s crossfade layered on top
- WASAPI exclusive mode + per-device output selection
- 24-bit / high-sample-rate files (96/176.4 kHz) play clean, end to end
- Parametric EQ (5–32 bands, adjustable Q) with shelves, preamp, and balance
- ReplayGain loudness normalization — off, per-track, or per-album
- AutoEQ profile import + genre-aware presets that follow your music
- Speed 0.25x–4x (pitch-preserving) and ±12 semitone pitch shift
- Live spectrum analyzer and full-file RMS waveform seekbar
</details>

<details>
<summary><b>📚 A library that manages itself</b></summary>

- Folder watching — new rips appear automatically, retags refresh instantly
- Browse by tracks, albums, artists, genres, recently played, most played
- Smart handling: offline drives never wipe your library, retags keep likes and play counts
- Playlists with cover art and color coding, M3U import/export
- In-app tag editor that writes straight to your files
</details>

<details>
<summary><b>⌨️ Control from anywhere</b></summary>

- Global search palette (`Ctrl+K`) — fuzzy search across everything
- Media keys, taskbar controls (SMTC), system tray, track notifications
- Sleep timer, ListenBrainz scrobbling, synced lyrics (embedded + online via LRCLIB)
- Fullscreen now-playing view with click-to-seek lyrics
- Double-click any audio file to play it instantly
</details>

<details>
<summary><b>🎨 Looks that adapt to you</b></summary>

- Clean monochrome design, distraction-free
- Custom skins: import, export, and share the whole UI as JSON
- Reorderable queue panel, global shortcuts, smooth dark interface
</details>

## Up and running in 60 seconds

1. **Install** the `.exe` from [Releases](https://github.com/dhanushbs10/vynlore/releases).
2. **Add music** — pick a folder when prompted (or later in settings).
3. **Press play** — browse, hit `Ctrl+K` to find anything, double-click to play.

## Shortcuts

| Keys | Action |
|------|--------|
| `Space` | Play / pause |
| `←` / `→` | Seek ∓ 5s |
| `Ctrl` + `←` / `→` | Previous / next track |
| `Ctrl` + `K` | Search everything |

## Formats

**FLAC · WAV · AIFF · MP3 · M4A · OGG** — lossless-first, lossy welcome.

## Under the hood

Rust (Tauri v2 · Symphonia · CPAL · WASAPI) + React 18 · TypeScript · Tailwind v4 · Vite. Decode and DSP run off the realtime thread; the audio callback only moves samples.

<details>
<summary><b>🛠 Build from source</b></summary>

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

See [CHANGELOG.md](CHANGELOG.md) — currently at **v1.2.0**.

## License

MIT
