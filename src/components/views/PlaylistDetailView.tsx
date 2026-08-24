import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Play, Shuffle } from "lucide-react";
import { usePlayer } from "../../context/PlayerContext";
import { convertFileSrc } from "@tauri-apps/api/core";

interface PlaylistDetailViewProps {
  playlistId: number;
  playTrack: (track: any, queue?: any[]) => void;
  onBack: () => void;
  currentTrack: any;
}

function fmt(s: number): string {
  if (s <= 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function fisherYates(arr: any[]): any[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function PlaylistDetailView({ playlistId, playTrack, onBack, currentTrack }: PlaylistDetailViewProps) {
  const [tracks, setTracks] = useState<any[]>([]);
  const [name, setName] = useState("");
  const { isShuffle, toggleShuffle } = usePlayer();

  useEffect(() => {
    loadTracks();
  }, [playlistId]);

  const loadTracks = async () => {
    try {
      const data = await invoke<any[]>("get_playlist_tracks", { playlistId });
      setTracks(data);
      setName(`Playlist ${playlistId}`);
    } catch (err) {
      console.error("Failed to load playlist tracks:", err);
    }
  };

  const handlePlay = () => {
    if (tracks.length === 0) return;
    playTrack(tracks[0], tracks);
  };

  const handleShuffle = () => {
    if (tracks.length === 0) return;
    const shuffled = fisherYates(tracks);
    if (!isShuffle) toggleShuffle();
    playTrack(shuffled[0], shuffled);
  };

  return (
    <div>
      <div className="view-header" style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
        <button className="ctrl-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="view-title">{name}</div>
          <div className="view-subtitle">{tracks.length} tracks</div>
        </div>
        <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
          <button className="ctrl-btn" onClick={handleShuffle} aria-label="Shuffle" style={{ padding: "0 12px", gap: 8, width: "auto" }}>
            <Shuffle size={15} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Shuffle</span>
          </button>
          <button className="play-btn" onClick={handlePlay} style={{ width: 44, height: 44, background: "#d4a373", color: "#0c0d12" }} aria-label="Play playlist">
            <Play size={18} fill="#0c0d12" />
          </button>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-text">No tracks in this playlist.</div>
        </div>
      ) : (
        <div className="tracks-table">
          <div className="tracks-row track-header">
            <div className="track-cell" style={{ width: 48 }} />
            <div className="track-cell">#</div>
            <div className="track-cell">Title</div>
            <div className="track-cell">Artist</div>
            <div className="track-cell time-cell">TIME</div>
          </div>
          {tracks.map((track, idx) => {
            const active = currentTrack && track.id === currentTrack.id;
            const coverPath = typeof track.cover_path === "string" && track.cover_path.length > 2 ? convertFileSrc(track.cover_path) : undefined;
            return (
              <div
                key={track.file_path || idx}
                className={`tracks-row ${active ? "track-active" : ""}`}
                onClick={() => playTrack(track, tracks)}
              >
                <div className="track-cell" style={{ width: 48 }}>
                  {coverPath ? (
                    <img className="track-thumb" src={coverPath} alt="" />
                  ) : (
                    <div className="track-thumb-empty" />
                  )}
                </div>
                <div className="track-cell track-num">{active ? <span className="equalizer" /> : idx + 1}</div>
                <div className="track-cell track-title">{track.title}</div>
                <div className="track-cell track-meta">{track.artist}</div>
                <div className="track-cell time-cell">{fmt(track.duration_secs)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
