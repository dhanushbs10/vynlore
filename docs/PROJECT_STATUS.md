# Project status

**Snapshot:** v1.2.0 · reviewed 2026-11-04 · Windows 10/11
**Basis:** static review of the repository. This is a maintainer/contributor map, not a test report or a security audit. Runtime testing and hardware playback can change the details.

## What is solid

- **Real audio path.** Native Symphonia decoding, decode/DSP off the realtime thread, WASAPI exclusive output, shared-mode fallback, bounded sample queue and gapless chaining.
- **DSP depth.** Parametric EQ with limiter and coefficient smoothing, tempo/pitch, ReplayGain, resampling, balance/preamp.
- **Backend tests.** Player pipeline, DSP, EQ/limiter, ReplayGain, database and command parsing have meaningful Rust tests.
- **Local-first design.** SQLite library, folder watcher, cover deduplication. No account, no cloud library, no telemetry.
- **Security posture.** Strict CSP, minimal Tauri capabilities, path-restricted file reads, no remote script origins.
- **Maintainable split.** `commands.rs` is a clear IPC boundary; `audio/`, `decoder/` and `library/` have distinct responsibilities.

## What needs work

Ordered by user impact. See [ROADMAP.md](ROADMAP.md) for sequencing and starter tasks.

### Correctness / data

1. **Open with / double-click** builds a transient track with no tags, cover or duration and `id: -1`. Next/prev, shuffle, seeking, play counts and SMTC are degraded. The backend `add_external_track` command exists but is not called.
2. **Untagged files are rejected.** `read_metadata` returns an error when a file has no tag, so untagged WAV/AIFF files never enter the library.
3. **Changed files keep stale ReplayGain.** The scanner re-reads tags for changed files but skips loudness analysis when the path already has gain.
4. **Renames leave ghost rows.** The watcher re-adds the new path but does not remove the old row until the next startup prune.
5. **Failed seeks desync the playhead.** The control block is updated before the decoder seek succeeds; a failed seek only logs.
6. **Changing speed mid-track jumps the position.** The elapsed delta is multiplied by the new tempo without rebasing.

### Playback / output

7. **Mono and 5.1 files fail on stereo-only devices.** Output config selection requires an exact channel count; there is no downmix.
8. **WASAPI exclusive pause can jump the playhead.** `Stop()` + `Reset()` drops already-counted buffered audio.
9. **Crossfades longer than the queue lead are truncated.** The slider allows 8 s; the sample queue holds about 4 s.

### Scale

10. **100k-track libraries are not viable yet.** `get_tracks` returns every row including lyrics; the UI renders every row; scans trigger full reloads every 350 ms; playback position lives in the same context as the library, causing the whole tree to re-render twice per second.

### UX / library

11. **Scan failures are invisible on rescan/startup.** The UI can show progress for up to 10 minutes with no error.
12. **Album identity is title-only.** Different artists' same-titled albums merge; multi-disc order is ignored; album gain averages them together.
13. **Artist splitting is too aggressive.** `,`, `&` and `/` split legitimate names such as AC/DC and Earth, Wind & Fire.
14. **EQ A/B compare does not recall snapshots.** The inactive slot is overwritten with the current curve.
15. **Theme default is an invalid id** (`onyx` vs `builtin:onyx`), so first-run Settings shows no active theme.
16. **Artist detail crashes** if the selected artist has no tracks after a library refresh.
17. **M3U import is UTF-8 only** and BOM-sensitive; UTF-16 playlists fail.
18. **Theme/AutoEQ import rejects files outside a few folders** even when chosen in the file dialog.

### Release / infrastructure

19. **CI publishes without running tests.** The release workflow builds on tags but does not run `cargo test` (a CI test workflow is now included; wire it into branch protection).
20. **The installer is unsigned.** SmartScreen will warn; code signing is a distribution task.
21. **No auto-update.** Users must download new installers manually.
22. **No third-party notice bundle.** Symphonia (MPL-2.0) and other dependencies need notices in the installer.

## Extra scope (valuable, but not the core pitch)

These are real features, and they add maintenance cost:

- Custom JSON skins with raw CSS
- AutoEQ import
- ListenBrainz scrobbling
- Online LRCLIB lyrics
- Sleep timer
- Pitch/speed controls
- M3U import/export
- In-app tag editor
- Tray, notifications, autostart, SMTC
- Spectrum and waveform visualisations

**Recommendation:** keep them, but freeze new feature work until the correctness and scale items are done. Do not let “we also have skins” be the first thing a new user reads.

## Missing contributor infrastructure

Now added in this repo:

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `.github/ISSUE_TEMPLATE/` and `PULL_REQUEST_TEMPLATE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/PROJECT_STATUS.md` (this file)
- `docs/screenshots/` capture guide
- `.github/workflows/ci.yml` (frontend build + backend tests)

Still missing and worth doing:

- Screenshots and a short demo GIF in the README
- A signed installer
- Winget package
- GitHub Discussions enabled (the README links to it)
- `good first issue` and area labels on real issues
- A third-party license bundle generated by `cargo-about`
- Auto-update (Tauri updater) after the release process is stable

## How to help

- Pick a correctness item above and open a small PR with a test.
- Take a `good first issue` from the roadmap.
- Add screenshots/GIFs: see [screenshots/README.md](screenshots/README.md).
- Improve the manual audio checklist in [CONTRIBUTING.md](../CONTRIBUTING.md).
- Reproduce a bug on real hardware and add the device/format details.

Do not promote a “1.0” or a big launch until the open-with, untagged-file and large-library items are fixed. Those are the three that make a first impression fail.
