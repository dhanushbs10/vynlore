import { Track } from "../App";

interface QueuePanelProps {
    displayedTracks: Track[] | null | undefined;
    currentTrackIndex: number | null | undefined;
    playTrack: (track: Track, queue?: Track[]) => void;
}

export function QueuePanel({ displayedTracks, currentTrackIndex, playTrack }: QueuePanelProps) {
    // STEP 4: Fix the QueuePanel.tsx Crash
    // 1. Safely handle displayedTracks being null/undefined FIRST.
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

    // 2. Wrap currentTrackIndex access in safe checks
    // If it's null/undefined, default to -1 so start becomes 0 (showing the whole queue)
    const safeIndex = (currentTrackIndex !== null && currentTrackIndex !== undefined) ? currentTrackIndex : -1;
    const start = safeIndex + 1;
    
    const upcoming: Track[] = [];
    for (let i = start; i < displayedTracks.length; i++) {
        upcoming.push(displayedTracks[i]);
    }

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