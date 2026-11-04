## What does this change?

<!-- A short description of the problem and the fix. -->

## Why?

<!-- Link the issue: Fixes #123. If there is no issue, explain the user impact. -->

## Area

- [ ] Audio engine / playback
- [ ] Library / scanning / tags
- [ ] UI / views
- [ ] Settings / system integration
- [ ] Playlists / M3U
- [ ] Documentation / tests / CI

## How was it tested?

<!-- Check everything that applies. -->

- [ ] `npm run build`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] Manual playback test on real hardware
- [ ] Added or updated a Rust test
- [ ] Not tested on audio hardware (explain why below)

### Manual checks

<!-- If this touches playback, list what you tried: FLAC gapless, seek, exclusive mode, 24-bit/96 kHz, EQ, ReplayGain, etc. -->

## Screenshots / recordings

<!-- Required for visible UI changes. Do not include personal file paths or user names. -->

## Checklist

- [ ] The change is focused on one concern.
- [ ] Existing behaviour and error handling were preserved.
- [ ] Database changes are additive and backward-compatible.
- [ ] No allocation, blocking lock, logging or file I/O was added to the realtime audio callback.
- [ ] No telemetry, analytics or new background network calls were added.
- [ ] Documentation was updated if behaviour, settings or limits changed.
- [ ] I have read [CONTRIBUTING.md](../CONTRIBUTING.md).

## Notes for reviewers

<!-- Anything risky, follow-up work, or parts you are unsure about. -->
