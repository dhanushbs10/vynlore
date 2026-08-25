import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../../types";

interface Playlist {
id: number;
name: string;
track_count: number;
}

interface PlaylistsViewProps {
  _libraryTracks: Track[];
  _playTrack: (track: Track, queue?: Track[]) => void;
  onPlaylistClick: (playlistId: number) => void;
}

export function PlaylistsView(props: PlaylistsViewProps) {
const { onPlaylistClick } = props;
const [playlists, setPlaylists] = useState<Playlist[]>([]);
const [showCreate, setShowCreate] = useState(false);
const [newName, setNewName] = useState("");

useEffect(() => {
loadPlaylists();
}, []);

const loadPlaylists = async () => {
try {
const data = await invoke<Playlist[]>("get_playlists");
setPlaylists(data);
} catch (err) {
console.error("Failed to load playlists:", err);
}
};

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
<div className="view-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
<div>
<div className="view-title">Playlists</div>
<div className="view-subtitle">{playlists.length} playlists</div>
</div>
<button
className="play-btn"
onClick={() => setShowCreate(!showCreate)}
style={{ width: "auto", padding: "8px 16px" }}
>
+ New Playlist
</button>
</div>

{showCreate && (
<div style={{ marginBottom: 20, display: "flex", gap: 10 }}>
<input
className="search-input"
placeholder="Playlist name..."
value={newName}
onChange={(e) => setNewName(e.target.value)}
onKeyDown={(e) => e.key === "Enter" && handleCreate()}
/>
<button className="play-btn" onClick={handleCreate} style={{ width: "auto", padding: "8px 16px" }}>
Create
</button>
</div>
)}

<div className="albums-grid">
{playlists.map((playlist) => (
<div
key={playlist.id}
className="album-card"
onClick={() => onPlaylistClick(playlist.id)}
>
<div className="album-art" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48, fontWeight: 700, color: "var(--text-tertiary)", position: "relative" }}>
♪
{playlist.name !== "Liked Songs" && (
<button
onClick={(e) => handleDelete(e, playlist.id, playlist.name)}
style={{
position: "absolute",
top: 6,
right: 6,
background: "rgba(0,0,0,0.5)",
border: "none",
borderRadius: "50%",
width: 22,
height: 22,
display: "flex",
alignItems: "center",
justifyContent: "center",
cursor: "pointer",
color: "#fff",
fontSize: 12,
lineHeight: 1,
}}
aria-label="Delete playlist"
>
×
</button>
)}
</div>
<div className="album-title">{playlist.name}</div>
<div className="album-artist">{playlist.track_count} tracks</div>
</div>
))}
</div>
</div>
);
}