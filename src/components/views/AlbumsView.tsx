import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { hasCover } from "../../utils/format";
import type { Track } from "../../types";

interface AlbumsViewProps {
	tracks: Track[];
	onAlbumClick?: (album: string) => void;
}

export function AlbumsView({ tracks, onAlbumClick }: AlbumsViewProps) {
	const albums = useMemo(() => {
		const map = new Map<string, { title: string; artist: string; cover_path?: string | null; count: number }>();
		tracks.forEach((t) => {
			const key = t.album || "Unknown Album";
			if (!map.has(key)) {
				map.set(key, {
					title: key,
					artist: t.artist || "Unknown Artist",
					cover_path: hasCover(t) ? t.cover_path : undefined,
					count: 0,
				});
			}
			const entry = map.get(key)!;
			entry.count += 1;
		});
		return Array.from(map.values()).sort((a, b) =>
			a.title.localeCompare(b.title)
		);
	}, [tracks]);

	return (
		<div>
			<div className="view-header">
				<div className="view-title">Albums</div>
				<div className="view-subtitle">{albums.length} albums</div>
			</div>
			{albums.length === 0 ? (
				<div className="empty-state">
					<div className="empty-state-icon">♪</div>
					<div className="empty-state-title">No albums yet</div>
					<div className="empty-state-desc">Add a music folder to build your library.</div>
				</div>
			) : (
				<div className="albums-grid">
					{albums.map((a) => (
						<div
							key={a.title}
							className="album-card"
							onClick={() => onAlbumClick?.(a.title)}
						>
							{a.cover_path ? (
								<img className="album-art-img" src={convertFileSrc(a.cover_path)} alt="" />
							) : (
								<div className="album-art" />
							)}
							<div className="album-title">{a.title}</div>
							<div className="album-artist">{`${a.artist} · ${a.count} track${a.count === 1 ? "" : "s"}`}</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
