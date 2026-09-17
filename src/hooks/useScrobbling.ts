import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "../types";
import { scrobbleListenBrainz, submitPlayingNow } from "../audio/scrobble";

const SCROBBLE_ENABLED_KEY = "vynlore.scrobble.enabled";
const SCROBBLE_TOKEN_KEY = "vynlore.scrobble.token";
const MAX_SCROBBLE_TRIES = 3;

function loadStoredFlag(key: string): boolean {
    try {
        return window.localStorage.getItem(key) === "1";
    } catch {
        return false;
    }
}

function loadStoredToken(): string {
    try {
        return window.localStorage.getItem(SCROBBLE_TOKEN_KEY) ?? "";
    } catch {
        return "";
    }
}

interface Scrobbling {
    scrobbleEnabled: boolean;
    scrobbleToken: string;
    setScrobbleEnabled: (enabled: boolean) => void;
    setScrobbleToken: (token: string) => void;
    maybeScrobble: (track: Track | null, playedSecs: number) => void;
    markNowPlaying: (track: Track | null) => void;
}

/**
 * ListenBrainz scrobbling with a durable retry queue. A listen qualifies at
 * 75% of the track or 4+ minutes, and each file scrobbles at most once in a
 * row. Failures aren't dropped silently — they're re-queued with a retry
 * budget and flushed on an interval so a transient offline blip doesn't lose
 * a listen.
 */
export function useScrobbling(): Scrobbling {
    const [scrobbleEnabled, setScrobbleEnabledState] = useState<boolean>(() => loadStoredFlag(SCROBBLE_ENABLED_KEY));
    const [scrobbleToken, setScrobbleTokenState] = useState<string>(() => loadStoredToken());

    const scrobbleEnabledRef = useRef(scrobbleEnabled);
    const scrobbleTokenRef = useRef(scrobbleToken);
    const lastScrobbledPathRef = useRef<string | null>(null);
    const pendingScrobbleRef = useRef<{ track: Track; tries: number }[]>([]);
    const lastNowPlayingPathRef = useRef<string | null>(null);

    scrobbleEnabledRef.current = scrobbleEnabled;
    scrobbleTokenRef.current = scrobbleToken;

    const setScrobbleEnabled = useCallback((enabled: boolean) => {
        setScrobbleEnabledState(enabled);
        scrobbleEnabledRef.current = enabled;
        try {
            window.localStorage.setItem(SCROBBLE_ENABLED_KEY, enabled ? "1" : "0");
        } catch {
            // ignore
        }
    }, []);

    const setScrobbleToken = useCallback((token: string) => {
        setScrobbleTokenState(token);
        scrobbleTokenRef.current = token;
        try {
            window.localStorage.setItem(SCROBBLE_TOKEN_KEY, token);
        } catch {
            // ignore
        }
    }, []);

    const flushScrobbleQueue = useCallback(() => {
        const token = scrobbleTokenRef.current;
        if (!scrobbleEnabledRef.current || !token.trim()) return;
        const queue = pendingScrobbleRef.current;
        if (queue.length === 0) return;
        const snapshot = [...queue];
        pendingScrobbleRef.current = [];
        snapshot.forEach((item) => {
            void scrobbleListenBrainz(token, item.track)
                .then((ok) => {
                    if (!ok && item.tries + 1 < MAX_SCROBBLE_TRIES) {
                        pendingScrobbleRef.current.push({ track: item.track, tries: item.tries + 1 });
                    }
                })
                .catch(() => {
                    if (item.tries + 1 < MAX_SCROBBLE_TRIES) {
                        pendingScrobbleRef.current.push({ track: item.track, tries: item.tries + 1 });
                    }
                });
        });
    }, []);

    useEffect(() => {
        const id = window.setInterval(() => flushScrobbleQueue(), 30_000);
        return () => window.clearInterval(id);
    }, [flushScrobbleQueue]);

    const maybeScrobble = useCallback(
        (track: Track | null, playedSecs: number) => {
            if (!track || !scrobbleEnabledRef.current || !scrobbleTokenRef.current.trim()) return;
            const dur = track.duration_secs || 0;
            const qualifying = dur > 30 && (playedSecs >= dur * 0.75 || (dur > 0 && playedSecs >= 240));
            if (!qualifying) return;
            if (lastScrobbledPathRef.current === track.file_path) return;
            lastScrobbledPathRef.current = track.file_path;
            pendingScrobbleRef.current.push({ track, tries: 0 });
            flushScrobbleQueue();
        },
        [flushScrobbleQueue],
    );

    const markNowPlaying = useCallback((track: Track | null) => {
        if (!track || !scrobbleEnabledRef.current || !scrobbleTokenRef.current.trim()) return;
        // Guard against re-pinging on resume/seek/position polls for the same
        // file — only a real playback *start* deserves a heartbeat.
        if (lastNowPlayingPathRef.current === track.file_path) return;
        lastNowPlayingPathRef.current = track.file_path;
        void submitPlayingNow(scrobbleTokenRef.current, track);
    }, []);

    return { scrobbleEnabled, scrobbleToken, setScrobbleEnabled, setScrobbleToken, maybeScrobble, markNowPlaying };
}