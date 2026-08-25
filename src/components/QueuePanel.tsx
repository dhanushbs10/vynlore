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
            <div className="queue-panel">
                <div className="queue-header">Up Next</div>
                <div className="queue-list">
                    <div className="queue-empty">Queue is empty</div>
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
        <div className="queue-panel">
            <div className="queue-header">Up Next</div>
            <div className="queue-list">
                {upcoming.length === 0 ? (
                    <div className="queue-empty">No upcoming tracks</div>
                ) : (
                    upcoming.map((track, i) => {
                        const realIdx = start + i;
                        return (
                            <div
                                key={`${track.id}-${realIdx}`}
                                className="queue-item"
                                onClick={() => playTrack(track, displayedTracks)}
                                draggable
                                onDragStart={(e) => handleDragStart(e, realIdx)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(e) => handleDragOver(e, e.currentTarget)}
                                onDrop={(e) => handleDrop(e, realIdx)}
                            >
                                <div className="queue-title">{track.title}</div>
                                <div className="queue-artist">{track.artist}</div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
