# Screenshots and demo media

The README currently has no product screenshots. This folder is for the images that will go at the top of the README and in release notes.

## What to capture

| File | View | Notes |
|---|---|---|
| `library.png` | Tracks / library | A real-looking library with cover art, not an empty state |
| `now-playing.png` | Fullscreen now playing | Show artwork, lyrics/queue and transport |
| `eq.png` | EQ panel | Show the curve and a preset |
| `demo.gif` | 15–20 s | Queue → play → seek → gapless transition (or EQ change) |

Recommended size: **1280×800** or **1600×1000**, PNG, dark theme. Keep each file under ~2 MB. The GIF should be under ~8 MB.

## Rules

- Use a small, non-personal test library. Do not show real home directories, user names, email addresses or file paths.
- Use public-domain or self-owned cover art.
- Capture the current release, not a mock-up.
- Do not add fake UI or edit the app's appearance beyond normal settings.
- Prefer the default skin for the hero image; put skins in a separate screenshot.

## Windows capture

- **Screenshot:** `Win + Shift + S`, then save as PNG.
- **GIF:** [ScreenToGif](https://www.screentogif.com/) or `Win + G` recording, then convert with `gifski`.
- **Clean window:** hide other apps, disable notifications, use a neutral wallpaper.

## Adding to the README

1. Put files in this folder.
2. Add a hero image or GIF near the top of `README.md`, after the badges.
3. Add a `## Screenshots` section with the remaining images if they are useful.
4. Compress before committing; do not commit 20 MB recordings.

If you cannot capture the app on Windows, open an issue with a request instead of submitting placeholder art.
