import { useRef } from "react";

import { Track } from "../types";
import { usePlayer } from "../context/PlayerContext";

interface QueuePanelProps {
    displayedTracks: Track[] | null | undefined;
    currentTrackIndex: number | null | undefined;
    playTrack: (track: Track, queue?: Track[]) => void;
}

export function QueuePanel({ displayedTracks, currentTrackIndex, playTrack }: QueuePanelProps) {
    const { reorderQueue } = usePlayer();
    const dragFromRef = useRef<number | null>(null);
    const dropTargetRef = useRef<HTMLDivElement | null>(null);

    if (!displayedTracks || displayedTracks.length === 0) {
        return (
            <div className="w-[264px] h-full bg-bg border-l border-border flex flex-col shrink-0">
                <div className="px-5 pt-6 pb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">Up Next</div>
                <div className="flex-1 overflow-y-auto px-3 pb-3">
                    <div className="px-2 py-6 text-center text-text-muted text-sm">Queue is empty</div>
                </div>
            </div>
        );
    }

    const safeIndex = (currentTrackIndex !== null && currentTrackIndex !== undefined) ? currentTrackIndex : -1;
    const start = safeIndex + 1;

    const upcoming: Track[] = [];
    for (let i = start; i < displayedTracks.length; i++) {
        upcoming.push(displayedTracks[i]);
    }

    const handleDragStart = (e: React.DragEvent, absoluteIdx: number) => {
        dragFromRef.current = absoluteIdx;
        e.dataTransfer.effectAllowed = "move";
        (e.currentTarget as HTMLElement).classList.add("dragging");
    };

    const handleDragEnd = (e: React.DragEvent) => {
        (e.currentTarget as HTMLElement).classList.remove("dragging");
        dropTargetRef.current?.classList.remove("drop-target");
        dropTargetRef.current = null;
        dragFromRef.current = null;
    };

    const handleDragOver = (e: React.DragEvent, el: HTMLDivElement) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dropTargetRef.current && dropTargetRef.current !== el) {
            dropTargetRef.current.classList.remove("drop-target");
        }
        el.classList.add("drop-target");
        dropTargetRef.current = el;
    };

    const handleDrop = (e: React.DragEvent, absoluteIdx: number) => {
        e.preventDefault();
        const from = dragFromRef.current;
        if (from !== null && from !== absoluteIdx) {
            reorderQueue(from, absoluteIdx);
        }
    };

    return (
        <div className="w-[264px] h-full bg-bg border-l border-border flex flex-col shrink-0">
            <div className="px-5 pt-6 pb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">Up Next</div>
            <div className="flex-1 overflow-y-auto px-3 pb-3">
                {safeIndex >= 0 && safeIndex < displayedTracks.length && (
                    <div className="px-3 py-2 rounded-lg bg-white/5 mb-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-white mb-0.5">Now Playing</div>
                        <div className="text-sm font-medium text-text truncate">{displayedTracks[safeIndex].title}</div>
                        <div className="text-xs text-text-muted truncate mt-0.5">{displayedTracks[safeIndex].artist}</div>
                    </div>
                )}
                {upcoming.length === 0 ? (
                    <div className="px-2 py-6 text-center text-text-muted text-sm">No upcoming tracks</div>
                ) : (
                    upcoming.map((track, i) => {
                        const realIdx = start + i;
                        return (
                            <div
                                key={`${track.id}-${realIdx}`}
                                className="px-3 py-2 rounded-lg cursor-pointer hover:bg-bg-hover transition-colors"
                            >
                                <div
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, realIdx)}
                                    onDragEnd={handleDragEnd}
                                    onDragOver={(e) => handleDragOver(e, e.currentTarget as HTMLDivElement)}
                                    onDrop={(e) => handleDrop(e, realIdx)}
                                    onClick={() => playTrack(track, displayedTracks)}
                                >
                                    <div className="text-sm font-medium text-text truncate">{track.title}</div>
                                    <div className="text-xs text-text-muted truncate mt-0.5">{track.artist}</div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
