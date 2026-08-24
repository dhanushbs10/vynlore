import { useMemo, useCallback } from "react";
import { Track } from "../../App";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayer } from "../../context/PlayerContext";
import { ArrowLeft, Play, Shuffle } from "lucide-react";

interface GenreDetailViewProps {
  genre: string;
  tracks: Track[];
  onBack: () => void;
  playTrack: (track: Track, queue?: Track[]) => void;
}

function fmt(s: number): string {
  if (s <= 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function GenreDetailView({
  genre,
  tracks,
  onBack,
  playTrack,
}: GenreDetailViewProps) {
  const { isShuffle, toggleShuffle } = usePlayer();

  const filtered = useMemo(() => {
    const list = tracks.filter((t) => (t.genre || "").trim() === genre);
    list.sort((a, b) => {
      const an = a.track_number ?? 0;
      const bn = b.track_number ?? 0;
      if (an !== bn) return an - bn;
      return a.title.localeCompare(b.title);
    });
    return list;
  }, [tracks, genre]);

  const handlePlayGenre = useCallback(() => {
    if (filtered.length === 0) return;
    playTrack(filtered[0], filtered);
  }, [filtered, playTrack]);

  const handleShuffle = useCallback(() => {
    if (filtered.length === 0) return;
    const shuffled = fisherYates(filtered);
    if (!isShuffle) {
      toggleShuffle();
    }
    playTrack(shuffled[0], shuffled);
  }, [filtered, isShuffle, toggleShuffle, playTrack]);

  return (
    <div>
      <div
        className="view-header"
        style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}
      >
        <button className="ctrl-btn" onClick={onBack} aria-label="Back to genres">
          <ArrowLeft size={18} />
        </button>
        <div className="view-title">{genre}</div>
        <div className="view-subtitle">{filtered.length} tracks</div>
        <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
          <button
            className="ctrl-btn"
            onClick={handleShuffle}
            aria-label="Shuffle genre"
            style={{ padding: "0 12px", gap: 8, width: "auto" }}
          >
            <Shuffle size={15} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Shuffle</span>
          </button>
          <button
            className="play-btn"
            onClick={handlePlayGenre}
            style={{ width: 44, height: 44, background: "#d4a373", color: "#0c0d12" }}
            aria-label="Play genre"
          >
            <Play size={18} fill="#0c0d12" />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-text">No tracks found for this genre.</div>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 22,
          }}
        >
          {filtered.map((track) => {
            const coverSrc =
              typeof track.cover_path === "string" && track.cover_path.length > 2
                ? convertFileSrc(track.cover_path)
                : undefined;
            return (
              <div
                key={track.id}
                className="album-card"
                onClick={() => playTrack(track, filtered)}
                style={{ width: 170 }}
              >
                {coverSrc ? (
                  <img className="album-art-img" src={coverSrc} alt={track.title} />
                ) : (
                  <div className="album-art" />
                )}
                <div className="album-title" title={track.title}>
                  {track.title}
                </div>
                <div className="album-artist" title={track.artist}>
                  {track.artist}
                </div>
                <div className="time-cell">{fmt(track.duration_secs)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
