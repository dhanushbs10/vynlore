# Vynlore

A lossless-first desktop music player built with Tauri v2, React, and Rust.

Vynlore is a local music player designed for audiophiles who care about playback quality. It decodes all major formats natively in Rust, outputs through WASAPI exclusive mode for bit-perfect delivery, and ships with a multi-band parametric equalizer with genre-aware presets.

## Download

Grab the latest build from [Releases](https://github.com/dhanushbs10/vynlore/releases).

| Platform | Installer |
|----------|-----------|
| Windows  | `.exe` (NSIS installer) |
| macOS / Linux | Built by CI from the same tree, but exclusive-mode output and several OS integrations are Windows-only and unverified elsewhere |

After installing on Windows, go to **Settings > Apps > Default Apps** and set Vynlore as the default player for your audio formats.

## What's new in v1.2.0

**New features**
- Playback speed (0.25x–4x, pitch-preserving WSOLA) and pitch shift (±12 semitones)
- Crossfade between tracks (0–8s) layered over gapless playback
- ReplayGain loudness normalization (off / per-track / per-album, EBU R128)
- Custom skins: import, export, and theme the whole UI from JSON files
- Sleep timer, ListenBrainz scrobbling, online lyrics (LRCLIB) with synced display
- In-app tag editor, M3U playlist import/export, AutoEQ profile import
- Balance, preamp, per-device output selection, balance-safe exclusive mode
- System tray, taskbar media controls (SMTC), media keys, track notifications
- Double-click any audio file to play it (file association)

**Fixed**
- High-sample-rate files (96/176.4 kHz) stuttering or going silent: the resampler now scales its filter to the conversion depth instead of choking realtime
- 24-bit playback verified end-to-end (decode → resample → output) with new integration tests
- Seeking with crossfade or a queued next track no longer mis-fires fades or jumps position
- M3U export, ListenBrainz scrobbling and online lyrics (were silently blocked/ broken)
- EQ and ReplayGain on surround (>2ch) files; loudness analysis crash on surround files
- Library wipes: startup prune skips when the music drive is offline; retagged files keep likes/counts/analysis
- Retagged/edited files refresh instantly; changed files get fresh loudness analysis
- Much faster library scans (parallel workers, no idle sleeping) with live progress
- Waveforms now cover full hi-res files instead of truncating after ~17 seconds
- Same-title albums by different artists get independent album gain; compilations still level as one release
- Dozens of smaller UI, state and robustness fixes across the app (see commit history)

## Features

### Playback

- Gapless playback with optional crossfade (0–8s)
- Playback speed (0.25x–4x) and pitch shift (±12 semitones)
- WASAPI exclusive mode for bit-perfect output
- Multi-format decoding: FLAC, WAV, AIFF, MP3, M4A, OGG (incl. 24-bit / high-sample-rate)
- Real-time spectrum analyzer
- Waveform seekbar with RMS visualization

### Library

- Automatic folder watching and fast parallel library scanning with live progress
- Browse by tracks, albums, artists, and genres
- Recently played, most played, and smart suggestions
- Playlist creation with cover art and color coding, M3U import/export
- Track liking and play count tracking
- In-app tag editor (writes straight to files)

### Audio

- Parametric equalizer (5–32 bands, default 10) with adjustable Q
- Bass and treble shelf filters
- Preamp gain control
- ReplayGain loudness normalization (off / per-track / per-album)
- Auto-EQ: parse AutoEq profile text files and apply correction curves
- Genre-aware EQ presets (Rock, Jazz, Classical, Electronic, Hip-Hop, Acoustic, Metal, Pop, R&B, Folk)
- Balance (left/right panning)
- Per-device output selection

### Interface

- Clean monochrome design with custom skins (import/export/share as JSON)
- Fullscreen now-playing view with synced lyrics (embedded + online)
- Global search palette (Ctrl+K)
- Queue panel with drag-style reorder
- Sleep timer
- ListenBrainz scrobbling
- Media key support (play/pause, next, previous) + taskbar controls + system tray
- Track-change notifications
- File association: double-click any audio file to play it

## Tech Stack

- **Backend:** Rust (Tauri v2, Symphonia, CPAL, WASAPI)
- **Frontend:** React 18, TypeScript, Tailwind CSS v4, Vite
- **Audio Engine:** Custom Rust decoder with Symphonia, CPAL output, real-time EQ via biquad filters

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### Setup

```bash
git clone https://github.com/dhanushbs10/vynlore.git
cd vynlore
npm install
```

### Run in development

```bash
npx tauri dev
```

### Build for production

```bash
npx tauri build
```

The installer will be in `src-tauri/target/release/bundle/`.

## Supported Formats

| Format | Extensions | Type |
|--------|-----------|------|
| FLAC | `.flac` | Lossless |
| WAV | `.wav`, `.wave` | Lossless |
| AIFF | `.aiff`, `.aif`, `.aifc` | Lossless |
| MP3 | `.mp3` | Lossy |
| M4A | `.m4a`, `.m4b` | Lossy |
| OGG | `.ogg`, `.oga` | Lossy |

## License

MIT
