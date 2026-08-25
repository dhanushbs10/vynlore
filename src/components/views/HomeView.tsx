import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Play, Maximize2, FolderOpen } from "lucide-react";
import { hasCover } from "../../utils/format";
import type { Track } from "../../types";

interface HomeViewProps {
  libraryTracks: Track[];
  recentlyPlayed?: Track[];
  playTrack: (track: Track, queue?: Track[]) => void;
  onExpandTrack: (track: Track) => void;
  watchedFolder: string | null;
  onSelectFolder: () => void;
  scanning?: boolean;
}

export function HomeView({ libraryTracks, recentlyPlayed = [], playTrack, onExpandTrack, watchedFolder, onSelectFolder, scanning }: HomeViewProps) {
  const tracks = useMemo(() => {
    return [...libraryTracks].sort((a, b) => b.id - a.id).slice(0, 60);
  }, [libraryTracks]);

  if (!watchedFolder) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 16,
        paddingBottom: 100,
      }}>
        <FolderOpen size={48} style={{ color: "var(--text-tertiary)", marginBottom: 8 }} />
        <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-secondary)" }}>No folder selected</div>
        <div style={{ fontSize: 14, color: "var(--text-tertiary)", marginBottom: 16 }}>Select a music folder to get started</div>
        <button
          onClick={onSelectFolder}
          style={{
            padding: "12px 28px",
            borderRadius: "var(--radius-md)",
            border: "none",
            background: "var(--accent)",
            color: "var(--bg-deep)",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "var(--font-ui)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <FolderOpen size={18} />
          Select Folder
        </button>
      </div>
    );
  }

  if (libraryTracks.length === 0) {
    return (
      <div className="empty-state" style={{ paddingTop: 120 }}>
        <div className="empty-state-icon">♪</div>
        <div className="empty-state-title">{scanning ? "Scanning your library…" : "Library is empty"}</div>
        <div className="empty-state-desc">
          {scanning ? "This may take a moment for large folders." : "Add audio files (FLAC, WAV, AIFF, MP3, M4A, OGG) to your watched folder to see them here."}
        </div>
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", paddingBottom: 100, height: "100%" }}>
      <div className="view-header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div>
          <div className="view-title">Home</div>
          <div className="view-subtitle">Recently Added</div>
        </div>
        {scanning && (
          <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 500 }}>
            Scanning…
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 18,
        }}
      >
        {tracks.map((track) => (
          <TrackCard key={track.id} track={track} queue={tracks} playTrack={playTrack} onExpandTrack={onExpandTrack} />
        ))}
      </div>

      {recentlyPlayed.length > 0 && (
        <>
          <div className="view-subtitle" style={{ margin: "32px 0 14px", fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
            Recently Played
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 18,
            }}
          >
            {recentlyPlayed.map((track) => (
              <TrackCard key={`rp-${track.id}`} track={track} queue={recentlyPlayed} playTrack={playTrack} onExpandTrack={onExpandTrack} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TrackCard({
  track,
  queue,
  playTrack,
  onExpandTrack,
}: {
  track: Track;
  queue: Track[];
  playTrack: (track: Track, queue?: Track[]) => void;
  onExpandTrack: (track: Track) => void;
}) {
  const coverSrc = hasCover(track) ? convertFileSrc(track.cover_path!) : undefined;

  return (
    <div className="album-card" onClick={() => playTrack(track, queue)} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        {coverSrc ? (
          <img className="album-art-img" src={coverSrc} alt={track.title} />
        ) : (
          <div className="album-art" />
        )}
        <button
          className="play-btn"
          onClick={(e) => {
            e.stopPropagation();
            playTrack(track, queue);
          }}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%) scale(0)",
            opacity: 0,
            transition: "all 0.15s ease",
            background: "var(--accent-warm)",
            color: "var(--bg-deep)",
          }}
          aria-label={`Play ${track.title}`}
          onMouseEnter={(e) => {
            const btn = e.currentTarget;
            btn.style.transform = "translate(-50%, -50%) scale(1)";
            btn.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            const btn = e.currentTarget;
            btn.style.transform = "translate(-50%, -50%) scale(0)";
            btn.style.opacity = "0";
          }}
        >
          <Play size={22} fill="var(--bg-deep)" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExpandTrack(track);
          }}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "rgba(0,0,0,0.5)",
            border: "none",
            borderRadius: "50%",
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "#fff",
            opacity: 0,
            transition: "opacity 0.15s ease",
          }}
          aria-label="Expand"
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "0";
          }}
        >
          <Maximize2 size={14} />
        </button>
      </div>
      <div className="album-title" title={track.title}>{track.title}</div>
      <div className="album-artist" title={track.artist}>{track.artist}</div>
    </div>
  );
}
