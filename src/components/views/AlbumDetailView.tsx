import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft, Play } from "lucide-react";
import { motion } from "framer-motion";
import { usePlayer } from "../../context/PlayerContext";
import { formatDuration, hasCover } from "../../utils/format";
import type { Track } from "../../types";

interface AlbumDetailViewProps {
  albumName: string;
  tracks: Track[];
  playTrack: (track: Track, queue?: Track[]) => Promise<void>;
  onBack: () => void;
}

export function AlbumDetailView({ albumName, tracks, playTrack, onBack }: AlbumDetailViewProps) {
  const { currentTrack } = usePlayer();

  const albumTracks = useMemo(() => {
    const filtered = tracks.filter((t) => t.album === albumName);
    filtered.sort((a, b) => {
      const an = a.track_number ?? 0;
      const bn = b.track_number ?? 0;
      if (an !== bn) return an - bn;
      return a.title.localeCompare(b.title);
    });
    return filtered;
  }, [tracks, albumName]);

  const coverSrc = hasCover(albumTracks[0])
    ? convertFileSrc(albumTracks[0].cover_path!)
    : undefined;

  const artist = albumTracks[0]?.artist || "Unknown Artist";

  const handlePlayAlbum = async () => {
    if (albumTracks.length === 0) return;
    await playTrack(albumTracks[0], albumTracks);
  };

  const totalDuration = albumTracks.reduce((acc, t) => acc + t.duration_secs, 0);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className="flex items-center gap-4 mb-7">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text transition-colors" aria-label="Back to albums">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold text-text tracking-tight">{albumName}</h1>
          <p className="text-sm text-text-secondary mt-1">{artist} · {albumTracks.length} tracks · {formatDuration(totalDuration)}</p>
        </div>
      </div>

      <div className="flex gap-8 mb-8 items-start">
        <div className="shrink-0">
          {coverSrc ? (
            <img
              src={coverSrc}
              alt={albumName}
              className="w-[220px] h-[220px] rounded-xl object-cover shadow-[0_16px_48px_rgba(0,0,0,0.45)]"
            />
          ) : (
            <div className="w-[220px] h-[220px] rounded-xl bg-gradient-to-br from-bg-elevated to-bg-surface shadow-[0_16px_48px_rgba(0,0,0,0.45)]" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[22px] font-bold text-text mb-1">{albumName}</div>
          <div className="text-sm text-text-secondary mb-4.5">{artist}</div>
          <motion.button
            className="w-11 h-11 rounded-full bg-accent text-bg flex items-center justify-center shadow-[0_0_20px_var(--color-accent-glow)] hover:scale-105 active:scale-95 transition-transform"
            onClick={handlePlayAlbum}
            whileTap={{ scale: 0.95 }}
            aria-label="Play album"
          >
            <Play size={18} fill="currentColor" />
          </motion.button>
        </div>
      </div>

      <div>
        <div className="grid grid-cols-[48px_40px_1fr_70px] items-center gap-2.5 px-3 py-2 text-xs font-medium text-text-muted uppercase tracking-wider">
          <div />
          <div>#</div>
          <div>Title</div>
          <div className="text-right">Time</div>
        </div>
        {albumTracks.length === 0 ? (
          <div className="text-center py-16 text-text-muted">
            <div className="text-sm text-text-secondary">No tracks found for this album.</div>
          </div>
        ) : (
          albumTracks.map((track, idx) => {
            const active = track.id === currentTrack?.id;
            const rowCover = hasCover(track) ? convertFileSrc(track.cover_path!) : undefined;
            return (
              <div
                key={track.id}
                className={`grid grid-cols-[48px_40px_1fr_70px] items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer hover:bg-bg-hover transition-colors ${active ? "bg-accent-soft" : ""}`}
                onClick={() => {
                  playTrack(track, albumTracks);
                }}
              >
                <div className="w-12">
                  {rowCover ? (
                    <img className="w-10 h-10 rounded-md object-cover" src={rowCover} alt="" />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-bg-surface" />
                  )}
                </div>
                <div className="text-sm text-text-secondary text-center">{active ? <span className="eq-bars" /> : idx + 1}</div>
                <div className="text-sm font-medium text-text truncate">{track.title}</div>
                <div className="text-sm text-text-muted tabular-nums text-right">{formatDuration(track.duration_secs)}</div>
              </div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}
