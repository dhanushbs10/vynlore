# Roadmap

This is a living plan, not a promise. Priorities can change when a correctness bug or a security issue appears. If you want to work on something here, open or comment on an issue first so we can agree on the approach.

Current release: **v1.2.0**. The goal of the next releases is simple: **make the existing features trustworthy before adding new ones.**

## Now — v1.2.x correctness

These are the items that most affect whether a first-time user trusts the app. Small, well-tested PRs are welcome.

- [ ] **Open with / double-click:** register the file as a real track (tags, cover, duration, stable id) or pass full metadata to the UI without inserting a library row. Decide the product behaviour first.
- [ ] **Untagged files:** fall back to the file stem title and “Unknown Artist/Album” instead of rejecting the file.
- [ ] **Scan failure reporting:** emit a `Scan failed` event for rescan, startup scan and panic paths; add a shorter UI timeout.
- [ ] **SMTC lifecycle:** clearing metadata must not permanently disable taskbar controls. Reserve `ENABLED` for the user setting.
- [ ] **ReplayGain freshness:** re-analyse when `(mtime, size)` changes, not only when the path is absent from the cache.
- [ ] **Rename handling:** treat the old path of a rename as a removal; keep the stash/restore behaviour for atomic saves.
- [ ] **Seek failure:** only commit `track_start_frame` after the decoder seek succeeds, and surface the error.
- [ ] **Speed change:** rebase the playhead when tempo changes mid-track.
- [ ] **README accuracy:** keep the feature list aligned with the UI (speed range, open-with, crossfade limits).

## Next — v1.3 scale and polish

- [ ] **Large libraries:** paginate `get_tracks`, exclude lyrics from the list payload, virtualise the track list, and split playback position into its own context.
- [ ] **Output channel handling:** choose the device's supported layout and downmix/upmix, instead of requiring an exact channel match.
- [ ] **WASAPI pause accounting:** do not count audio that `Stop()` + `Reset()` discards.
- [ ] **Album identity:** key albums by title + album artist (and folder when needed); sort by disc then track.
- [ ] **Artist parsing:** stop splitting names on every comma, ampersand and slash; support explicit multi-value tags.
- [ ] **EQ A/B:** load stored snapshots correctly and keep side effects out of state updaters.
- [ ] **Theme default:** use the canonical `builtin:` id.
- [ ] **Artist empty state:** guard the detail page when no tracks match.
- [ ] **M3U import:** decode UTF-8/UTF-16 with BOM handling.
- [ ] **Import file scope:** let theme/AutoEQ import read the file the user picked, with clear errors.
- [ ] **Crossfade:** either extend the queue lead or document/cap the effective fade length.
- [ ] **CI:** run `cargo test` and `npm run build` on every PR (workflow added; enable branch protection).
- [ ] **Third-party notices:** generate and ship license notices.

## Later — distribution and platform

- [ ] Signed installer (SmartScreen)
- [ ] Winget package
- [ ] Auto-update (Tauri updater) once signing is stable
- [ ] Screenshots and a 15-second demo GIF in the README
- [ ] Installer size/startup-time pass
- [ ] macOS/Linux only if a maintainer commits to owning the audio backend; do not promise it before then

## Starter tasks (good first issue candidates)

These are self-contained and useful. Open an issue if one is not listed yet.

1. **Theme default id** — use `builtinId(BUILTIN_THEMES[0].id)` in `ThemeContext.tsx`.
2. **EQ A/B recall** — load the stored snapshot instead of overwriting it.
3. **Artist empty-state guard** — handle `artistTracks.length === 0`.
4. **M3U BOM/UTF-16** — add encoding detection and a fixture test.
5. **README screenshots** — capture library, now playing and EQ; add them to the README.
6. **Third-party notice generation** — add `cargo-about` config and a release step.
7. **CI test job** — verify the new workflow on a PR and make it required.
8. **Docs:** add a short “testing audio without hardware” section or improve the manual checklist.
9. **Error messages:** replace console-only failures in the player start path with a visible toast.
10. **Accessibility:** audit icon-only buttons for `aria-label` and keyboard focus.

## Non-goals

- Streaming services or a cloud music locker
- Accounts, telemetry or analytics
- Mobile apps
- A plugin ecosystem before the core is stable
- Supporting every codec; the decoder set is deliberate

## How to claim work

- Comment on the issue with your plan and ask for it to be assigned.
- If no issue exists, open one using the feature request template and mention that you want to implement it.
- Keep the first PR small. A fix plus a test is ideal.
- If you get stuck, say so in the issue; partial work and reproduction notes are still useful.
