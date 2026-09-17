# Changelog

## v1.2.0

### New features

- Playback speed (0.25x–4x, pitch-preserving WSOLA) and pitch shift (±12 semitones)
- Crossfade between tracks (0–8s) layered over gapless playback
- ReplayGain loudness normalization (off / per-track / per-album, EBU R128 flavour)
- Custom skins: import, export, and theme the whole UI from JSON files
- Sleep timer, ListenBrainz scrobbling, online lyrics (LRCLIB) with synced display
- In-app tag editor, M3U playlist import/export, AutoEQ profile import
- Balance, preamp, per-device output selection
- System tray, taskbar media controls (SMTC), media keys, track notifications
- Double-click any audio file to play it (file association)

### Fixed

- High-sample-rate files (96/176.4 kHz) stuttering or going silent: the resampler
  now scales its filter to the conversion depth instead of choking realtime
- 24-bit playback verified end-to-end (decode → resample → output) with new
  integration tests
- Seeking with crossfade or a queued next track no longer mis-fires fades or
  jumps position
- M3U export, ListenBrainz scrobbling and online lyrics (were silently
  blocked/broken)
- EQ and ReplayGain on surround (>2ch) files; loudness-analysis crash on
  surround files
- Library wipes: startup prune skips when the music drive is offline; retagged
  files keep likes, play counts and analysis
- Retagged/edited files refresh instantly; changed files get fresh loudness
  analysis
- Much faster library scans (parallel workers, no idle sleeping) with live
  progress that no longer sticks at 0
- Waveforms now cover full hi-res files instead of truncating after ~17 seconds
- Same-title albums by different artists get independent album gain;
  compilations still level as one release
- Dozens of smaller UI, state and robustness fixes across the app

### Known quirks

- While exclusive mode holds the device, other apps go silent (by design). After
  exclusive mode is released, Chrome/YouTube often stays stuck on "Audio
  renderer error" — refresh the tab and sound comes back.
