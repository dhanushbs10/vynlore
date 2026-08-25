import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Track, RepeatMode } from "../types";
import { EQ_BANDS_HZ, EQ_MAX_GAIN, EQ_PRESETS, presetForGenre } from "../audio/eqPresets";

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
    seekTime: (time: number) => void;
    setSelectedDevice: (deviceIndex: number) => void;
    setVolume: (volume: number) => void;
    toggleExclusive: () => void;
    toggleEq: () => void;
    toggleEqAuto: () => void;
    setEqBand: (bandIndex: number, gain: number) => void;
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
}

const DEFAULT_EQ_GAINS: number[] = new Array(EQ_BANDS_HZ.length).fill(0);

function clampGain(g: number): number {
    const stepped = Math.round(g * 2) / 2;
    return Math.min(EQ_MAX_GAIN, Math.max(-EQ_MAX_GAIN, stepped));
}

function sanitizeGains(raw: unknown): number[] {
    if (!Array.isArray(raw) || raw.length !== EQ_BANDS_HZ.length) return [...DEFAULT_EQ_GAINS];
    return raw.map((g) => (typeof g === "number" && Number.isFinite(g) ? clampGain(g) : 0));
}

function loadStoredEq(): EqPersisted {
    try {
        const raw = window.localStorage.getItem(EQ_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<EqPersisted>;
            return {
                enabled: parsed.enabled === true,
                gains: sanitizeGains(parsed.gains),
                auto: parsed.auto !== false,
            };
        }
    } catch {
        // localStorage unavailable / malformed
    }
    return { enabled: false, gains: [...DEFAULT_EQ_GAINS], auto: true };
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
    const [selectedDevice, setSelectedDeviceState] = useState<number | null>(() => loadStoredDevice());
    const [isShuffle, setIsShuffle] = useState(false);
    const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, _setVolume] = useState<number>(() => loadStoredVolume());
    const [exclusiveEnabled, setExclusiveEnabled] = useState<boolean>(() => loadStoredExclusive());
    const [exclusiveActive, setExclusiveActive] = useState(false);
    const [eqEnabled, setEqEnabled] = useState<boolean>(() => loadStoredEq().enabled);
    const [eqGains, setEqGains] = useState<number[]>(() => loadStoredEq().gains);
    const [eqAuto, setEqAuto] = useState<boolean>(() => loadStoredEq().auto);
    const [eqPreset, setEqPreset] = useState<string | null>(null);

    const volumeRef = useRef(volume);
    const selectedDeviceRef = useRef(selectedDevice);
    const exclusiveRef = useRef(exclusiveEnabled);
    const eqEnabledRef = useRef(eqEnabled);
    const eqGainsRef = useRef(eqGains);
    const eqAutoRef = useRef(eqAuto);
    const eqSourceRef = useRef<string>("manual");
    const displayedTracksRef = useRef(displayedTracks);
    const currentTrackRef = useRef(currentTrack);
    const repeatModeRef = useRef(repeatMode);
    const preShuffleQueueRef = useRef<Track[]>([]);
    const lastQueuedNextRef = useRef<string | null>(null);
    const actionsRef = useRef<{ togglePlayPause: () => void; playNext: () => Promise<void>; playPrev: () => Promise<void> }>({
        togglePlayPause: () => {},
        playNext: async () => {},
        playPrev: async () => {},
    });

    volumeRef.current = volume;
    selectedDeviceRef.current = selectedDevice;
    exclusiveRef.current = exclusiveEnabled;
    eqEnabledRef.current = eqEnabled;
    eqGainsRef.current = eqGains;
    eqAutoRef.current = eqAuto;
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
            // Advance through the queue; stops naturally at the end unless
            // repeat-all wraps. No more stopping after every single track.
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
            const queue = displayedTracksRef.current;
            const idx = queue.findIndex((t) => t.file_path === event.payload.path);
            if (idx === -1) return;
            setCurrentTime(0);
            setCurrentTrackIndex(idx);
            setCurrentTrack(queue[idx]);
            invoke("increment_play_count", { filePath: event.payload.path }).catch(() => {});
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

    // Gapless: keep the backend's next-track slot in sync with the visible
    // queue + repeat mode. Backend chains seamlessly only when channel counts
    // match; otherwise it falls back to a clean stop/start transition.
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
                if (raw && raw.channels === currentTrack.channels) {
                    desired = raw.file_path;
                }
            }
        }
        if (desired === lastQueuedNextRef.current) return;
        lastQueuedNextRef.current = desired;
        invoke("queue_next_track", { nextPath: desired }).catch(() => {
            lastQueuedNextRef.current = undefined as unknown as string | null;
        });
    }, [currentTrack, displayedTracks, repeatMode]);

    useEffect(() => {
        if (!isTauri()) return;
        if (!currentTrack || !isPlaying || isPaused) return;

        const poll = window.setInterval(async () => {
            try {
                const pos = await invoke<number>("get_position");
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
        // The gapless-sync effect re-arms the backend slot automatically.
    }, []);

    const setSelectedDevice = (deviceIndex: number) => {
        setSelectedDeviceState(deviceIndex);
        try {
            window.localStorage.setItem(DEVICE_KEY, String(deviceIndex));
        } catch {
            // ignore
        }
    };

    const setVolume = (newVolume: number) => {
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
    };

    useEffect(() => {
        if (isTauri()) {
            invoke("set_volume", { volume: volumeRef.current }).catch(() => {});
            // Restore persisted balance and preamp so the first playback honors them.
            try {
                const balRaw = window.localStorage.getItem(BALANCE_KEY);
                if (balRaw !== null) {
                    const bal = Number(balRaw);
                    if (Number.isFinite(bal)) invoke("set_balance", { balance: bal }).catch(() => {});
                }
                const preRaw = window.localStorage.getItem(PREAMP_KEY);
                if (preRaw !== null) {
                    const pre = Number(preRaw);
                    if (Number.isFinite(pre)) invoke("set_preamp", { preamp: pre }).catch(() => {});
                }
            } catch { /* ignore */ }
        }
    }, []);

    // EQ: push stored settings to the backend once on startup so the first
    // playback already honors them.
    const pushEq = useCallback((enabled: boolean, gains: number[]) => {
        if (!isTauri()) return;
        invoke("update_eq", { enabled, gains }).catch(() => {});
    }, []);

    useEffect(() => {
        pushEq(eqEnabledRef.current, eqGainsRef.current);
    }, [pushEq]);

    const persistEq = useCallback((enabled: boolean, gains: number[], auto: boolean) => {
        try {
            window.localStorage.setItem(
                EQ_KEY,
                JSON.stringify({ enabled, gains, auto } satisfies EqPersisted)
            );
        } catch {
            // localStorage unavailable
        }
    }, []);

    const applyEqGains = useCallback(
        (gains: number[], source: string) => {
            const safe = sanitizeGains(gains);
            eqSourceRef.current = source;
            setEqGains(safe);
            eqGainsRef.current = safe;
            const presetKey = source.startsWith("auto:") ? source.slice(5) : source;
            setEqPreset(EQ_PRESET_KEYS.has(presetKey) ? presetKey : null);
            persistEq(eqEnabledRef.current, safe, eqAutoRef.current);
            pushEq(eqEnabledRef.current, safe);
        },
        [persistEq, pushEq]
    );

    const setEqBand = useCallback(
        (bandIndex: number, gain: number) => {
            if (bandIndex < 0 || bandIndex >= EQ_BANDS_HZ.length) return;
            const next = [...eqGainsRef.current];
            next[bandIndex] = clampGain(gain);
            applyEqGains(next, "manual");
        },
        [applyEqGains]
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
        applyEqGains([...DEFAULT_EQ_GAINS], "flat");
    }, [applyEqGains]);

    const toggleEq = useCallback(() => {
        setEqEnabled((prev) => {
            const next = !prev;
            eqEnabledRef.current = next;
            persistEq(next, eqGainsRef.current, eqAutoRef.current);
            pushEq(next, eqGainsRef.current);
            return next;
        });
    }, [persistEq, pushEq]);

    const toggleEqAuto = useCallback(() => {
        setEqAuto((prev) => {
            const next = !prev;
            eqAutoRef.current = next;
            persistEq(eqEnabledRef.current, eqGainsRef.current, next);
            if (next) {
                // Apply immediately for the track that's already playing.
                const preset = presetForGenre(currentTrackRef.current?.genre);
                if (preset && eqSourceRef.current !== `auto:${preset.key}`) {
                    applyEqGains([...preset.gains], `auto:${preset.key}`);
                }
            }
            return next;
        });
    }, [persistEq, applyEqGains]);

    // Auto mode: whenever a track with a recognized genre starts playing,
    // switch to its mapped preset (only when the user hasn't just chosen one).
    const genreRef = useRef<string | null | undefined>(currentTrack?.genre);
    useEffect(() => {
        genreRef.current = currentTrack?.genre;
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

    const playTrack = async (track: Track, newQueue?: Track[]) => {
        if (newQueue) {
            _setDisplayedTracks(newQueue);
            const idx = newQueue.findIndex((t) => t.id === track.id);
            setCurrentTrackIndex(idx !== -1 ? idx : 0);
        } else if (displayedTracks.length === 0) {
            _setDisplayedTracks([track]);
            setCurrentTrackIndex(0);
        }

        setCurrentTime(0);
        setCurrentTrack(track);
        setIsPlaying(true);
        setIsPaused(false);

        if (isTauri()) {
            invoke("increment_play_count", { filePath: track.file_path }).catch(() => {});
        }

        try {
            await invoke("stop_playback");
            // Backend reports whether exclusive mode actually engaged (it
            // silently falls back to shared when the endpoint refuses the
            // file's native format).
            const active = await invoke<boolean>("play_track", {
                filePath: track.file_path,
                deviceIndex: selectedDeviceRef.current,
                exclusive: exclusiveRef.current,
            });
            setExclusiveActive(active);
        } catch (error) {
            console.error("Failed to play track:", error);
            setIsPlaying(false);
        }
    };

    const toggleExclusive = () => {
        setExclusiveEnabled((prev) => {
            const next = !prev;
            exclusiveRef.current = next;
            try {
                window.localStorage.setItem(EXCLUSIVE_KEY, next ? "1" : "0");
            } catch {
                // localStorage unavailable
            }
            if (isTauri() && currentTrackRef.current) {
                // Re-start the current track so the mode change is audible
                // immediately instead of waiting for the next track.
                void playTrack(currentTrackRef.current);
            }
            return next;
        });
    };

    const togglePlayPause = async () => {
        if (!currentTrack) return;
        try {
            if (isPaused) {
                await invoke("resume_playback");
                setIsPaused(false);
            } else {
                await invoke("pause_playback");
                setIsPaused(true);
            }
        } catch (error) {
            console.error("Failed to toggle playback:", error);
        }
    };

    const shufflePreservingCurrent = (tracks: Track[], currentIndex: number): Track[] => {
        const current = tracks[currentIndex] ?? tracks[0];
        const without = tracks.filter((t) => t.id !== current.id);
        for (let i = without.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [without[i], without[j]] = [without[j], without[i]];
        }
        return [current, ...without];
    };

    const toggleShuffle = () => {
        const newShuffle = !isShuffle;
        setIsShuffle(newShuffle);

        if (newShuffle) {
            preShuffleQueueRef.current = [...displayedTracks];
            if (displayedTracks.length > 1 && currentTrack) {
                const idx = displayedTracks.findIndex(
                    (t) => currentTrack && t.id === currentTrack.id
                );
                const shuffled = shufflePreservingCurrent([...displayedTracks], idx >= 0 ? idx : 0);
                _setDisplayedTracks(shuffled);
                setCurrentTrackIndex(0);
            }
        } else {
            const restored =
                preShuffleQueueRef.current.length > 0
                    ? [...preShuffleQueueRef.current]
                    : [...displayedTracksRef.current];
            const idx = currentTrack ? restored.findIndex((t) => t.id === currentTrack.id) : -1;
            _setDisplayedTracks(restored);
            setCurrentTrackIndex(idx >= 0 ? idx : 0);
        }
    };

    const toggleRepeat = () => {
        setRepeatMode((prev) => {
            if (prev === "off") return "all";
            if (prev === "all") return "one";
            return "off";
        });
    };

    const stop = async () => {
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
    };

    const playPrev = async () => {
        const queue = displayedTracksRef.current;
        if (queue.length === 0) return;
        let idx = queue.findIndex((t) => t.id === currentTrackRef.current?.id);
        idx = idx === -1 ? 0 : idx;
        const prevIndex = idx - 1 >= 0 ? idx - 1 : queue.length - 1;
        setCurrentTrackIndex(prevIndex);
        await playTrack(queue[prevIndex]);
    };

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
                seekTime,
                setSelectedDevice,
                setVolume,
                toggleExclusive,
                toggleEq,
                toggleEqAuto,
                setEqBand,
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
