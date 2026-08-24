import { useMemo } from "react";
import { Track } from "../../App";
import { convertFileSrc } from "@tauri-apps/api/core";

const MOCK = [
	{ title: "Midnight Frequencies", artist: "Vynlore", cover_path: "" },
	{ title: "Echoes in Amber", artist: "Luna Wave", cover_path: "" },
	{ title: "Static Dreams", artist: "Glass Hive", cover_path: "" },
	{ title: "Reverb", artist: "Nocturne", cover_path: "" },
	{ title: "Warm Circuits", artist: "Analog Soul", cover_path: "" },
];

interface AlbumsViewProps {
	tracks: Track[];
	onAlbumClick?: (album: string) => void;
}

export function AlbumsView({ tracks, onAlbumClick }: AlbumsViewProps) {
	const albums = useMemo(() => {
		if (!tracks.length) return MOCK;
		const map = new Map<string, { title: string; artist: string; cover_path: string }>();
		tracks.forEach((t) => {
			const key = t.album || "Unknown Album";
			if (!map.has(key)) {
				map.set(key, {
					title: t.album || "Unknown Album",
					artist: t.artist || "Unknown Artist",
					cover_path: (t as any).cover_path || "",
				});
			}
		});
		return Array.from(map.values());
	}, [tracks]);

	return (
		<div>
			<div className="view-header">
				<div className="view-title">Albums</div>
				<div className="view-subtitle">{albums.length} albums</div>
			</div>
			<div className="albums-grid">
				{albums.map((a, i) => (
					<div key={i} className="album-card" onClick={() => onAlbumClick?.(a.title)}>
						{a.cover_path ? (
							<img className="album-art-img" src={convertFileSrc(a.cover_path)} alt="" />
						) : (
							<div className="album-art" />
						)}
						<div className="album-title">{a.title}</div>
						<div className="album-artist">{a.artist}</div>
					</div>
				))}
			</div>
		</div>
	);
}
