import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Track, RepeatMode } from "../types";
import {
  EQ_BANDS_HZ,
  EQ_MAX_GAIN,
  EQ_MAX_BOOST,
  EQ_PRESETS,
  MIN_BAND_COUNT,
  MAX_BAND_COUNT,
  DEFAULT_Q,
  defaultBandHz,
  defaultGains,
  defaultQs,
  presetForGenre,
} from "../audio/eqPresets";

const EQ_PRESET_KEYS = new Set(EQ_PRESETS.map((p) => p.key));

interface PlayerContextType {
    libraryTracks: Track[];
    displayedTracks: Track[];
    currentTrackIndex: number;
    currentTrack: Track | null;
    isPlaying: boolean;
    isPaused: boolean;
    selectedDevice: number | null;
    isShuffle: boolean;
    repeatMode: RepeatMode;
    currentTime: number;
    volume: number;
    exclusiveEnabled: boolean;
    exclusiveActive: boolean;
    eqEnabled: boolean;
    eqGains: number[];
    eqAuto: boolean;
    eqPreset: string | null;
    eqParametric: boolean;
    eqQs: number[];
    eqBandHz: number[];
    eqBandCount: number;
    eqBassBoostDb: number;
    eqTrebleBoostDb: number;
    seekTime: (time: number) => void;
    setSelectedDevice: (deviceIndex: number) => void;
    setVolume: (volume: number) => void;
    toggleExclusive: () => void;
    toggleEq: () => void;
    toggleEqAuto: () => void;
    toggleEqParametric: () => void;
    setEqBand: (bandIndex: number, gain: number) => void;
    setEqBandQ: (bandIndex: number, q: number) => void;
    setBandCount: (count: number) => void;
    setEqFreqs: (freqs: number[]) => void;
    setBassBoostDb: (db: number) => void;
    setTrebleBoostDb: (db: number) => void;
    applyEqPreset: (presetKey: string) => void;
    resetEq: () => void;
    playTrack: (track: Track, queue?: Track[]) => Promise<void>;
    togglePlayPause: () => void;
    toggleShuffle: () => void;
    toggleRepeat: () => void;
    stop: () => Promise<void>;
    playNext: () => Promise<void>;
    playPrev: () => Promise<void>;
    setLibraryTracks: (tracks: Track[]) => void;
    setDisplayedTracks: (tracks: Track[]) => void;
    reorderQueue: (from: number, to: number) => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

const VOLUME_KEY = "vynlore.volume";
const DEVICE_KEY = "vynlore.device";
const EXCLUSIVE_KEY = "vynlore.exclusive";
const EQ_KEY = "vynlore.eq";
const BALANCE_KEY = "vynlore.balance";
const PREAMP_KEY = "vynlore.preamp";

interface EqPersisted {
    enabled: boolean;
    gains: number[];
    auto: boolean;
    preset?: string | null;
    parametric?: boolean;
    qs?: number[];
    bandHz?: number[];
    bandCount?: number;
    bassBoostDb?: number;
    trebleBoostDb?: number;
}

function clampGain(g: number): number {
    const stepped = Math.round(g * 2) / 2;
    return Math.min(EQ_MAX_GAIN, Math.max(-EQ_MAX_GAIN, stepped));
}

function clampBoost(v: number): number {
    return Math.min(EQ_MAX_BOOST, Math.max(-EQ_MAX_BOOST, v));
}

function sanitizeGains(raw: unknown, count: number): number[] {
    if (!Array.isArray(raw)) return defaultGains(count);
    return Array.from({ length: count }, (_, i) => {
        const g = raw[i];
        return typeof g === "number" && Number.isFinite(g) ? clampGain(g) : 0;
    });
}

function sanitizeQs(raw: unknown, count: number): number[] {
    if (!Array.isArray(raw)) return defaultQs(count);
    return Array.from({ length: count }, (_, i) => {
        const q = raw[i];
        return typeof q === "number" && Number.isFinite(q) ? Math.min(10, Math.max(0.3, q)) : DEFAULT_Q;
    });
}

function sanitizeBandHz(raw: unknown, count: number): number[] {
    if (!Array.isArray(raw) || raw.length !== count) return defaultBandHz(count);
    return raw.map((v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 1000));
}

function loadStoredEq(): EqPersisted {
    try {
        const raw = window.localStorage.getItem(EQ_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<EqPersisted>;
            const bandCount = parsed.bandCount ?? (Array.isArray(parsed.gains) ? parsed.gains.length : EQ_BANDS_HZ.length);
            const safeCount = Math.min(MAX_BAND_COUNT, Math.max(MIN_BAND_COUNT, bandCount));
            return {
                enabled: parsed.enabled === true,
                gains: sanitizeGains(parsed.gains, safeCount),
                auto: parsed.auto !== false,
                parametric: parsed.parametric === true,
                qs: sanitizeQs(parsed.qs, safeCount),
                bandHz: sanitizeBandHz(parsed.bandHz, safeCount),
                bandCount: safeCount,
                bassBoostDb: typeof parsed.bassBoostDb === "number" ? clampBoost(parsed.bassBoostDb) : 0,
                trebleBoostDb: typeof parsed.trebleBoostDb === "number" ? clampBoost(parsed.trebleBoostDb) : 0,
            };
        }
    } catch {
        // localStorage unavailable / malformed
    }
    const count = EQ_BANDS_HZ.length;
    return {
        enabled: false,
        gains: defaultGains(count),
        auto: true,
        parametric: false,
        qs: defaultQs(count),
        bandHz: defaultBandHz(count),
        bandCount: count,
        bassBoostDb: 0,
        trebleBoostDb: 0,
    };
}

function loadStoredVolume(): number {
    try {
        const raw = window.localStorage.getItem(VOLUME_KEY);
        const parsed = raw === null ? NaN : Number(raw);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
    } catch {
        // localStorage unavailable
    }
    return 1.0;
}

function loadStoredDevice(): number | null {
    try {
        const raw = window.localStorage.getItem(DEVICE_KEY);
        const parsed = raw === null ? NaN : Number(raw);
        if (Number.isInteger(parsed) && parsed >= 1) return parsed;
    } catch {
        // localStorage unavailable
    }
    return null;
}

function loadStoredExclusive(): boolean {
    try {
        return window.localStorage.getItem(EXCLUSIVE_KEY) === "1";
    } catch {
        // localStorage unavailable
    }
    return false;
}

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [libraryTracks, _setLibraryTracks] = useState<Track[]>([]);
    const [displayedTracks, _setDisplayedTracks] = useState<Track[]>([]);
    const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
    const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const isPausedRef = useRef(isPaused);
    const [selectedDevice, setSelectedDeviceState] = useState<number | null>(() => loadStoredDevice());
    const [isShuffle, setIsShuffle] = useState(false);
    const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, _setVolume] = useState<number>(() => loadStoredVolume());
    const [exclusiveEnabled, setExclusiveEnabled] = useState<boolean>(() => loadStoredExclusive());
    const [exclusiveActive, setExclusiveActive] = useState(false);
    const storedEq = React.useMemo(() => loadStoredEq(), []);
    const [eqEnabled, setEqEnabled] = useState<boolean>(storedEq.enabled);
    const [eqGains, setEqGains] = useState<number[]>(storedEq.gains);
    const [eqAuto, setEqAuto] = useState<boolean>(storedEq.auto);
    const [eqPreset, setEqPreset] = useState<string | null>(storedEq.preset ?? null);
    const [eqParametric, setEqParametric] = useState<boolean>(storedEq.parametric ?? false);
    const [eqQs, setEqQs] = useState<number[]>(storedEq.qs ?? defaultQs(storedEq.bandCount ?? 10));
    const [eqBandHz, setEqBandHz] = useState<number[]>(storedEq.bandHz ?? defaultBandHz(storedEq.bandCount ?? 10));
    const [eqBandCount, setEqBandCountState] = useState<number>(storedEq.bandCount ?? EQ_BANDS_HZ.length);
    const [eqBassBoostDb, setEqBassBoostDbState] = useState<number>(storedEq.bassBoostDb ?? 0);
    const [eqTrebleBoostDb, setEqTrebleBoostDbState] = useState<number>(storedEq.trebleBoostDb ?? 0);

    const volumeRef = useRef(volume);
    const selectedDeviceRef = useRef(selectedDevice);
    const exclusiveRef = useRef(exclusiveEnabled);
    const eqEnabledRef = useRef(eqEnabled);
    const eqGainsRef = useRef(eqGains);
    const eqAutoRef = useRef(eqAuto);
    const eqSourceRef = useRef<string>("manual");
    const eqPresetRef = useRef(eqPreset);
    const eqParametricRef = useRef(eqParametric);
    const eqQsRef = useRef(eqQs);
    const eqBandHzRef = useRef(eqBandHz);
    const eqBandCountRef = useRef(eqBandCount);
    const eqBassBoostRef = useRef(eqBassBoostDb);
    const eqTrebleBoostRef = useRef(eqTrebleBoostDb);
    const displayedTracksRef = useRef(displayedTracks);
    const currentTrackRef = useRef(currentTrack);
    const repeatModeRef = useRef(repeatMode);
    const preShuffleQueueRef = useRef<Track[]>([]);
    const lastQueuedNextRef = useRef<string | null>(null);
    const playInFlightRef = useRef(false);
    const lastRequestedTrackRef = useRef<string>("");
    const actionsRef = useRef<{ togglePlayPause: () => void; playNext: () => Promise<void>; playPrev: () => Promise<void> }>({
        togglePlayPause: () => {},
        playNext: async () => {},
        playPrev: async () => {},
    });
    // Monotonically increasing counter that bumps every time a new playback
    // starts.  The polling interval reads this to discard stale get_position
    // results that were dispatched before setCurrentTime(0) was committed.
    const playbackGenerationRef = useRef(0);

    volumeRef.current = volume;
    selectedDeviceRef.current = selectedDevice;
    exclusiveRef.current = exclusiveEnabled;
    isPausedRef.current = isPaused;
    eqEnabledRef.current = eqEnabled;
    eqGainsRef.current = eqGains;
    eqAutoRef.current = eqAuto;
    eqPresetRef.current = eqPreset;
    eqParametricRef.current = eqParametric;
    eqQsRef.current = eqQs;
    eqBandHzRef.current = eqBandHz;
    eqBandCountRef.current = eqBandCount;
    eqBassBoostRef.current = eqBassBoostDb;
    eqTrebleBoostRef.current = eqTrebleBoostDb;
    displayedTracksRef.current = displayedTracks;
    currentTrackRef.current = currentTrack;
    repeatModeRef.current = repeatMode;

    const handlePlaybackEnded = useCallback(async () => {
        const track = currentTrackRef.current;
        if (!track) return;
        const mode = repeatModeRef.current;
        if (mode === "one") {
            await playTrack(track);
        } else {
            await playNextInternal();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!isTauri()) return;
        let disposed = false;
        let unlistenEnded: (() => void) | null = null;
        let unlistenChanged: (() => void) | null = null;
        let unlistenMedia: (() => void) | null = null;

        listen("playback-ended", () => {
            if (!disposed) void handlePlaybackEnded();
        }).then((fn) => {
            if (disposed) fn();
            else unlistenEnded = fn;
        });

        listen<{ path: string }>("track-changed", (event) => {
            if (disposed) return;
            if (event.payload.path !== lastRequestedTrackRef.current) return;
            const queue = displayedTracksRef.current;
            const idx = queue.findIndex((t) => t.file_path === event.payload.path);
            if (idx === -1) return;
            setCurrentTime(0);
            setCurrentTrackIndex(idx);
            setCurrentTrack(queue[idx]);
        }).then((fn) => {
            if (disposed) fn();
            else unlistenChanged = fn;
        });

        listen<string>("media-key", (event) => {
            if (disposed) return;
            switch (event.payload) {
                case "play-pause":
                    actionsRef.current.togglePlayPause();
                    break;
                case "next":
                    void actionsRef.current.playNext();
                    break;
                case "prev":
                    void actionsRef.current.playPrev();
                    break;
            }
        }).then((fn) => {
            if (disposed) fn();
            else unlistenMedia = fn;
        });

        return () => {
            disposed = true;
            unlistenEnded?.();
            unlistenChanged?.();
            unlistenMedia?.();
        };
    }, [handlePlaybackEnded]);

    useEffect(() => {
        if (!isTauri()) return;
        let desired: string | null = null;
        if (currentTrack && repeatMode !== "one") {
            const idx = displayedTracks.findIndex((t) => t.id === currentTrack.id);
            if (idx !== -1) {
                const raw =
                    idx + 1 < displayedTracks.length
                        ? displayedTracks[idx + 1]
                        : repeatMode === "all"
                          ? displayedTracks[0]
                          : null;
                if (raw) {
                    desired = raw.file_path;
                }
            }
        }
        if (desired === lastQueuedNextRef.current) return;
        lastQueuedNextRef.current = desired;
        invoke("queue_next_track", { nextPath: desired }).catch(() => {
            lastQueuedNextRef.current = null;
        });
    }, [currentTrack, displayedTracks, repeatMode]);

    useEffect(() => {
        if (!isTauri()) return;
        if (!currentTrack || !isPlaying || isPaused) return;

        const poll = window.setInterval(async () => {
            try {
                const gen = playbackGenerationRef.current;
                const pos = await invoke<number>("get_position");
                // Discard stale results from a poll that was dispatched before
                // the most recent setCurrentTime(0) in playTrack.  Without this,
                // an in-flight get_position could briefly overwrite the reset to
                // 0 with the old track's final position.
                if (gen !== playbackGenerationRef.current) return;
                setCurrentTime(pos);
            } catch {
                // backend stream gone; next tick or track change recovers
            }
        }, 250);

        return () => window.clearInterval(poll);
    }, [currentTrack, isPlaying, isPaused]);

    const simulateTimerRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (isTauri()) return;
        if (!currentTrack || !isPlaying || isPaused) return;

        simulateTimerRef.current = window.setInterval(() => {
            setCurrentTime((t) => {
                const next = t + 0.25;
                if (next >= currentTrack.duration_secs) {
                    void handlePlaybackEnded();
                    return 0;
                }
                return next;
            });
        }, 250);

        return () => {
            if (simulateTimerRef.current) window.clearInterval(simulateTimerRef.current);
        };
    }, [currentTrack, isPlaying, isPaused, handlePlaybackEnded]);

    const setLibraryTracks = useCallback((tracks: Track[]) => {
        _setLibraryTracks(tracks);
        if (displayedTracksRef.current.length === 0) _setDisplayedTracks(tracks);
    }, []);

    const setDisplayedTracks = useCallback((tracks: Track[]) => {
        _setDisplayedTracks(tracks);
    }, []);

    const reorderQueue = useCallback((from: number, to: number) => {
        const prev = displayedTracksRef.current;
        if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        _setDisplayedTracks(next);
        const currentId = currentTrackRef.current?.id;
        setCurrentTrackIndex(currentId === undefined ? -1 : next.findIndex((t) => t.id === currentId));
    }, []);

    const setSelectedDevice = useCallback((deviceIndex: number) => {
        setSelectedDeviceState(deviceIndex);
        try {
            window.localStorage.setItem(DEVICE_KEY, String(deviceIndex));
        } catch {
            // ignore
        }
    }, []);

    const setVolume = useCallback((newVolume: number) => {
        const clamped = Math.min(1, Math.max(0, newVolume));
        _setVolume(clamped);
        try {
            window.localStorage.setItem(VOLUME_KEY, String(clamped));
        } catch {
            // ignore
        }
        if (isTauri()) {
            invoke("set_volume", { volume: clamped }).catch(() => {});
        }
    }, []);

    useEffect(() => {
        if (isTauri()) {
            invoke("set_volume", { volume: volumeRef.current }).catch(() => {});
            try {
                const balRaw = window.localStorage.getItem(BALANCE_KEY);
                if (balRaw !== null) {
                    const bal = Number(balRaw);
                    if (Number.isFinite(bal)) invoke("set_balance", { balance: bal }).catch(() => {});
                }
                const preRaw = window.localStorage.getItem(PREAMP_KEY);
                if (preRaw !== null) {
                    const pre = Number(preRaw);
                    if (Number.isFinite(pre)) invoke("set_preamp", { preamp: Math.max(0.5, pre) }).catch(() => {});
                }
            } catch { /* ignore */ }
        }
    }, []);

    // --- EQ plumbing ---

    const pushEq = useCallback((
        enabled: boolean,
        gains: number[],
        parametric: boolean,
        qs: number[],
        bandHz: number[],
        bassBoostDb: number,
        trebleBoostDb: number,
    ) => {
        if (!isTauri()) return;
        invoke("update_eq", {
            enabled,
            gains,
            parametric,
            qs,
            bandHz,
            bassBoostDb,
            trebleBoostDb,
        }).catch(() => {});
    }, []);

    useEffect(() => {
        pushEq(
            eqEnabledRef.current,
            eqGainsRef.current,
            eqParametricRef.current,
            eqQsRef.current,
            eqBandHzRef.current,
            eqBassBoostRef.current,
            eqTrebleBoostRef.current,
        );
    }, [pushEq]);

    const persistEq = useCallback((
        enabled: boolean,
        gains: number[],
        auto: boolean,
        preset: string | null,
        parametric: boolean,
        qs: number[],
        bandHz: number[],
        bandCount: number,
        bassBoostDb: number,
        trebleBoostDb: number,
    ) => {
        try {
            window.localStorage.setItem(
                EQ_KEY,
                JSON.stringify({
                    enabled,
                    gains,
                    auto,
                    preset,
                    parametric,
                    qs,
                    bandHz,
                    bandCount,
                    bassBoostDb,
                    trebleBoostDb,
                } satisfies EqPersisted)
            );
        } catch {
            // localStorage unavailable
        }
    }, []);

    const applyEqGains = useCallback(
        (gains: number[], source: string) => {
            const safe = sanitizeGains(gains, eqBandCountRef.current);
            eqSourceRef.current = source;
            setEqGains(safe);
            eqGainsRef.current = safe;
            const presetKey = source.startsWith("auto:") ? source.slice(5) : source;
            setEqPreset(EQ_PRESET_KEYS.has(presetKey) ? presetKey : null);
            persistEq(
                eqEnabledRef.current, safe, eqAutoRef.current,
                EQ_PRESET_KEYS.has(presetKey) ? presetKey : null,
                eqParametricRef.current, eqQsRef.current, eqBandHzRef.current,
                eqBandCountRef.current, eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
            pushEq(
                eqEnabledRef.current, safe,
                eqParametricRef.current, eqQsRef.current, eqBandHzRef.current,
                eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
        },
        [persistEq, pushEq]
    );

    const setEqBand = useCallback(
        (bandIndex: number, gain: number) => {
            if (bandIndex < 0 || bandIndex >= eqGainsRef.current.length) return;
            const next = [...eqGainsRef.current];
            next[bandIndex] = clampGain(gain);
            applyEqGains(next, "manual");
        },
        [applyEqGains]
    );

    const setEqBandQ = useCallback(
        (bandIndex: number, q: number) => {
            if (bandIndex < 0 || bandIndex >= eqQsRef.current.length) return;
            const next = [...eqQsRef.current];
            next[bandIndex] = Math.min(10, Math.max(0.3, q));
            setEqQs(next);
            eqQsRef.current = next;
            persistEq(
                eqEnabledRef.current, eqGainsRef.current, eqAutoRef.current,
                eqPresetRef.current,
                eqParametricRef.current, next, eqBandHzRef.current,
                eqBandCountRef.current, eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
            pushEq(
                eqEnabledRef.current, eqGainsRef.current,
                eqParametricRef.current, next, eqBandHzRef.current,
                eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
        },
        [persistEq, pushEq]
    );

    const toggleEqParametric = useCallback(() => {
        setEqParametric((prev) => {
            const next = !prev;
            eqParametricRef.current = next;
            persistEq(
                eqEnabledRef.current, eqGainsRef.current, eqAutoRef.current,
                eqPresetRef.current,
                next, eqQsRef.current, eqBandHzRef.current,
                eqBandCountRef.current, eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
            pushEq(
                eqEnabledRef.current, eqGainsRef.current,
                next, eqQsRef.current, eqBandHzRef.current,
                eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
            return next;
        });
    }, [persistEq, pushEq]);

    const setBandCount = useCallback(
        (count: number) => {
            const safeCount = Math.min(MAX_BAND_COUNT, Math.max(MIN_BAND_COUNT, count));
            const newHz = defaultBandHz(safeCount);
            const newGains = defaultGains(safeCount);
            const newQs = defaultQs(safeCount);
            setEqBandCountState(safeCount);
            eqBandCountRef.current = safeCount;
            setEqBandHz(newHz);
            eqBandHzRef.current = newHz;
            setEqGains(newGains);
            eqGainsRef.current = newGains;
            setEqQs(newQs);
            eqQsRef.current = newQs;
            setEqPreset(null);
            eqSourceRef.current = "manual";
            persistEq(
                eqEnabledRef.current, newGains, eqAutoRef.current,
                null,
                eqParametricRef.current, newQs, newHz,
                safeCount, eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
            pushEq(
                eqEnabledRef.current, newGains,
                eqParametricRef.current, newQs, newHz,
                eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
        },
        [persistEq, pushEq]
    );

    const setEqFreqs = useCallback(
        (freqs: number[]) => {
            if (freqs.length < MIN_BAND_COUNT || freqs.length > MAX_BAND_COUNT) return;
            const safeFreqs = freqs.map((f) => (Number.isFinite(f) && f > 0 ? f : 1000));
            const newGains = Array.from({ length: safeFreqs.length }, (_, i) => eqGainsRef.current[i] ?? 0);
            const newQs = Array.from({ length: safeFreqs.length }, (_, i) => eqQsRef.current[i] ?? DEFAULT_Q);
            setEqBandHz(safeFreqs);
            eqBandHzRef.current = safeFreqs;
            setEqBandCountState(safeFreqs.length);
            eqBandCountRef.current = safeFreqs.length;
            setEqGains(newGains);
            eqGainsRef.current = newGains;
            setEqQs(newQs);
            eqQsRef.current = newQs;
            persistEq(
                eqEnabledRef.current, newGains, eqAutoRef.current,
                eqPresetRef.current,
                eqParametricRef.current, newQs, safeFreqs,
                safeFreqs.length, eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
            pushEq(
                eqEnabledRef.current, newGains,
                eqParametricRef.current, newQs, safeFreqs,
                eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
        },
        [persistEq, pushEq]
    );

    const setBassBoostDb = useCallback(
        (db: number) => {
            const clamped = clampBoost(db);
            setEqBassBoostDbState(clamped);
            eqBassBoostRef.current = clamped;
            persistEq(
                eqEnabledRef.current, eqGainsRef.current, eqAutoRef.current,
                eqPresetRef.current,
                eqParametricRef.current, eqQsRef.current, eqBandHzRef.current,
                eqBandCountRef.current, clamped, eqTrebleBoostRef.current,
            );
            pushEq(
                eqEnabledRef.current, eqGainsRef.current,
                eqParametricRef.current, eqQsRef.current, eqBandHzRef.current,
                clamped, eqTrebleBoostRef.current,
            );
        },
        [persistEq, pushEq]
    );

    const setTrebleBoostDb = useCallback(
        (db: number) => {
            const clamped = clampBoost(db);
            setEqTrebleBoostDbState(clamped);
            eqTrebleBoostRef.current = clamped;
            persistEq(
                eqEnabledRef.current, eqGainsRef.current, eqAutoRef.current,
                eqPresetRef.current,
                eqParametricRef.current, eqQsRef.current, eqBandHzRef.current,
                eqBandCountRef.current, eqBassBoostRef.current, clamped,
            );
            pushEq(
                eqEnabledRef.current, eqGainsRef.current,
                eqParametricRef.current, eqQsRef.current, eqBandHzRef.current,
                eqBassBoostRef.current, clamped,
            );
        },
        [persistEq, pushEq]
    );

    const applyEqPreset = useCallback(
        (presetKey: string) => {
            const preset = EQ_PRESETS.find((p) => p.key === presetKey);
            if (!preset) return;
            applyEqGains([...preset.gains], preset.key);
        },
        [applyEqGains]
    );

    const resetEq = useCallback(() => {
        applyEqGains(defaultGains(eqBandCountRef.current), "flat");
    }, [applyEqGains]);

    const toggleEq = useCallback(() => {
        setEqEnabled((prev) => {
            const next = !prev;
            eqEnabledRef.current = next;
            persistEq(
                next, eqGainsRef.current, eqAutoRef.current,
                eqPresetRef.current,
                eqParametricRef.current, eqQsRef.current, eqBandHzRef.current,
                eqBandCountRef.current, eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
            pushEq(
                next, eqGainsRef.current,
                eqParametricRef.current, eqQsRef.current, eqBandHzRef.current,
                eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
            return next;
        });
    }, [persistEq, pushEq]);

    const toggleEqAuto = useCallback(() => {
        setEqAuto((prev) => {
            const next = !prev;
            eqAutoRef.current = next;
            persistEq(
                eqEnabledRef.current, eqGainsRef.current, next,
                eqPresetRef.current,
                eqParametricRef.current, eqQsRef.current, eqBandHzRef.current,
                eqBandCountRef.current, eqBassBoostRef.current, eqTrebleBoostRef.current,
            );
            if (next) {
                const preset = presetForGenre(currentTrackRef.current?.genre);
                if (preset && eqSourceRef.current !== `auto:${preset.key}`) {
                    applyEqGains([...preset.gains], `auto:${preset.key}`);
                }
            }
            return next;
        });
    }, [persistEq, applyEqGains]);

    useEffect(() => {
        if (!eqAutoRef.current) return;
        const preset = presetForGenre(currentTrack?.genre);
        if (!preset) return;
        if (eqSourceRef.current === `auto:${preset.key}`) return;
        applyEqGains([...preset.gains], `auto:${preset.key}`);
    }, [currentTrack?.genre, applyEqGains]);

    useEffect(() => {
        document.title = currentTrack
            ? `${currentTrack.artist} – ${currentTrack.title} · Vynlore`
            : "Vynlore";
    }, [currentTrack]);

    const seekTime = useCallback((time: number) => {
        setCurrentTime(Math.max(0, time));
        if (isTauri()) {
            invoke("seek_playback", { seekSecs: time }).catch((err) =>
                console.error("Seek failed:", err)
            );
        }
    }, []);

    async function playNextInternal(): Promise<void> {
        const queue = displayedTracksRef.current;
        if (queue.length === 0) return;
        const mode = repeatModeRef.current;
        let idx = queue.findIndex((t) => t.id === currentTrackRef.current?.id);
        idx = idx === -1 ? 0 : idx;
        const nextIndex =
            idx + 1 < queue.length ? idx + 1 : mode === "all" ? 0 : -1;
        if (nextIndex === -1) {
            await stop();
            return;
        }
        setCurrentTrackIndex(nextIndex);
        await playTrack(queue[nextIndex]);
    }

    const playTrack = useCallback(async (track: Track, newQueue?: Track[]) => {
        // Dedup guard: only block if a playback start is already in flight.
        // This prevents rapid double-invocation (overlapping stop→play) while
        // still allowing repeat-one restarts and replays of the same track
        // once the previous start has completed.
        if (playInFlightRef.current) return;
        playInFlightRef.current = true;

        try {
            if (newQueue) {
                preShuffleQueueRef.current = [...displayedTracksRef.current];
                _setDisplayedTracks(newQueue);
                const idx = newQueue.findIndex((t) => t.id === track.id);
                setCurrentTrackIndex(idx !== -1 ? idx : 0);
            } else if (displayedTracksRef.current.length === 0) {
                _setDisplayedTracks([track]);
                setCurrentTrackIndex(0);
            }

            playbackGenerationRef.current += 1;
            lastRequestedTrackRef.current = track.file_path;
            setCurrentTime(0);
            setCurrentTrack(track);
            setIsPlaying(true);
            setIsPaused(false);

            try {
                await invoke("stop_playback");
                const active = await invoke<boolean>("play_track", {
                    filePath: track.file_path,
                    deviceIndex: selectedDeviceRef.current,
                    exclusive: exclusiveRef.current,
                });
                setExclusiveActive(active);
                if (lastRequestedTrackRef.current !== track.file_path) return;
                invoke("increment_play_count", { filePath: track.file_path }).catch(() => {});
            } catch (error) {
                console.error("Failed to play track:", error);
                setIsPlaying(false);
            }
        } finally {
            playInFlightRef.current = false;
        }
    }, []);

    const toggleExclusive = useCallback(() => {
        setExclusiveEnabled((prev) => {
            const next = !prev;
            exclusiveRef.current = next;
            try {
                window.localStorage.setItem(EXCLUSIVE_KEY, next ? "1" : "0");
            } catch {
                // localStorage unavailable
            }
            if (isTauri() && currentTrackRef.current) {
                void playTrack(currentTrackRef.current);
            }
            return next;
        });
    }, [playTrack]);

    const togglePlayPause = useCallback(async () => {
        if (!currentTrackRef.current) return;
        try {
            if (isPausedRef.current) {
                await invoke("resume_playback");
                setIsPaused(false);
            } else {
                await invoke("pause_playback");
                setIsPaused(true);
            }
        } catch (error) {
            console.error("Failed to toggle playback:", error);
        }
    }, []);

    const shufflePreservingCurrent = useCallback((tracks: Track[], currentIndex: number): Track[] => {
        const current = tracks[currentIndex] ?? tracks[0];
        const without = tracks.filter((t) => t.id !== current.id);
        for (let i = without.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [without[i], without[j]] = [without[j], without[i]];
        }
        return [current, ...without];
    }, []);

    const toggleShuffle = useCallback(() => {
        const newShuffle = !isShuffle;
        setIsShuffle(newShuffle);

        if (newShuffle) {
            preShuffleQueueRef.current = [...displayedTracksRef.current];
            if (displayedTracksRef.current.length > 1 && currentTrackRef.current) {
                const idx = displayedTracksRef.current.findIndex(
                    (t) => currentTrackRef.current && t.id === currentTrackRef.current.id
                );
                const shuffled = shufflePreservingCurrent([...displayedTracksRef.current], idx >= 0 ? idx : 0);
                _setDisplayedTracks(shuffled);
                setCurrentTrackIndex(0);
            }
        } else {
            const restored =
                preShuffleQueueRef.current.length > 0
                    ? [...preShuffleQueueRef.current]
                    : [...displayedTracksRef.current];
            const cur = currentTrackRef.current;
            const idx = cur ? restored.findIndex((t) => t.id === cur.id) : -1;
            _setDisplayedTracks(restored);
            setCurrentTrackIndex(idx >= 0 ? idx : 0);
        }
    }, [isShuffle, shufflePreservingCurrent]);

    const toggleRepeat = useCallback(() => {
        setRepeatMode((prev) => {
            if (prev === "off") return "all";
            if (prev === "all") return "one";
            return "off";
        });
    }, []);

    const stop = useCallback(async () => {
        try {
            await invoke("stop_playback");
        } catch (error) {
            console.error("Failed to stop playback:", error);
        }
        setIsPlaying(false);
        setIsPaused(false);
        setCurrentTrack(null);
        setCurrentTime(0);
        setCurrentTrackIndex(-1);
    }, []);

    const playPrev = useCallback(async () => {
        const queue = displayedTracksRef.current;
        if (queue.length === 0) return;
        let idx = queue.findIndex((t) => t.id === currentTrackRef.current?.id);
        idx = idx === -1 ? 0 : idx;
        const prevIndex = idx - 1 >= 0 ? idx - 1 : queue.length - 1;
        setCurrentTrackIndex(prevIndex);
        await playTrack(queue[prevIndex]);
    }, [playTrack]);

    const playNext = playNextInternal;

    actionsRef.current = { togglePlayPause, playNext, playPrev };

    return (
        <PlayerContext.Provider
            value={{
                libraryTracks,
                displayedTracks,
                currentTrackIndex,
                currentTrack,
                isPlaying,
                isPaused,
                selectedDevice,
                isShuffle,
                repeatMode,
                currentTime,
                volume,
                exclusiveEnabled,
                exclusiveActive,
                eqEnabled,
                eqGains,
                eqAuto,
                eqPreset,
                eqParametric,
                eqQs,
                eqBandHz,
                eqBandCount,
                eqBassBoostDb,
                eqTrebleBoostDb,
                seekTime,
                setSelectedDevice,
                setVolume,
                toggleExclusive,
                toggleEq,
                toggleEqAuto,
                toggleEqParametric,
                setEqBand,
                setEqBandQ,
                setBandCount,
                setEqFreqs,
                setBassBoostDb,
                setTrebleBoostDb,
                applyEqPreset,
                resetEq,
                playTrack,
                setLibraryTracks,
                setDisplayedTracks,
                reorderQueue,
                togglePlayPause,
                toggleShuffle,
                toggleRepeat,
                stop,
                playNext,
                playPrev,
            }}
        >
            {children}
        </PlayerContext.Provider>
    );
};

export const usePlayer = () => {
    const context = useContext(PlayerContext);
    if (context === undefined) {
        throw new Error("usePlayer must be used within a PlayerProvider");
    }
    return context;
};
