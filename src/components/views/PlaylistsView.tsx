import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";

interface Playlist {
  id: number;
  name: string;
  track_count: number;
}

interface PlaylistsViewProps {
  onPlaylistClick: (playlistId: number) => void;
}

export function PlaylistsView(props: PlaylistsViewProps) {
  const { onPlaylistClick } = props;
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  const loadPlaylists = useCallback(async () => {
    try {
      const data = await invoke<Playlist[]>("get_playlists");
      setPlaylists(data);
    } catch (err) {
      console.error("Failed to load playlists:", err);
    }
  }, []);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await invoke("create_playlist", { name: newName.trim() });
      setNewName("");
      setShowCreate(false);
      loadPlaylists();
    } catch (err) {
      console.error("Failed to create playlist:", err);
    }
  };

  const handleDelete = async (e: React.MouseEvent, playlistId: number, name: string) => {
    e.stopPropagation();
    if (name === "Liked Songs") return;
    try {
      await invoke("delete_playlist", { playlistId });
      loadPlaylists();
    } catch (err) {
      console.error("Failed to delete playlist:", err);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-text tracking-tight">Playlists</h1>
          <p className="text-sm text-text-secondary mt-1">{playlists.length} playlists</p>
        </div>
        <motion.button
          className="px-4 py-2 rounded-lg bg-accent text-bg text-sm font-semibold cursor-pointer transition-transform"
          onClick={() => setShowCreate(!showCreate)}
          whileTap={{ scale: 0.95 }}
        >
          + New Playlist
        </motion.button>
      </div>

      {showCreate && (
        <div className="flex gap-2.5 mb-5">
          <input
            className="flex-1 max-w-sm px-4 py-2.5 rounded-lg border border-border bg-bg-raised text-text text-sm placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
            placeholder="Playlist name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <motion.button
            className="px-4 py-2 rounded-lg bg-accent text-bg text-sm font-semibold cursor-pointer transition-transform"
            onClick={handleCreate}
            whileTap={{ scale: 0.95 }}
          >
            Create
          </motion.button>
        </div>
      )}

      <motion.div
        className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-[18px]"
        variants={{ show: { transition: { staggerChildren: 0.03 } } }}
        initial="hidden"
        animate="show"
      >
        {playlists.map((playlist) => (
          <motion.div
            key={playlist.id}
            variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
            whileHover={{ y: -3, transition: { type: "spring", stiffness: 400, damping: 25 } }}
            className="cursor-pointer group"
            onClick={() => onPlaylistClick(playlist.id)}
          >
            <div className="w-full aspect-square bg-bg-surface rounded-xl flex items-center justify-center text-[48px] font-bold text-text-muted relative group">
              ♪
              {playlist.name !== "Liked Songs" && (
                <button
                  onClick={(e) => handleDelete(e, playlist.id, playlist.name)}
                  className="absolute top-1.5 right-1.5 w-[22px] h-[22px] rounded-full bg-black/50 flex items-center justify-center cursor-pointer text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Delete playlist"
                >
                  ×
                </button>
              )}
            </div>
            <div className="mt-2 text-sm font-medium text-text truncate">{playlist.name}</div>
            <div className="text-xs text-text-secondary truncate mt-0.5">{playlist.track_count} tracks</div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
