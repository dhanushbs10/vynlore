import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Play, Maximize2, FolderOpen } from "lucide-react";
import { motion } from "framer-motion";
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
      <div className="flex flex-col items-center justify-center h-full gap-4 pb-24">
        <FolderOpen size={48} className="text-text-muted mb-2" />
        <div className="text-lg font-semibold text-text-secondary">No folder selected</div>
        <div className="text-sm text-text-muted mb-4">Select a music folder to get started</div>
        <motion.button
          onClick={onSelectFolder}
          className="flex items-center gap-2 px-7 py-3 rounded-lg bg-accent text-bg text-sm font-semibold cursor-pointer transition-transform"
          whileTap={{ scale: 0.95 }}
        >
          <FolderOpen size={18} />
          Select Folder
        </motion.button>
      </div>
    );
  }

  if (libraryTracks.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <div className="text-center pt-32 pb-16 text-text-muted">
          <div className="text-3xl mb-3 opacity-60">♪</div>
          <div className="text-base font-semibold text-text-secondary">{scanning ? "Scanning your library…" : "Library is empty"}</div>
          <div className="text-sm mt-1">
            {scanning ? "This may take a moment for large folders." : "Add audio files (FLAC, WAV, AIFF, MP3, M4A, OGG) to your watched folder to see them here."}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="overflow-y-auto pb-24 h-full">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mb-6 flex items-center gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-text tracking-tight">Home</h1>
          <p className="text-sm text-text-secondary mt-1">Recently Added</p>
        </div>
        {scanning && (
          <div className="text-xs text-accent font-medium">Scanning…</div>
        )}
      </motion.div>

      <motion.div
        className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-[18px]"
        variants={{ show: { transition: { staggerChildren: 0.03 } } }}
        initial="hidden"
        animate="show"
      >
        {tracks.map((track) => (
          <TrackCard key={track.id} track={track} queue={tracks} playTrack={playTrack} onExpandTrack={onExpandTrack} />
        ))}
      </motion.div>

      {recentlyPlayed.length > 0 && (
        <>
          <div className="mt-8 mb-3.5 text-[15px] font-semibold text-text">Recently Played</div>
          <motion.div
            className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-[18px]"
            variants={{ show: { transition: { staggerChildren: 0.03 } } }}
            initial="hidden"
            animate="show"
          >
            {recentlyPlayed.map((track) => (
              <TrackCard key={`rp-${track.id}`} track={track} queue={recentlyPlayed} playTrack={playTrack} onExpandTrack={onExpandTrack} />
            ))}
          </motion.div>
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
    <motion.div
      variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
      whileHover={{ y: -3, transition: { type: "spring", stiffness: 400, damping: 25 } }}
      className="relative cursor-pointer group"
      onClick={() => playTrack(track, queue)}
    >
      <div className="relative">
        {coverSrc ? (
          <img className="w-full aspect-square object-cover rounded-xl shadow-lg group-hover:shadow-xl transition-shadow" src={coverSrc} alt={track.title} />
        ) : (
          <div className="w-full aspect-square bg-bg-surface rounded-xl" />
        )}
        <motion.button
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 scale-0 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 w-11 h-11 rounded-full bg-accent text-bg flex items-center justify-center shadow-[0_0_20px_var(--color-accent-glow)]"
          onClick={(e) => {
            e.stopPropagation();
            playTrack(track, queue);
          }}
          aria-label={`Play ${track.title}`}
          whileTap={{ scale: 0.95 }}
        >
          <Play size={22} fill="currentColor" />
        </motion.button>
        <button
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center cursor-pointer text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          onClick={(e) => {
            e.stopPropagation();
            onExpandTrack(track);
          }}
          aria-label="Expand"
        >
          <Maximize2 size={14} />
        </button>
      </div>
      <div className="mt-2 text-sm font-medium text-text truncate" title={track.title}>{track.title}</div>
      <div className="text-xs text-text-secondary truncate mt-0.5" title={track.artist}>{track.artist}</div>
    </motion.div>
  );
}
