import { useState, useEffect, useRef } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { usePlayer } from "../context/PlayerContext";
import { formatDuration } from "../utils/format";
import { Play, Pause, SkipBack, SkipForward, Volume2, ListMusic, Repeat, Repeat1, Heart, ListPlus, Zap } from "lucide-react";

export default function PlayerBar({ onExpandCurrentTrack }: { onExpandCurrentTrack?: () => void }) {
const {
currentTrack,
isPlaying,
isPaused,
currentTime,
isShuffle,
repeatMode,
volume,
exclusiveEnabled,
exclusiveActive,
setVolume,
seekTime,
togglePlayPause,
toggleShuffle,
toggleRepeat,
toggleExclusive,
playNext,
playPrev,
} = usePlayer();
const [isLiked, setIsLiked] = useState(false);
const [showPlaylistDropdown, setShowPlaylistDropdown] = useState(false);
const [playlists, setPlaylists] = useState<{ id: number; name: string }[]>([]);
const playlistDropdownRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (!showPlaylistDropdown) return;
  const handleClick = (e: MouseEvent) => {
    if (playlistDropdownRef.current && !playlistDropdownRef.current.contains(e.target as Node)) {
      setShowPlaylistDropdown(false);
    }
  };
  document.addEventListener("mousedown", handleClick);
  return () => document.removeEventListener("mousedown", handleClick);
}, [showPlaylistDropdown]);

useEffect(() => {
if (!currentTrack) return;
let cancelled = false;
const checkLiked = async () => {
try {
const liked = await invoke<boolean>("is_track_liked", { trackId: currentTrack.id });
if (!cancelled) setIsLiked(liked);
} catch (err) {
console.error("Failed to check like status:", err);
}
};
checkLiked();
return () => {
cancelled = true;
};
}, [currentTrack]);

const handleToggleLike = async () => {
if (!currentTrack) return;
try {
const liked = await invoke<boolean>("toggle_like_track", { trackId: currentTrack.id });
setIsLiked(liked);
} catch (err) {
console.error("Failed to toggle like:", err);
}
};

const handleAddToPlaylistClick = async (e: React.MouseEvent) => {
e.stopPropagation();
const next = !showPlaylistDropdown;
setShowPlaylistDropdown(next);
if (next) {
try {
const pls = await invoke<{ id: number; name: string }[]>("get_playlists");
setPlaylists(pls.filter((p) => p.name !== "Liked Songs"));
} catch (err) {
console.error("Failed to load playlists:", err);
}
}
};

const handleAddToPlaylist = async (playlistId: number) => {
if (!currentTrack) return;
try {
  await invoke("add_track_to_playlist", { playlistId, trackId: currentTrack.id });
} catch (err) {
  console.error("Failed to add to playlist:", err);
}
setShowPlaylistDropdown(false);
};

const duration = currentTrack?.duration_secs ?? 0;
const pct = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
if (!currentTrack || duration <= 0) return;
const rect = e.currentTarget.getBoundingClientRect();
const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
seekTime(ratio * duration);
};

const coverSrc = currentTrack?.cover_path ? convertFileSrc(currentTrack.cover_path) : undefined;

const formatLabel = currentTrack
? [
    currentTrack.format || "FLAC",
    currentTrack.bit_depth > 0 ? `${currentTrack.bit_depth}/${(currentTrack.sample_rate / 1000).toFixed(0)}kHz` : `${(currentTrack.sample_rate / 1000).toFixed(0)}kHz`,
  ].join(" ")
: "";

return (
<motion.div
  initial={{ y: 92 }}
  animate={{ y: 0 }}
  transition={{ type: "spring", stiffness: 300, damping: 30 }}
  className="fixed bottom-0 left-0 right-0 h-[92px] bg-black/60 backdrop-blur-xl border-t border-border z-[100]"
>
  <div className="absolute top-0 left-0 right-0 h-[6px] cursor-pointer group hover:h-[7px] transition-all" onClick={handleSeek}>
    <div className="absolute inset-0 bg-white/[0.08]" />
    <div className="absolute top-0 left-0 bottom-0 bg-gradient-to-r from-violet-500 to-accent rounded-r pointer-events-none" style={{ width: `${pct}%` }} />
    <div className="absolute top-1/2 w-3 h-3 bg-accent rounded-full -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all pointer-events-none shadow-[0_0_8px_var(--color-accent-glow)]" style={{ left: `${pct}%` }} />
  </div>

  <div className="flex items-center justify-between h-full px-6">
    <div className="flex items-center gap-3 min-w-0 flex-1">
      {coverSrc ? (
        <div
          onClick={() => onExpandCurrentTrack?.()}
          className="cursor-pointer rounded overflow-hidden shrink-0"
        >
          <img
            src={coverSrc}
            alt=""
            className="w-[38px] h-[38px] rounded object-cover block"
          />
        </div>
      ) : (
        <div
          onClick={() => onExpandCurrentTrack?.()}
          className="cursor-pointer w-[38px] h-[38px] rounded bg-bg-raised shrink-0"
        />
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text truncate">{currentTrack?.title || "Not Playing"}</span>
          <button
            onClick={handleToggleLike}
            aria-label={isLiked ? "Unlike" : "Like"}
            className={`inline-flex items-center bg-transparent border-none cursor-pointer p-0 ${isLiked ? "text-accent" : "text-text-muted"}`}
          >
            <Heart size={16} fill={isLiked ? "currentColor" : "none"} />
          </button>
          <div className="relative" ref={playlistDropdownRef}>
          <button
            onClick={handleAddToPlaylistClick}
            aria-label="Add to playlist"
            className="inline-flex items-center bg-transparent border-none cursor-pointer p-0 text-text-muted"
          >
            <ListPlus size={15} />
          </button>
            {showPlaylistDropdown && (
              <div className="absolute bottom-full right-0 mb-2 bg-bg-raised border border-border rounded-md p-1 min-w-[160px] z-[1000] shadow-lg shadow-black/50">
                {playlists.map((p) => (
                  <motion.div
                    key={p.id}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      void handleAddToPlaylist(p.id);
                    }}
                    className="px-3 py-2 cursor-pointer text-text rounded text-[13px] hover:bg-bg-hover transition-colors"
                  >
                    {p.name}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="text-[11px] text-text-secondary truncate">{currentTrack?.album || ""}</div>
        <div className="text-[11px] text-text-muted truncate">{currentTrack?.artist || ""}</div>
      </div>
    </div>

    <div className="flex items-center gap-1">
      <button className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border-none bg-transparent p-0 cursor-pointer transition-colors ${isShuffle ? "text-accent" : "text-text-secondary hover:text-text hover:bg-bg-hover"}`} aria-label="Shuffle" onClick={toggleShuffle}>
        <ListMusic size={15} />
      </button>
      <button className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary hover:text-text hover:bg-bg-hover border-none bg-transparent p-0 cursor-pointer transition-colors" aria-label="Previous" onClick={playPrev}>
        <SkipBack size={15} />
      </button>
      <motion.button
        whileTap={{ scale: 0.95 }}
        className="w-11 h-11 rounded-full bg-accent text-bg inline-flex items-center justify-center cursor-pointer border-none shadow-[0_0_20px_var(--color-accent-glow)] hover:scale-105 active:scale-95 transition-transform"
        onClick={() => {
          if (!currentTrack) return;
          togglePlayPause();
        }}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying && !isPaused ? <Pause size={16} /> : <Play size={16} />}
      </motion.button>
      <button className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary hover:text-text hover:bg-bg-hover border-none bg-transparent p-0 cursor-pointer transition-colors" aria-label="Next" onClick={playNext}>
        <SkipForward size={15} />
      </button>
      <button
        className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border-none bg-transparent p-0 cursor-pointer transition-colors relative ${repeatMode === "off" ? "text-text-muted" : "text-accent"}`}
        aria-label="Repeat"
        onClick={toggleRepeat}
      >
        {repeatMode === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
        {repeatMode === "one" && (
          <span className="absolute top-0.5 right-0.5 text-[7px] font-extrabold leading-none text-accent pointer-events-none">
            1
          </span>
        )}
      </button>
    </div>

    <div className="flex items-center gap-3 flex-1 justify-end">
      <button
        onClick={toggleExclusive}
        title={
          exclusiveEnabled
            ? exclusiveActive
              ? "Bit-perfect exclusive mode active — click to disable"
              : "Exclusive mode on, but this track's format isn't supported by the device — playing shared"
            : "Enable bit-perfect exclusive output"
        }
        className="flex items-center bg-transparent border-none cursor-pointer p-0.5 relative"
      >
        <Zap size={13} className={exclusiveEnabled ? "text-accent" : "text-text-muted"} fill={exclusiveActive ? "currentColor" : "none"} />
        {exclusiveActive && (
          <span className="ml-[3px] text-[8px] font-extrabold tracking-wider text-accent">
            EXCL
          </span>
        )}
      </button>
      <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-bg-surface text-text-muted rounded border border-border">
        {formatLabel}
      </span>
      <span className="text-xs text-text-secondary tabular-nums min-w-[84px] text-center">
        {formatDuration(currentTime)} / {formatDuration(currentTrack?.duration_secs ?? 0)}
      </span>
      <Volume2 size={13} className="text-text-secondary" />
      <input
        type="range"
        min="0"
        max="100"
        value={Math.round(volume * 100)}
        onChange={(e) => setVolume(Number(e.target.value) / 100)}
        className="w-24 volume-slider"
      />
    </div>
  </div>
</motion.div>
);
}
