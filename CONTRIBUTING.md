# Contributing to Vynlore

Thanks for taking the time to contribute. Vynlore is a Windows desktop music player with a Rust audio engine and a React/Tauri UI. Bug reports, fixes, documentation, tests and careful design feedback are all welcome.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues should go through [SECURITY.md](SECURITY.md), not a public issue.

## Ways to contribute

- **Report a bug.** Use the bug report template and include your Windows version, audio device, output mode and file format.
- **Improve the UI.** React/TypeScript work lives in `src/`.
- **Work on the audio engine.** Rust work lives in `src-tauri/src/audio/`.
- **Improve the library.** Scanning, SQLite, tags and the watcher live in `src-tauri/src/library/`.
- **Write docs or tests.** These are high-value and do not require a Windows audio device.
- **Triage.** Reproducing issues and adding details is genuinely useful.

You do **not** need to be an audio expert to contribute. If you are unsure where something lives, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) or ask in [Discussions](https://github.com/dhanushbs10/vynlore/discussions).

## Development setup

### Requirements

- Windows 10/11 (the audio path uses WASAPI; macOS/Linux are not supported)
- [Node.js](https://nodejs.org/) 18 or newer (CI uses 22)
- [Rust](https://rustup.rs/) stable
- The [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) (WebView2, MSVC build tools)

### Run the app

```bash
git clone https://github.com/dhanushbs10/vynlore.git
cd vynlore
npm install
npx tauri dev
```

`npx tauri dev` starts Vite on port 1420 and launches the Tauri window. The Rust side rebuilds when you change files under `src-tauri/`.

### Build and test

```bash
npm run build                                      # TypeScript check + Vite build
cargo test --manifest-path src-tauri/Cargo.toml    # backend unit/integration tests
npx tauri build                                    # NSIS installer
```

The backend tests use generated WAV fixtures and do not require a physical audio device. The realtime benchmark is marked `#[ignore]`; run it manually with:

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored
```

There is no frontend test runner yet. `npm run build` is the required type/lint gate for UI changes today.

## Project layout

| Path | What lives there |
|---|---|
| `src/App.tsx` | App shell, routing, scan lifecycle, global shortcuts |
| `src/context/PlayerContext.tsx` | Playback state, queue/shuffle, position polling, SMTC and sleep timer |
| `src/components/` | Player bar, queue, EQ, search, settings, modals |
| `src/components/views/` | Library, album, artist, genre, playlist and now-playing views |
| `src/audio/` | Lyrics, scrobbling, AutoEQ parsing and EQ presets |
| `src-tauri/src/commands.rs` | Tauri IPC boundary: play, seek, scan, tags, playlists, themes |
| `src-tauri/src/audio/` | Decoder pipeline, WASAPI/CPAL output, EQ, DSP, ReplayGain, spectrum |
| `src-tauri/src/library/` | Scanner, SQLite schema/queries, metadata and file watcher |
| `src-tauri/src/decoder/` | Symphonia wrapper and waveform extraction |
| `docs/` | Architecture, roadmap and project status |

For a deeper explanation, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Where to start

- Look for issues labelled [`good first issue`](https://github.com/dhanushbs10/vynlore/labels/good%20first%20issue) or [`help wanted`](https://github.com/dhanushbs10/vynlore/labels/help%20wanted).
- The [roadmap](docs/ROADMAP.md) lists starter tasks that are self-contained.
- Documentation, test coverage and Windows audio reproduction are always useful.

If you want to work on something that is not listed, open an issue first so we can agree on the approach before you spend time on it.

## Coding guidelines

### General

- Keep a pull request focused on one concern. Small PRs get reviewed faster.
- Match the surrounding style. Rust uses tabs in most modules; TypeScript uses 2 spaces and strict mode.
- Do not add a dependency for a few lines of code. If a new dependency is justified, explain why in the PR.
- Do not add telemetry, analytics, auto-update pings or any network call that is not already part of the product.
- Preserve existing error handling and validation when moving code.
- User data is sacred: migrations must keep existing libraries, play counts, likes and playlists intact.

### Audio engine rules

The realtime audio callback must stay realtime-safe:

- No allocation, no locking that can block, no logging, no file or network I/O inside the callback.
- Decode, resample, EQ and ReplayGain happen on background threads.
- If you add a DSP stage, document where it runs and add a test with generated audio.
- Do not silently change the output format or channel count. If a file cannot be played on the current device, return a clear error rather than producing noise.

### Frontend rules

- TypeScript is `strict`; avoid `any` unless there is a concrete reason.
- Keep playback state and library state separate where possible. The app should not re-render the whole library on every position tick.
- Use the existing components and theme tokens (`src/index.css`, `src/themes.ts`) instead of one-off styles.
- Keyboard accessibility matters: every icon-only control needs an `aria-label`.

### Database changes

- Add migrations; never rewrite an existing migration.
- Test both a fresh database and an upgrade from the previous schema.
- Keep the global `LibraryDb` mutex held only for short queries/transactions. Do not hold it while reading files or decoding audio.
- `file_path` is the unique identity of a track. External/open-with tracks are a known rough edge; see the roadmap before changing that model.

## Manual audio checklist

Before opening a playback PR, test what you can on real hardware:

- [ ] FLAC album plays gaplessly across a track boundary
- [ ] Seek forward/back during playback lands at the right time
- [ ] Pause/resume does not jump the playhead
- [ ] Exclusive mode on and off both work
- [ ] A 24-bit and a 96 kHz file play correctly
- [ ] EQ on/off and a preset change do not click
- [ ] ReplayGain off/track/album behave differently
- [ ] Rescan with files added, deleted and retagged
- [ ] Rename a file in Explorer and check the library
- [ ] Queue next/previous, shuffle and repeat-one

If you cannot test audio hardware, say so in the PR. Code review can still merge with unit tests and a clear note.

## Tests

- Add a Rust test for non-trivial DSP, database, scanner or parsing logic.
- Prefer small generated fixtures over committing large audio files.
- Frontend changes should at least pass `npm run build`.
- If you fix a bug, add a test that fails before the fix when practical.

## Commits and pull requests

- Write a descriptive PR title: `library: re-analyse changed files`, not `fix stuff`.
- Explain the problem, the approach and what you tested.
- Link the issue with `Fixes #123` when applicable.
- Include a screenshot or short recording for visible UI changes.
- Do not mix refactors with behaviour changes unless the refactor is required for the fix.
- Be responsive to review comments; maintainers review on a best-effort basis.

## License

Vynlore is MIT licensed. By submitting a contribution, you agree that it is your own work and that it may be distributed under the MIT license. There is no CLA and no copyright assignment.

## Questions

Open a [Discussion](https://github.com/dhanushbs10/vynlore/discussions) for design questions, setup help or “where does this code live?”. Use issues for reproducible bugs and concrete proposals.
