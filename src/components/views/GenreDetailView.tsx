import { useMemo, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayer } from "../../context/PlayerContext";
import { ArrowLeft, Play, Shuffle, Repeat, Repeat1 } from "lucide-react";
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
  const { isShuffle, toggleShuffle, repeatMode, toggleRepeat } = usePlayer();

  const filtered = useMemo(() => {
    const list = tracks.filter((t) => {
      const g = (t.genre || "").trim();
      return (!g && genre === "Uncategorized") || g === genre;
    });
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
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-transparent text-text-secondary text-xs font-semibold hover:bg-white/5 hover:text-text transition-colors w-auto"
            onClick={handleShuffle}
            whileTap={{ scale: 0.95 }}
            aria-label="Shuffle genre"
          >
            <Shuffle size={15} />
            <span>Shuffle</span>
          </motion.button>
          <motion.button
            className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center transition-transform"
            onClick={handlePlayGenre}
            whileTap={{ scale: 0.95 }}
            aria-label="Play genre"
          >
            <Play size={18} fill="currentColor" />
          </motion.button>
          <button
            className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border-none bg-transparent p-0 cursor-pointer transition-colors ${repeatMode === "off" ? "text-text-muted" : "text-white"}`}
            aria-label="Repeat"
            onClick={toggleRepeat}
          >
            {repeatMode === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
          </button>
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
                className="w-[170px] cursor-pointer group"
                onClick={() => playTrack(track, filtered)}
              >
                {coverSrc ? (
                  <img className="w-full aspect-square object-cover rounded-md" src={coverSrc} alt={track.title} />
                ) : (
                  <div className="w-full aspect-square bg-bg-surface rounded-md" />
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
