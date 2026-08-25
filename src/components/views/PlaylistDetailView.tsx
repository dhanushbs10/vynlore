import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Play, Shuffle, X } from "lucide-react";
import { usePlayer } from "../../context/PlayerContext";
import { convertFileSrc } from "@tauri-apps/api/core";
import { formatDuration, hasCover } from "../../utils/format";
import type { Track } from "../../types";

interface PlaylistDetailViewProps {
  playlistId: number;
  playTrack: (track: Track, queue?: Track[]) => void;
  onBack: () => void;
}

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function PlaylistDetailView({ playlistId, playTrack, onBack }: PlaylistDetailViewProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [name, setName] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const { isShuffle, toggleShuffle, currentTrack } = usePlayer();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [trackData, playlistName] = await Promise.all([
          invoke<Track[]>("get_playlist_tracks", { playlistId }),
          invoke<string | null>("get_playlist_name", { playlistId }),
        ]);
        if (!cancelled) {
          setTracks(trackData);
          setName(playlistName ?? `Playlist ${playlistId}`);
        }
      } catch (err) {
        console.error("Failed to load playlist tracks:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playlistId, reloadKey]);

  const handleRemoveTrack = async (e: React.MouseEvent, trackId: number) => {
    e.stopPropagation();
    try {
      await invoke("remove_track_from_playlist", { playlistId, trackId });
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("Failed to remove track:", err);
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

  const totalDuration = tracks.reduce((acc, t) => acc + t.duration_secs, 0);

  return (
    <div>
      <div className="view-header" style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
        <button className="ctrl-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="view-title">{name}</div>
          <div className="view-subtitle">
            {tracks.length} track{tracks.length === 1 ? "" : "s"} · {formatDuration(totalDuration)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
          <button className="ctrl-btn" onClick={handleShuffle} aria-label="Shuffle" style={{ padding: "0 12px", gap: 8, width: "auto" }}>
            <Shuffle size={15} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Shuffle</span>
          </button>
          <button className="play-btn" onClick={handlePlay} style={{ width: 44, height: 44, background: "var(--accent-warm)", color: "var(--bg-deep)" }} aria-label="Play playlist">
            <Play size={18} fill="var(--bg-deep)" />
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
            <div className="track-cell" style={{ width: 40 }} />
          </div>
          {tracks.map((track, idx) => {
            const active = currentTrack && track.id === currentTrack.id;
            const coverPath = hasCover(track) ? convertFileSrc(track.cover_path!) : undefined;
            return (
              <div
                key={track.id}
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
                <div className="track-cell time-cell">{formatDuration(track.duration_secs)}</div>
                <div className="track-cell" style={{ width: 40, textAlign: "center" }}>
                  <button
                    onClick={(e) => handleRemoveTrack(e, track.id)}
                    aria-label="Remove from playlist"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-tertiary)",
                      padding: 4,
                      display: "inline-flex",
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
