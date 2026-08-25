import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { hasCover } from "../../utils/format";
import type { Track } from "../../types";

interface GenresViewProps {
  tracks: Track[];
  onGenreClick: (genre: string) => void;
}

function pickRandomCover(tracks: Track[]): string | undefined {
  if (tracks.length === 0) return undefined;
  const withCover = tracks.filter(hasCover);
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
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-text tracking-tight">Genres</h1>
          <p className="text-sm text-text-secondary mt-1">No genres found</p>
        </div>
        <div className="text-center py-16 text-text-muted">
          <div className="text-sm text-text-secondary">No tracks have genre metadata. Add music with genre tags to see them here.</div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-text tracking-tight">Genres</h1>
        <p className="text-sm text-text-secondary mt-1">{genres.length} genres</p>
      </div>

      <motion.div
        className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4"
        variants={{ show: { transition: { staggerChildren: 0.03 } } }}
        initial="hidden"
        animate="show"
      >
        {genres.map((genre) => {
          const coverSrc = genreCovers[genre];
          return (
            <motion.div
              key={genre}
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              whileHover={{ y: -3, transition: { type: "spring", stiffness: 400, damping: 25 } }}
              className="flex flex-col items-center gap-3 p-4 rounded-xl cursor-pointer group"
              onClick={() => onGenreClick(genre)}
            >
              {coverSrc ? (
                <img
                  className="w-[100px] h-[100px] rounded-xl object-cover shadow-lg group-hover:shadow-xl transition-shadow"
                  src={coverSrc}
                  alt={genre}
                />
              ) : (
                <div className="w-[100px] h-[100px] rounded-xl bg-bg-surface flex items-center justify-center text-2xl font-bold text-text-muted">
                  {genre.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="text-sm font-medium text-text text-center">{genre}</div>
            </motion.div>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
