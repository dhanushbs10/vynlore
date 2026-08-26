import { useState, useEffect, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, Play, Shuffle, X, ImagePlus, Repeat, Repeat1 } from "lucide-react";
import { motion } from "framer-motion";
import { usePlayer } from "../../context/PlayerContext";
import { formatDuration, hasCover } from "../../utils/format";
import { fisherYates } from "../../utils/shuffle";
import type { Track } from "../../types";

const PRESET_COLORS = [
  "#ffffff", "#888888", "#555555", "#f87171",
  "#fb923c", "#facc15", "#34d399", "#22d3ee",
  "#60a5fa", "#a78bfa", "#f472b6", "#e879f9",
];

interface PlaylistDetailViewProps {
  playlistId: number;
  playTrack: (track: Track, queue?: Track[]) => void;
  onBack: () => void;
}

export function PlaylistDetailView({ playlistId, playTrack, onBack }: PlaylistDetailViewProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [playlistColor, setPlaylistColor] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const { isShuffle, toggleShuffle, currentTrack, repeatMode, toggleRepeat } = usePlayer();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [trackData, playlistName, cover, color] = await Promise.all([
          invoke<Track[]>("get_playlist_tracks", { playlistId }),
          invoke<string | null>("get_playlist_name", { playlistId }),
          invoke<string | null>("get_playlist_cover", { playlistId }),
          invoke<string | null>("get_playlist_color", { playlistId }),
        ]);
        if (!cancelled) {
          setTracks(trackData);
          setName(playlistName ?? `Playlist ${playlistId}`);
          setCoverPath(cover ?? null);
          setPlaylistColor(color ?? null);
        }
      } catch (err) {
        console.error("Failed to load playlist tracks:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playlistId, reloadKey]);

  useEffect(() => {
    if (!showColorPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showColorPicker]);

  const handleRemoveTrack = async (e: React.MouseEvent, trackId: number) => {
    e.stopPropagation();
    try {
      await invoke("remove_track_from_playlist", { playlistId, trackId });
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("Failed to remove track:", err);
    }
  };

  const startRename = () => {
    setEditingName(name);
    setIsEditing(true);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const commitRename = async () => {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== name) {
      try {
        await invoke("rename_playlist", { playlistId, name: trimmed });
        setName(trimmed);
      } catch (err) {
        console.error("Failed to rename playlist:", err);
      }
    }
    setIsEditing(false);
  };

  const handleUploadCover = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
      });
      if (selected) {
        await invoke("set_playlist_cover", { playlistId, coverPath: selected });
        setCoverPath(selected);
      }
    } catch (err) {
      console.error("Failed to set cover:", err);
    }
  };

  const handleSetColor = async (color: string) => {
    try {
      await invoke("set_playlist_color", { playlistId, color });
      setPlaylistColor(color);
      setShowColorPicker(false);
    } catch (err) {
      console.error("Failed to set color:", err);
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
      <div className="flex items-center gap-5 mb-7">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text transition-colors" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div
          className="w-20 h-20 rounded-lg flex items-center justify-center text-3xl font-bold text-text-muted shrink-0 relative group cursor-pointer overflow-hidden"
          style={coverPath
            ? undefined
            : playlistColor
              ? { background: `linear-gradient(135deg, ${playlistColor}, ${playlistColor}88, rgba(0,0,0,0.4))` }
              : { background: "var(--color-bg-surface)" }
          }
          onClick={handleUploadCover}
          title="Click to change cover"
        >
          {coverPath ? (
            <img src={convertFileSrc(coverPath)} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <span>♪</span>
          )}
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <ImagePlus size={20} className="text-white" />
          </div>
        </div>
        <div>
          {isEditing ? (
            <input
              ref={editInputRef}
              className="font-display text-2xl font-bold text-text tracking-tight bg-transparent border-b border-white/30 outline-none w-full"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                else if (e.key === "Escape") setIsEditing(false);
              }}
              onBlur={commitRename}
            />
          ) : (
            <h1
              className="font-display text-2xl font-bold text-text tracking-tight cursor-pointer hover:text-white transition-colors"
              onDoubleClick={startRename}
              title="Double-click to rename"
            >
              {name}
            </h1>
          )}
          <p className="text-sm text-text-secondary mt-1">
            {tracks.length} track{tracks.length === 1 ? "" : "s"} · {formatDuration(totalDuration)}
          </p>
        </div>
        <div className="flex gap-2.5 ml-auto">
          <div className="relative" ref={colorPickerRef}>
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="w-8 h-8 rounded-md border border-border flex items-center justify-center cursor-pointer hover:bg-white/5 transition-colors"
              title="Change color"
            >
              <div
                className="w-4 h-4 rounded-full border border-white/20"
                style={playlistColor ? { background: playlistColor } : { background: "linear-gradient(135deg, #fff, #888)" }}
              />
            </button>
            {showColorPicker && (
              <div className="absolute top-full right-0 mt-2 bg-[#111] border border-border rounded-lg p-3 z-[50] shadow-2xl shadow-black/60">
                <div className="grid grid-cols-4 gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => handleSetColor(c)}
                      className={`w-7 h-7 rounded-full cursor-pointer border-2 transition-all hover:scale-110 ${playlistColor === c ? "border-white scale-110" : "border-white/20"}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                {playlistColor && (
                  <button
                    onClick={() => handleSetColor("")}
                    className="mt-2 w-full text-[10px] text-text-muted hover:text-text text-center cursor-pointer bg-transparent border-none"
                  >
                    Remove color
                  </button>
                )}
              </div>
            )}
          </div>
          <motion.button
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-transparent text-text-secondary text-xs font-semibold hover:bg-white/5 hover:text-text transition-colors w-auto"
            onClick={handleShuffle}
            whileTap={{ scale: 0.95 }}
            aria-label="Shuffle"
          >
            <Shuffle size={15} />
            <span>Shuffle</span>
          </motion.button>
          <motion.button
            className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center transition-transform"
            onClick={handlePlay}
            whileTap={{ scale: 0.95 }}
            aria-label="Play playlist"
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
                className={`grid grid-cols-[48px_40px_1fr_1fr_70px_40px] items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-white/5 transition-colors ${active ? "bg-white/5" : ""}`}
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
