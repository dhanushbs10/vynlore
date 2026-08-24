import { useMemo } from "react";
import { Track } from "../../App";
import { convertFileSrc } from "@tauri-apps/api/core";

interface GenresViewProps {
  tracks: Track[];
  onGenreClick: (genre: string) => void;
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

export function GenresView({ tracks, onGenreClick }: GenresViewProps) {
  const genres = useMemo(() => {
    const map = new Map<string, Track[]>();
    tracks.forEach((t) => {
      let genre = (t.genre || "").trim();
      if (!genre) {
        genre = "Uncategorized";
      }
      const list = map.get(genre) || [];
      list.push(t);
      map.set(genre, list);
    });
    return Array.from(map.keys()).sort();
  }, [tracks]);

  const genreCovers = useMemo(() => {
    const covers: Record<string, string | undefined> = {};
    genres.forEach((genre) => {
      const tracksForGenre = tracks.filter((t) => {
        const g = (t.genre || "").trim();
        return (!g && genre === "Uncategorized") || g === genre;
      });
      covers[genre] = pickRandomCover(tracksForGenre);
    });
    return covers;
  }, [genres, tracks]);

  if (genres.length === 0) {
    return (
      <div>
        <div className="view-header">
          <div className="view-title">Genres</div>
          <div className="view-subtitle">No genres found</div>
        </div>
        <div className="empty-state">
          <div className="empty-state-text">
            No tracks have genre metadata. Add music with genre tags to see them here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="view-header">
        <div className="view-title">Genres</div>
        <div className="view-subtitle">{genres.length} genres</div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 16,
        }}
      >
        {genres.map((genre) => {
          const coverSrc = genreCovers[genre];
          return (
            <div
              key={genre}
              className="artist-card"
              onClick={() => onGenreClick(genre)}
              style={{ cursor: "pointer" }}
            >
              {coverSrc ? (
                <img
                  className="album-art-img"
                  src={coverSrc}
                  alt={genre}
                  style={{ width: 100, height: 100, margin: "0 auto", display: "block" }}
                />
              ) : (
                <div
                  className="artist-art-placeholder"
                  style={{ width: 100, height: 100, margin: "0 auto" }}
                >
                  {genre.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="artist-name" style={{ textAlign: "center" }}>{genre}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
