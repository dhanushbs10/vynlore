import { useMemo, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayer } from "../../context/PlayerContext";
import { ArrowLeft, Play, Shuffle } from "lucide-react";
import { motion } from "framer-motion";
import { formatDuration, hasCover } from "../../utils/format";
import { fisherYates } from "../../utils/shuffle";
import type { Track } from "../../types";

interface GenreDetailViewProps {
  genre: string;
  tracks: Track[];
  onBack: () => void;
  playTrack: (track: Track, queue?: Track[]) => void;
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
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className="flex items-center gap-4 mb-7">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text transition-colors" aria-label="Back to genres">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold text-text tracking-tight">{genre}</h1>
          <p className="text-sm text-text-secondary mt-1">{filtered.length} tracks</p>
        </div>
        <div className="flex gap-2.5 ml-auto">
          <motion.button
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-raised text-text-secondary text-xs font-semibold hover:bg-bg-hover hover:text-text transition-colors w-auto"
            onClick={handleShuffle}
            whileTap={{ scale: 0.95 }}
            aria-label="Shuffle genre"
          >
            <Shuffle size={15} />
            <span>Shuffle</span>
          </motion.button>
          <motion.button
            className="w-11 h-11 rounded-full bg-accent text-bg flex items-center justify-center shadow-[0_0_20px_var(--color-accent-glow)] hover:scale-105 active:scale-95 transition-transform"
            onClick={handlePlayGenre}
            whileTap={{ scale: 0.95 }}
            aria-label="Play genre"
          >
            <Play size={18} fill="currentColor" />
          </motion.button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <div className="text-sm text-text-secondary">No tracks found for this genre.</div>
        </div>
      ) : (
        <motion.div
          className="flex flex-wrap gap-[22px]"
          variants={{ show: { transition: { staggerChildren: 0.03 } } }}
          initial="hidden"
          animate="show"
        >
          {filtered.map((track) => {
            const coverSrc = hasCover(track)
              ? convertFileSrc(track.cover_path!)
              : undefined;
            return (
              <motion.div
                key={track.id}
                variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                whileHover={{ y: -3, transition: { type: "spring", stiffness: 400, damping: 25 } }}
                className="w-[170px] cursor-pointer group"
                onClick={() => playTrack(track, filtered)}
              >
                {coverSrc ? (
                  <img className="w-full aspect-square object-cover rounded-xl shadow-lg group-hover:shadow-xl transition-shadow" src={coverSrc} alt={track.title} />
                ) : (
                  <div className="w-full aspect-square bg-bg-surface rounded-xl" />
                )}
                <div className="mt-2 text-sm font-medium text-text truncate" title={track.title}>
                  {track.title}
                </div>
                <div className="text-xs text-text-secondary truncate mt-0.5" title={track.artist}>
                  {track.artist}
                </div>
                <div className="text-sm text-text-muted tabular-nums text-right mt-0.5">{formatDuration(track.duration_secs)}</div>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </motion.div>
  );
}
