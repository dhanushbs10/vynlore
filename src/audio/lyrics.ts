import type { Track } from "../types";

export interface OnlineLyrics {
  synced?: string;
  plain?: string;
}

const LRCLIB_ENDPOINT = "https://lrclib.net/api/get";

/** Positive results live for the whole session; negatives are remembered so a
 *  no-hit track isn't re-fetched every time it plays. */
const NEGATIVE_TTL_MS = 10 * 60 * 1000;

/** After a 429 / 5xx LRCLIB refuses traffic for a while — remember a global
 *  cooldown so we stop hammering the API instead of retrying hot. */
let globalCooldownUntil = 0;

const cache = new Map<string, { lyrics: OnlineLyrics | null; at: number }>();

function parseRetryAfter(h: string | null): number {
  if (!h) return 60;
  const secs = Number.parseInt(h, 10);
  return Number.isFinite(secs) && secs > 0 ? Math.min(secs, 300) : 60;
}

/**
 * Fetches lyrics from LRCLIB (open, no API key) keyed off track/artist/album
 * and duration-matching. Results are cached per track for the session, misses
 * get a short negative cache, and 429/5xx responses trigger a global backoff
 * so the app never thrashes the endpoint on a track with no lyrics.
 */
export async function fetchOnlineLyrics(track: Track): Promise<OnlineLyrics | null> {
  const key = track.id > 0 ? `id:${track.id}` : `path:${track.file_path}`;

  const cached = cache.get(key);
  if (cached) {
    if (cached.lyrics || Date.now() - cached.at < NEGATIVE_TTL_MS) return cached.lyrics;
  }
  if (Date.now() < globalCooldownUntil) return null;

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
    if (res.status === 429 || res.status >= 500) {
      globalCooldownUntil = Date.now() + parseRetryAfter(res.headers.get("retry-after")) * 1000;
      cache.set(key, { lyrics: null, at: Date.now() });
      return null;
    }
    if (!res.ok) {
      cache.set(key, { lyrics: null, at: Date.now() });
      return null;
    }
    const json = (await res.json()) as {
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
    };
    const lyrics: OnlineLyrics = {
      synced: json.syncedLyrics || undefined,
      plain: json.plainLyrics || undefined,
    };
    if (!lyrics.synced && !lyrics.plain) {
      cache.set(key, { lyrics: null, at: Date.now() });
      return null;
    }
    cache.set(key, { lyrics, at: Date.now() });
    return lyrics;
  } catch {
    cache.set(key, { lyrics: null, at: Date.now() });
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}