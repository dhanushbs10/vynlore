import type { Track } from "../types";

export interface ScrobbleState {
  enabled: boolean;
  token: string;
}

const LB_ENDPOINT = "https://api.listenbrainz.org/1/submit-listens";

/**
 * Reports a play to ListenBrainz (open, token-based scrobbling service).
 * Returns true when ListenBrainz accepted the listen.
 */
export async function scrobbleListenBrainz(
  token: string,
  track: Track
): Promise<boolean> {
  const clean = (token || "").trim();
  if (!clean) return false;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(LB_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${clean}`,
      },
      body: JSON.stringify({
        listen_type: "single",
        payload: [
          {
            listened_at: Math.floor(Date.now() / 1000),
            track_meta: {
              track_name: track.title || "Unknown",
              artist_name: track.artist || "Unknown Artist",
              release_name: track.album || undefined,
              additional_info: {
                duration_ms: Math.round((track.duration_secs || 0) * 1000),
                media_player: "Vynlore",
              },
            },
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("ListenBrainz rejected listen:", res.status, body.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.warn("ListenBrainz submit failed:", err);
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Pings ListenBrainz with the track currently playing ("playing_now"). Sent at
 * playback start / gapless boundary so the listen state shows up on
 * ListenBrainz immediately instead of only after completion. Non-fatal — the
 * finished-listen scrobble is still reported separately by
 * scrobbleListenBrainz.
 */
export async function submitPlayingNow(token: string, track: Track): Promise<boolean> {
  const clean = (token || "").trim();
  if (!clean) return false;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(LB_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${clean}`,
      },
      body: JSON.stringify({
        listen_type: "playing_now",
        payload: [
          {
            track_meta: {
              track_name: track.title || "Unknown",
              artist_name: track.artist || "Unknown Artist",
              release_name: track.album || undefined,
              additional_info: {
                duration_ms: Math.round((track.duration_secs || 0) * 1000),
                media_player: "Vynlore",
              },
            },
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("ListenBrainz playing_now rejected:", res.status, body.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.warn("ListenBrainz playing_now failed:", err);
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}