import { useState, useEffect, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

interface Playlist {
  id: number;
  name: string;
  track_count: number;
  cover_path: string | null;
  color: string | null;
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
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-text tracking-tight">Playlists</h1>
          <p className="text-sm text-text-secondary mt-1">{playlists.length} playlists</p>
        </div>
        <button
          className="px-4 py-2 rounded-lg bg-white text-black text-sm font-semibold cursor-pointer"
          onClick={() => setShowCreate(!showCreate)}
        >
          + New Playlist
        </button>
      </div>

      {showCreate && (
        <div className="flex gap-2.5 mb-5">
          <input
            className="flex-1 max-w-sm px-4 py-2.5 rounded-lg border border-border bg-bg-raised text-text text-sm placeholder:text-text-muted focus:outline-none focus:border-white/30 transition-colors"
            placeholder="Playlist name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              else if (e.key === "Escape") { setShowCreate(false); setNewName(""); }
            }}
          />
          <button
            className="px-4 py-2 rounded-lg bg-white text-black text-sm font-semibold cursor-pointer"
            onClick={handleCreate}
          >
            Create
          </button>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        {playlists.map((playlist) => (
          <div
            key={playlist.id}
            className="cursor-pointer group"
            onClick={() => onPlaylistClick(playlist.id)}
          >
            <div
              className="w-full aspect-square rounded-md flex items-center justify-center text-[48px] font-bold text-text-muted relative group overflow-hidden"
              style={playlist.cover_path
                ? undefined
                : playlist.color
                  ? { background: `linear-gradient(135deg, ${playlist.color}, ${playlist.color}88, rgba(0,0,0,0.4))` }
                  : { background: "var(--color-bg-surface)" }
              }
            >
              {playlist.cover_path ? (
                <img
                  src={convertFileSrc(playlist.cover_path)}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <span>♪</span>
              )}
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
          </div>
        ))}
      </div>
    </div>
  );
}
