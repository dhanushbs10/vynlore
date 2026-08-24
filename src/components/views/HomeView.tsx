import { useMemo } from "react";
import { Track } from "../../App";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Play, Maximize2, FolderOpen } from "lucide-react";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface HomeViewProps {
  libraryTracks: Track[];
  playTrack: (track: Track, queue?: Track[]) => void;
  onExpandTrack: (track: Track) => void;
  watchedFolder: string | null;
  onSelectFolder: () => void;
  scanning?: boolean;
}

export function HomeView({ libraryTracks, playTrack, onExpandTrack, watchedFolder, onSelectFolder, scanning }: HomeViewProps) {
  const tracks = useMemo(() => shuffle(libraryTracks), [libraryTracks]);

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

  return (
    <div style={{ overflowY: "auto", paddingBottom: 100, height: "100%" }}>
      <div className="view-header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div>
          <div className="view-title">Home</div>
          <div className="view-subtitle">All Tracks</div>
        </div>
        {scanning && (
          <div style={{
            fontSize: 12,
            color: "var(--accent)",
            fontWeight: 500,
          }}>
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
        {tracks.map((track) => {
          const coverSrc =
            typeof track.cover_path === "string" && track.cover_path.length > 2
              ? convertFileSrc(track.cover_path)
              : undefined;

          return (
            <div key={track.id} className="album-card" onClick={() => playTrack(track, libraryTracks)} style={{ position: "relative" }}>
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
                    playTrack(track, libraryTracks);
                  }}
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%) scale(0)",
                    opacity: 0,
                    transition: "all 0.15s ease",
                    background: "#d4a373",
                    color: "#0a0a0a",
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
                  <Play size={22} fill="#0a0a0a" />
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
        })}
      </div>
    </div>
  );
}
