# Vynlore

A lossless-first desktop music player built with Tauri v2, React, and Rust.

Vynlore is a local music player designed for audiophiles who care about playback quality. It decodes all major formats natively in Rust, outputs through WASAPI exclusive mode for bit-perfect delivery, and ships with a 10-band parametric equalizer with genre-aware presets.

## Download

Grab the latest build from [Releases](https://github.com/dhanushbs10/vynlore/releases).

| Platform | Installer |
|----------|-----------|
| Windows  | `.exe` (NSIS installer) |
| macOS    | `.dmg` |
| Linux    | `.deb`, `.AppImage` |

After installing on Windows, go to **Settings > Apps > Default Apps** and set Vynlore as the default player for your audio formats.

## Features

### Playback

- Gapless playback with crossfade
- WASAPI exclusive mode for bit-perfect output
- Multi-format decoding: FLAC, WAV, AIFF, MP3, M4A, OGG, WMA, APE, WavPack, DSD (DSF/DFF)
- Real-time spectrum analyzer
- Waveform seekbar with RMS visualization

### Library

- Automatic folder watching and library scanning
- Browse by tracks, albums, artists, and genres
- Recently played, most played, and smart suggestions
- Playlist creation with cover art and color coding
- Track liking and play count tracking

### Audio

- 10-band parametric equalizer with adjustable Q
- Bass and treble shelf filters
- Preamp gain control
- Auto-EQ: parse AutoEq profile text files and apply correction curves
- Genre-aware EQ presets (Rock, Jazz, Classical, Electronic, Hip-Hop, Acoustic, Metal, Pop, R&B, Folk)
- Balance (left/right panning)
- Per-device output selection

### Interface

- Clean monochrome design
- Fullscreen now-playing view with synced lyrics
- Global search palette (Ctrl+K)
- Queue panel with drag-style reorder
- Media key support (play/pause, next, previous)
- File association: double-click any audio file to play it

## Tech Stack

- **Backend:** Rust (Tauri v2, Symphonia, CPAL, WASAPI)
- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Vite
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
| AIFF | `.aiff`, `.aif` | Lossless |
| MP3 | `.mp3` | Lossy |
| M4A | `.m4a`, `.m4b` | Lossy |
| OGG | `.ogg`, `.oga`, `.opus` | Lossy |
| WMA | `.wma` | Lossy |
| APE | `.ape` | Lossless |
| WavPack | `.wv` | Lossless |
| DSD | `.dsf`, `.dff` | Lossless |

## License

MIT
