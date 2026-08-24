import { useState, useEffect } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { usePlayer } from "../context/PlayerContext";
import { Play, Pause, SkipBack, SkipForward, Volume2, ListMusic, Repeat, Repeat1, Heart, ListPlus } from "lucide-react";

function fmt(s: number): string {
if (s <= 0) return "0:00";
const m = Math.floor(s / 60);
const r = Math.floor(s % 60);
return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function PlayerBar({ onExpandCurrentTrack }: { onExpandCurrentTrack?: () => void }) {
const {
currentTrack,
isPlaying,
isPaused,
currentTime,
isShuffle,
repeatMode,
toggleShuffle,
toggleRepeat,
seekTime,
togglePlayPause,
playNext,
playPrev,
} = usePlayer();
const [volume, setVolume] = useState(80);
const [isLiked, setIsLiked] = useState(false);
const [showPlaylistDropdown, setShowPlaylistDropdown] = useState(false);
const [playlists, setPlaylists] = useState<any[]>([]);

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
const pls = await invoke<any[]>("get_playlists");
setPlaylists(pls.filter((p) => p.name !== "Liked Songs"));
}
};

const handleAddToPlaylist = async (playlistId: number) => {
if (!currentTrack) return;
await invoke("add_track_to_playlist", { playlistId, trackId: currentTrack.id });
setShowPlaylistDropdown(false);
};

const duration = currentTrack?.duration_secs ?? 0;
const pct = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
if (!currentTrack || duration <= 0) return;
const rect = e.currentTarget.getBoundingClientRect();
const ratio = (e.clientX - rect.left) / rect.width;
const t = ratio * duration;
seekTime(t);
invoke("seek_playback", { seekSecs: t }).catch((err) => console.error("Seek failed:", err));
};

const coverSrc = currentTrack?.cover_path ? convertFileSrc(currentTrack.cover_path) : undefined;

const formatLabel = currentTrack
? `FLAC ${currentTrack.bit_depth}/${currentTrack.sample_rate >= 1000 ? (currentTrack.sample_rate / 1000).toFixed(0) + "kHz" : currentTrack.sample_rate + "Hz"}`
: "";

const repeatColor = repeatMode === "off" ? "var(--text-tertiary)" : "#d4a373";

return (
<div className="player-bar-container">
<div className="progress-track" onClick={handleSeek}>
<div className="progress-fill" style={{ width: `${pct}%` }} />
<div className="progress-thumb" style={{ left: `${pct}%` }} />
</div>

<div className="player-bar-inner">
<div className="track-info-left" style={{ display: "flex", alignItems: "center", gap: 10 }}>
  {coverSrc ? (
    <div
      onClick={() => onExpandCurrentTrack?.()}
      style={{ cursor: "pointer", borderRadius: 4, overflow: "hidden" }}
    >
      <img
        src={coverSrc}
        alt=""
        style={{ width: 38, height: 38, borderRadius: 4, objectFit: "cover", display: "block" }}
      />
    </div>
  ) : (
    <div
      onClick={() => onExpandCurrentTrack?.()}
      style={{ cursor: "pointer", width: 38, height: 38, borderRadius: 4, background: "var(--bg-raised)" }}
    />
  )}
  <div>
<div className="track-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
{currentTrack?.title || "Not Playing"}
<button
onClick={handleToggleLike}
aria-label={isLiked ? "Unlike" : "Like"}
style={{
background: "none",
border: "none",
cursor: "pointer",
padding: 0,
display: "inline-flex",
alignItems: "center",
color: isLiked ? "#d4a373" : "var(--text-tertiary)",
}}
>
<Heart size={16} fill={isLiked ? "#d4a373" : "none"} />
</button>
<button
onClick={handleAddToPlaylistClick}
aria-label="Add to playlist"
style={{
background: "none",
border: "none",
cursor: "pointer",
padding: 0,
display: "inline-flex",
alignItems: "center",
color: "var(--text-tertiary)",
position: "relative",
}}
>
<ListPlus size={15} />
{showPlaylistDropdown && (
<div
style={{
position: "absolute",
bottom: 60,
right: 0,
background: "#141414",
border: "1px solid #333",
borderRadius: 6,
padding: 4,
minWidth: 160,
zIndex: 1000,
boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
}}
>
{playlists.map((p) => (
<div
key={p.id}
onClick={() => {
void handleAddToPlaylist(p.id);
}}
style={{
padding: "8px 12px",
cursor: "pointer",
color: "#e0e0e0",
borderRadius: 4,
fontSize: 13,
}}
onMouseEnter={(e) => {
(e.target as HTMLDivElement).style.background = "#1e1e1e";
}}
onMouseLeave={(e) => {
(e.target as HTMLDivElement).style.background = "transparent";
}}
>
{p.name}
</div>
))}
</div>
)}
</button>
</div>
<div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{currentTrack?.album || ""}</div>
<div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{currentTrack?.artist || ""}</div>
</div>
</div>

<div className="center-controls">
<button className="ctrl-btn icon-only" aria-label="Shuffle" onClick={toggleShuffle} style={{ color: isShuffle ? "var(--accent)" : "var(--text-tertiary)" }}>
<ListMusic size={15} />
</button>
<button className="ctrl-btn icon-only" aria-label="Previous" onClick={playPrev}>
<SkipBack size={15} />
</button>
<button
className="play-btn"
onClick={() => {
if (!currentTrack) return;
togglePlayPause();
}}
aria-label={isPlaying ? "Pause" : "Play"}
>
{isPlaying && !isPaused ? <Pause size={16} /> : <Play size={16} />}
</button>
<button className="ctrl-btn icon-only" aria-label="Next" onClick={playNext}>
<SkipForward size={15} />
</button>
<button className="ctrl-btn icon-only" aria-label="Repeat" onClick={toggleRepeat} style={{ color: repeatColor, position: "relative" }}>
{repeatMode === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
{repeatMode === "one" && (
<span
style={{
position: "absolute",
top: 2,
right: 2,
fontSize: 7,
fontWeight: 800,
lineHeight: 1,
color: "#d4a373",
pointerEvents: "none",
}}
>
1
</span>
)}
</button>
</div>

<div className="right-controls">
<span className="format-badge-sm">{formatLabel}</span>
<span className="time-display">
{fmt(currentTime)} / {fmt(currentTrack?.duration_secs ?? 0)}
</span>
<Volume2 size={13} style={{ color: "var(--text-secondary)" }} />
<input
type="range"
min="0"
max="100"
value={volume}
onChange={(e) => {
const v = Number(e.target.value);
setVolume(v);
invoke("set_volume", { volume: v / 100 });
}}
className="volume-slider"
/>
</div>
</div>
</div>
);
}