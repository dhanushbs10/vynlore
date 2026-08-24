import { useMemo } from "react";
import { Track } from "../../App";
import { convertFileSrc } from "@tauri-apps/api/core";
import { parseArtists } from "../../utils/artists";

const MOCK = ["Vynlore", "Luna Wave", "Glass Hive", "Nocturne", "Analog Soul", "Echo Chamber", "Driftwood"];

interface ArtistsViewProps {
	tracks: Track[];
	onArtistClick?: (artist: string) => void;
}

function pickRandomCover(tracks: Track[]): string | undefined {
  if (tracks.length === 0) return undefined;
  const withCover = tracks.filter(
    (t) => typeof t.cover_path === "string" && t.cover_path.length > 2
  );
  if (withCover.length === 0) return undefined;
  const idx = Math.floor(Math.random() * withCover.length);
  return convertFileSrc(withCover[idx].cover_path!);
}

export function ArtistsView({ tracks, onArtistClick }: ArtistsViewProps) {
	const list = useMemo(() => {
		if (tracks.length) {
			const set = new Set<string>();
			tracks.forEach((t) => {
				parseArtists(t.artist).forEach((a) => set.add(a));
			});
			return [...set].sort((a, b) => a.localeCompare(b));
		}
		return MOCK;
	}, [tracks]);

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
    list.forEach((artist) => {
      const artistTracks = artistTracksMap.get(artist);
      if (artistTracks) {
        covers[artist] = pickRandomCover(artistTracks);
      }
    });
    return covers;
  }, [list, artistTracksMap]);

	return (
		<div>
			<div className="view-header">
				<div className="view-title">Artists</div>
				<div className="view-subtitle">{list.length} artists</div>
			</div>
			<div className="artists-grid">
				{list.map((a, i) => {
          const coverSrc = artistCovers[a];
          return (
            <div key={i} className="artist-card" onClick={() => onArtistClick?.(a)}>
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
		</div>
	);
}
