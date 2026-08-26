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
          cover_path: undefined,
          count: 0,
        });
      }
      const entry = map.get(key)!;
      entry.count += 1;
      if (!entry.cover_path && hasCover(t)) {
        entry.cover_path = t.cover_path;
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      a.title.localeCompare(b.title)
    );
  }, [tracks]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-text tracking-tight">Albums</h1>
        <p className="text-sm text-text-secondary mt-1">{albums.length} albums</p>
      </div>
      {albums.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <div className="text-base font-semibold text-text-secondary">No albums yet</div>
          <div className="text-sm mt-1">Add a music folder to build your library.</div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {albums.map((a) => (
            <div
              key={a.title}
              className="cursor-pointer group"
              onClick={() => onAlbumClick?.(a.title)}
            >
              {a.cover_path ? (
                <img className="w-full aspect-square object-cover rounded-md" src={convertFileSrc(a.cover_path)} alt="" />
              ) : (
                <div className="w-full aspect-square bg-bg-surface rounded-md" />
              )}
              <div className="mt-2 text-sm font-medium text-text truncate">{a.title}</div>
              <div className="text-xs text-text-secondary truncate mt-0.5">{a.artist} · {a.count} track{a.count === 1 ? "" : "s"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
