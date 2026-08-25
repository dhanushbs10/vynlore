import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { parseArtists } from "../../utils/artists";
import { hasCover } from "../../utils/format";
import type { Track } from "../../types";

interface ArtistsViewProps {
	tracks: Track[];
	onArtistClick?: (artist: string) => void;
}

function pickRandomCover(tracks: Track[]): string | undefined {
  if (tracks.length === 0) return undefined;
  const withCover = tracks.filter(hasCover);
  if (withCover.length === 0) return undefined;
  const idx = Math.floor(Math.random() * withCover.length);
  return convertFileSrc(withCover[idx].cover_path!);
}

export function ArtistsView({ tracks, onArtistClick }: ArtistsViewProps) {
	const [query, setQuery] = useState("");
	const list = useMemo(() => {
		const set = new Set<string>();
		tracks.forEach((t) => {
			parseArtists(t.artist).forEach((a) => set.add(a));
		});
		return [...set].sort((a, b) => a.localeCompare(b));
	}, [tracks]);

	const filtered = useMemo(() => {
		if (!query.trim()) return list;
		const q = query.toLowerCase();
		return list.filter((a) => a.toLowerCase().includes(q));
	}, [list, query]);

  const artistTracksMap = useMemo(() => {
    const map = new Map<string, Track[]>();
    tracks.forEach((t) => {
      parseArtists(t.artist).forEach((a) => {
        const list = map.get(a) || [];
        list.push(t);
        map.set(a, list);
      });
    });
    return map;
  }, [tracks]);

  const artistCovers = useMemo(() => {
    const covers: Record<string, string | undefined> = {};
    filtered.forEach((artist) => {
      const artistTracks = artistTracksMap.get(artist);
      if (artistTracks) {
        covers[artist] = pickRandomCover(artistTracks);
      }
    });
    return covers;
  }, [filtered, artistTracksMap]);

	return (
		<div>
			<div className="view-header">
				<div className="view-title">Artists</div>
				<div className="view-subtitle">{filtered.length} artists</div>
			</div>

			<div className="search-bar">
				<input
					className="search-input"
					placeholder="Search artists…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
			</div>

			{filtered.length === 0 ? (
				<div className="empty-state">
					<div className="empty-state-icon">♪</div>
					<div className="empty-state-title">No artists found</div>
					<div className="empty-state-desc">Try a different search term</div>
				</div>
			) : (
				<div className="artists-grid">
				{filtered.map((a) => {
					const coverSrc = artistCovers[a];
					return (
						<div key={a} className="artist-card" onClick={() => onArtistClick?.(a)}>
								{coverSrc ? (
									<img
										className="album-art-img"
										src={coverSrc}
										alt={a}
										style={{ width: "100%", aspectRatio: "1", borderRadius: "var(--radius-md)", objectFit: "cover" }}
									/>
								) : (
									<div className="artist-art-placeholder">{a.charAt(0).toUpperCase()}</div>
								)}
								<div className="artist-name">{a}</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
