import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Track } from "../App";

type RepeatMode = "off" | "all" | "one";

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
    seekTime: (time: number) => void;
    setSelectedDevice: (deviceIndex: number) => void;
    playTrack: (track: Track, queue?: Track[]) => Promise<void>;
    togglePlayPause: () => void;
    toggleShuffle: () => void;
    toggleRepeat: () => void;
    stop: () => Promise<void>;
    playNext: () => Promise<void>;
    playPrev: () => Promise<void>;
    setLibraryTracks: (tracks: Track[]) => void;
    setDisplayedTracks: (tracks: Track[]) => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [libraryTracks, _setLibraryTracks] = useState<Track[]>([]);
    const [displayedTracks, _setDisplayedTracks] = useState<Track[]>([]);
    const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
    const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [selectedDevice, setSelectedDeviceState] = useState<number | null>(null);
    const [isShuffle, setIsShuffle] = useState(false);
    const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
    const [currentTime, setCurrentTime] = useState(0);
    const intervalRef = useRef<number | undefined>(undefined);
    const trackEndHandlerRef = useRef<(() => void) | null>(null);
    const preShuffleQueueRef = useRef<Track[]>([]);

    const stopTimer = useCallback(() => {
        if (intervalRef.current) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = undefined;
        }
    }, []);

    const buildTrackEndHandler = useCallback(
        (mode: RepeatMode) => {
            return async () => {
                if (!currentTrack) return;
                if (mode === "one") {
                    await playTrack(currentTrack);
                } else if (mode === "all") {
                    await playNext();
                } else {
                    await stop();
                }
            };
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [currentTrack]
    );

    useEffect(() => {
        trackEndHandlerRef.current = buildTrackEndHandler(repeatMode);
    }, [repeatMode, buildTrackEndHandler]);

    useEffect(() => {
        if (!currentTrack) {
            stopTimer();
            return;
        }

        if (isPlaying && !isPaused) {
            stopTimer();
            intervalRef.current = window.setInterval(() => {
                setCurrentTime((t) => {
                    const next = t + 1;
                    if (currentTrack && next >= currentTrack.duration_secs) {
                        // Do NOT call state updates inside the updater. 
                        // Reset time to 0, and trigger the handler outside.
                        return 0;
                    }
                    return next;
                });

                // Check if we hit the end to trigger next track
                if (currentTime + 1 >= currentTrack.duration_secs) {
                    stopTimer();
                    const handler = trackEndHandlerRef.current;
                    if (handler) handler();
                }
            }, 1000);
        } else {
            stopTimer();
        }

        return stopTimer;
    }, [isPlaying, isPaused, currentTrack, stopTimer, currentTime]);

    const setLibraryTracks = useCallback((tracks: Track[]) => {
        _setLibraryTracks(tracks);
        if (displayedTracks.length === 0) _setDisplayedTracks(tracks);
    }, [displayedTracks.length]);

    const setDisplayedTracks = useCallback((tracks: Track[]) => {
        _setDisplayedTracks(tracks);
    }, []);

    const setSelectedDevice = (deviceIndex: number) => {
        setSelectedDeviceState(deviceIndex);
    };

    const seekTime = (time: number) => {
        setCurrentTime(time);
    };

    const playTrack = async (track: Track, newQueue?: Track[]) => {
        if (newQueue) {
            _setDisplayedTracks(newQueue);
            const idx = newQueue.findIndex((t) => t.id === track.id);
            setCurrentTrackIndex(idx !== -1 ? idx : 0);
        } else if (displayedTracks.length === 0) {
            _setDisplayedTracks([track]);
            setCurrentTrackIndex(0);
        }

        stopTimer();
        setCurrentTime(0);
        setCurrentTrack(track);
        setIsPlaying(true);
        setIsPaused(false);

        try {
            await invoke("stop_playback");
            await invoke("play_track", {
                filePath: track.file_path,
                deviceIndex: selectedDevice ?? 1,
            });
        } catch (error) {
            console.error("Failed to play track:", error);
        }
    };

    const togglePlayPause = async () => {
        if (!currentTrack) return;
        if (isPaused) {
            await invoke("resume_playback");
            setIsPaused(false);
        } else {
            await invoke("pause_playback");
            setIsPaused(true);
        }
    };

    const toggleShuffle = () => {
        const newShuffle = !isShuffle;
        setIsShuffle(newShuffle);

        if (newShuffle) {
            preShuffleQueueRef.current = [...displayedTracks];
            if (displayedTracks.length > 1) {
                const shuffled = shufflePreservingCurrent([...displayedTracks], currentTrackIndex);
                _setDisplayedTracks(shuffled);
                setCurrentTrackIndex(0);
            }
        } else {
            const restored = preShuffleQueueRef.current.length > 0 ? [...preShuffleQueueRef.current] : [...libraryTracks];
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
        await invoke("stop_playback");
        setIsPlaying(false);
        setIsPaused(false);
        stopTimer();
        setCurrentTrack(null);
        setCurrentTime(0);
        setCurrentTrackIndex(-1);
    };

    const playNext = async () => {
        if (displayedTracks.length === 0) return;

        const mode = repeatMode;
        if (mode === "one") {
            setCurrentTime(0);
            await playTrack(displayedTracks[currentTrackIndex]);
            return;
        }

        let nextIndex: number;
        if (currentTrackIndex + 1 < displayedTracks.length) {
            nextIndex = currentTrackIndex + 1;
        } else if (mode === "all") {
            nextIndex = 0;
        } else {
            await stop();
            return;
        }

        setCurrentTrackIndex(nextIndex);
        await playTrack(displayedTracks[nextIndex]);
    };

    const playPrev = async () => {
        if (displayedTracks.length === 0) return;
        const prevIndex = currentTrackIndex - 1 >= 0 ? currentTrackIndex - 1 : displayedTracks.length - 1;
        setCurrentTrackIndex(prevIndex);
        await playTrack(displayedTracks[prevIndex]);
    };

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
                seekTime,
                setSelectedDevice,
                playTrack,
                setLibraryTracks,
                setDisplayedTracks,
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

function shufflePreservingCurrent(tracks: Track[], currentIndex: number): Track[] {
    const current = tracks[currentIndex] ?? tracks[0];
    const without = tracks.filter((t) => t.id !== current.id);
    for (let i = without.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [without[i], without[j]] = [without[j], without[i]];
    }
    return [current, ...without];
}

export const usePlayer = () => {
    const context = useContext(PlayerContext);
    if (context === undefined) {
        throw new Error("usePlayer must be used within a PlayerProvider");
    }
    return context;
};