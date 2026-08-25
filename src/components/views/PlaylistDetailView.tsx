import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Play, Shuffle, X } from "lucide-react";
import { motion } from "framer-motion";
import { usePlayer } from "../../context/PlayerContext";
import { convertFileSrc } from "@tauri-apps/api/core";
import { formatDuration, hasCover } from "../../utils/format";
import { fisherYates } from "../../utils/shuffle";
import type { Track } from "../../types";

interface PlaylistDetailViewProps {
  playlistId: number;
  playTrack: (track: Track, queue?: Track[]) => void;
  onBack: () => void;
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
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className="flex items-center gap-4 mb-7">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text transition-colors" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold text-text tracking-tight">{name}</h1>
          <p className="text-sm text-text-secondary mt-1">
            {tracks.length} track{tracks.length === 1 ? "" : "s"} · {formatDuration(totalDuration)}
          </p>
        </div>
        <div className="flex gap-2.5 ml-auto">
          <motion.button
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-raised text-text-secondary text-xs font-semibold hover:bg-bg-hover hover:text-text transition-colors w-auto"
            onClick={handleShuffle}
            whileTap={{ scale: 0.95 }}
            aria-label="Shuffle"
          >
            <Shuffle size={15} />
            <span>Shuffle</span>
          </motion.button>
          <motion.button
            className="w-11 h-11 rounded-full bg-accent text-bg flex items-center justify-center shadow-[0_0_20px_var(--color-accent-glow)] hover:scale-105 active:scale-95 transition-transform"
            onClick={handlePlay}
            whileTap={{ scale: 0.95 }}
            aria-label="Play playlist"
          >
            <Play size={18} fill="currentColor" />
          </motion.button>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <div className="text-sm text-text-secondary">No tracks in this playlist.</div>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-[48px_40px_1fr_1fr_70px_40px] items-center gap-2.5 px-3 py-2 text-xs font-medium text-text-muted uppercase tracking-wider">
            <div />
            <div>#</div>
            <div>Title</div>
            <div>Artist</div>
            <div className="text-right">Time</div>
            <div />
          </div>
          {tracks.map((track, idx) => {
            const active = currentTrack && track.id === currentTrack.id;
            const coverPath = hasCover(track) ? convertFileSrc(track.cover_path!) : undefined;
            return (
              <div
                key={track.id}
                className={`grid grid-cols-[48px_40px_1fr_1fr_70px_40px] items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer hover:bg-bg-hover transition-colors ${active ? "bg-accent-soft" : ""}`}
                onClick={() => playTrack(track, tracks)}
              >
                <div className="w-12">
                  {coverPath ? (
                    <img className="w-10 h-10 rounded-md object-cover" src={coverPath} alt="" />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-bg-surface" />
                  )}
                </div>
                <div className="text-sm text-text-secondary text-center">{active ? <span className="eq-bars" /> : idx + 1}</div>
                <div className="text-sm font-medium text-text truncate">{track.title}</div>
                <div className="text-sm text-text-secondary truncate">{track.artist}</div>
                <div className="text-sm text-text-muted tabular-nums text-right">{formatDuration(track.duration_secs)}</div>
                <div className="text-center">
                  <button
                    onClick={(e) => handleRemoveTrack(e, track.id)}
                    aria-label="Remove from playlist"
                    className="text-text-muted hover:text-text p-1 inline-flex transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
