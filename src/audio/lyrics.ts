import type { Track } from "../types";

export interface OnlineLyrics {
  synced?: string;
  plain?: string;
}

const cache = new Map<string, OnlineLyrics>();

const LRCLIB_ENDPOINT = "https://lrclib.net/api/get";

/**
 * Fetches lyrics from LRCLIB (open, no API key) keyed off track/artist/album
 * and duration-matching. Returns the merged synced+plain object or null.
 * Results are cached per track id for the session.
 */
export async function fetchOnlineLyrics(track: Track): Promise<OnlineLyrics | null> {
  const key = track.id > 0 ? `id:${track.id}` : `path:${track.file_path}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams();
  if (track.title) params.set("track_name", track.title);
  if (track.artist) params.set("artist_name", track.artist);
  if (track.album) params.set("album_name", track.album);
  if (track.duration_secs > 0) params.set("duration", String(Math.round(track.duration_secs)));

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${LRCLIB_ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
    };
    const lyrics: OnlineLyrics = {
      synced: json.syncedLyrics || undefined,
      plain: json.plainLyrics || undefined,
    };
    if (!lyrics.synced && !lyrics.plain) return null;
    cache.set(key, lyrics);
    return lyrics;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}