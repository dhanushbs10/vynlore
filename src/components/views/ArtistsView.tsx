import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { parseArtists } from "../../utils/artists";
import { hasCover } from "../../utils/format";
import type { Track } from "../../types";

interface ArtistsViewProps {
  tracks: Track[];
  onArtistClick?: (artist: string) => void;
}

function pickCover(tracks: Track[]): string | undefined {
  if (tracks.length === 0) return undefined;
  const withCover = tracks.filter(hasCover);
  if (withCover.length === 0) return undefined;
  return convertFileSrc(withCover[0].cover_path!);
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
        covers[artist] = pickCover(artistTracks);
      }
    });
    return covers;
  }, [filtered, artistTracksMap]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-text tracking-tight">Artists</h1>
        <p className="text-sm text-text-secondary mt-1">{filtered.length} artists</p>
      </div>

      <div className="mb-5">
        <input
          className="w-full max-w-sm px-4 py-2.5 rounded-lg border border-border bg-bg-raised text-text text-sm placeholder:text-text-muted focus:outline-none focus:border-white/30 transition-colors"
          placeholder="Search artists…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <div className="text-base font-semibold text-text-secondary">No artists found</div>
          <div className="text-sm mt-1">Try a different search term</div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
          {filtered.map((a) => {
            const coverSrc = artistCovers[a];
            return (
              <div
                key={a}
                className="flex flex-col items-center gap-3 p-4 rounded-lg cursor-pointer group"
                onClick={() => onArtistClick?.(a)}
              >
                {coverSrc ? (
                  <img
                    className="w-full aspect-square rounded-full object-cover"
                    src={coverSrc}
                    alt={a}
                  />
                ) : (
                  <div className="w-full aspect-square rounded-full bg-bg-surface flex items-center justify-center text-3xl font-bold text-text-muted">
                    {a.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="text-sm font-medium text-text truncate w-full text-center">{a}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
