import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Play, Maximize2, FolderOpen } from "lucide-react";
import { hasCover } from "../../utils/format";
import type { Track } from "../../types";

interface HomeViewProps {
  libraryTracks: Track[];
  recentlyPlayed?: Track[];
  playTrack: (track: Track, queue?: Track[]) => void;
  onExpandTrack: (track: Track, queue?: Track[]) => void;
  watchedFolder: string | null;
  onSelectFolder: () => void;
  scanning?: boolean;
}

function buildSuggestions(recent: Track[], library: Track[]) {
  if (recent.length === 0) return [];

  const suggestions: { title: string; tracks: Track[] }[] = [];
  const recentIds = new Set(recent.map((t) => t.id));

  const artistCounts = new Map<string, number>();
  for (const t of recent) {
    const a = (t.artist || "Unknown Artist").trim();
    artistCounts.set(a, (artistCounts.get(a) || 0) + 1);
  }
  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([a]) => a);

  for (const artist of topArtists) {
    const matches = library.filter(
      (t) => t.artist?.trim() === artist && !recentIds.has(t.id)
    );
    if (matches.length >= 3) {
      suggestions.push({
        title: `More like ${artist}`,
        tracks: matches.slice(0, 8),
      });
    }
  }

  const genreCounts = new Map<string, number>();
  for (const t of recent) {
    const g = (t.genre || "").trim();
    if (!g) continue;
    genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
  }
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);

  for (const genre of topGenres) {
    const matches = library.filter(
      (t) => (t.genre || "").trim() === genre && !recentIds.has(t.id)
    );
    if (matches.length >= 3) {
      const picks = matches.sort(() => Math.random() - 0.5).slice(0, 8);
      suggestions.push({
        title: `Because you listen to ${genre}`,
        tracks: picks,
      });
    }
  }

  if (suggestions.length < 2) {
    const unmatched = library.filter((t) => !recentIds.has(t.id));
    if (unmatched.length >= 4) {
      const picks = unmatched.sort(() => Math.random() - 0.5).slice(0, 8);
      suggestions.push({ title: "Discover", tracks: picks });
    }
  }

  return suggestions;
}

export function HomeView({ libraryTracks, recentlyPlayed = [], playTrack, onExpandTrack, watchedFolder, onSelectFolder, scanning }: HomeViewProps) {
  const recentlyAdded = useMemo(() => {
    return [...libraryTracks].sort((a, b) => b.id - a.id).slice(0, 20);
  }, [libraryTracks]);

  const suggestions = useMemo(
    () => buildSuggestions(recentlyPlayed, libraryTracks),
    [recentlyPlayed, libraryTracks]
  );

  if (!watchedFolder) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 pb-24">
        <FolderOpen size={48} className="text-text-muted mb-2" />
        <div className="text-lg font-semibold text-text-secondary">No folder selected</div>
        <div className="text-sm text-text-muted mb-4">Select a music folder to get started</div>
        <button
          onClick={onSelectFolder}
          className="flex items-center gap-2 px-7 py-3 rounded-lg bg-white text-black text-sm font-semibold cursor-pointer"
        >
          <FolderOpen size={18} />
          Select Folder
        </button>
      </div>
    );
  }

  if (libraryTracks.length === 0) {
    return (
      <div>
        <div className="text-center pt-32 pb-16 text-text-muted">
          <div className="text-base font-semibold text-text-secondary">{scanning ? "Scanning your library…" : "Library is empty"}</div>
          <div className="text-sm mt-1">
            {scanning ? "This may take a moment for large folders." : "Add audio files (FLAC, WAV, AIFF, MP3, M4A, OGG) to your watched folder to see them here."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <div className="mb-6 flex items-center gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-text tracking-tight">Home</h1>
          <p className="text-sm text-text-secondary mt-1">{recentlyPlayed.length > 0 ? "Your music, made for you" : "Recently Added"}</p>
        </div>
        {scanning && (
          <div className="text-xs text-white font-medium">Scanning…</div>
        )}
      </div>

      {recentlyPlayed.length > 0 && (
        <Section title="Recently Played">
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
            {recentlyPlayed.map((track) => (
              <HorizontalCard key={`rp-${track.id}`} track={track} queue={recentlyPlayed} playTrack={playTrack} onExpandTrack={onExpandTrack} />
            ))}
          </div>
        </Section>
      )}

      {suggestions.map((s, i) => (
        <Section key={`sug-${i}`} title={s.title}>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
            {s.tracks.map((track) => (
              <HorizontalCard key={`sug-${i}-${track.id}`} track={track} queue={s.tracks} playTrack={playTrack} onExpandTrack={onExpandTrack} />
            ))}
          </div>
        </Section>
      ))}

      {recentlyAdded.length > 0 && (
        <Section title="Recently Added">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">
            {recentlyAdded.map((track) => (
              <TrackCard key={`ra-${track.id}`} track={track} queue={recentlyAdded} playTrack={playTrack} onExpandTrack={onExpandTrack} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="mb-3 text-[14px] font-semibold text-text">{title}</div>
      {children}
    </div>
  );
}

function HorizontalCard({
  track,
  queue,
  playTrack,
  onExpandTrack,
}: {
  track: Track;
  queue: Track[];
  playTrack: (track: Track, queue?: Track[]) => void;
  onExpandTrack: (track: Track, queue?: Track[]) => void;
}) {
  const coverSrc = hasCover(track) ? convertFileSrc(track.cover_path!) : undefined;

  return (
    <div
      className="shrink-0 w-[150px] cursor-pointer group"
      onClick={() => playTrack(track, queue)}
    >
      <div className="relative">
        {coverSrc ? (
          <img className="w-[150px] h-[150px] object-cover rounded-md" src={coverSrc} alt={track.title} />
        ) : (
          <div className="w-[150px] h-[150px] bg-bg-surface rounded-md" />
        )}
        <button
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 scale-0 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 w-11 h-11 rounded-full bg-white/90 text-black flex items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            playTrack(track, queue);
          }}
          aria-label={`Play ${track.title}`}
        >
          <Play size={22} fill="currentColor" />
        </button>
        <button
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center cursor-pointer text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          onClick={(e) => {
            e.stopPropagation();
            onExpandTrack(track, queue);
          }}
          aria-label="Expand"
        >
          <Maximize2 size={14} />
        </button>
      </div>
      <div className="mt-2 text-sm font-medium text-text truncate w-[150px]" title={track.title}>{track.title}</div>
      <div className="text-xs text-text-secondary truncate mt-0.5 w-[150px]" title={track.artist}>{track.artist}</div>
    </div>
  );
}

function TrackCard({
  track,
  queue,
  playTrack,
  onExpandTrack,
}: {
  track: Track;
  queue: Track[];
  playTrack: (track: Track, queue?: Track[]) => void;
  onExpandTrack: (track: Track, queue?: Track[]) => void;
}) {
  const coverSrc = hasCover(track) ? convertFileSrc(track.cover_path!) : undefined;

  return (
    <div
      className="relative cursor-pointer group"
      onClick={() => playTrack(track, queue)}
    >
      <div className="relative">
        {coverSrc ? (
          <img className="w-full aspect-square object-cover rounded-md" src={coverSrc} alt={track.title} />
        ) : (
          <div className="w-full aspect-square bg-bg-surface rounded-md" />
        )}
        <button
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 scale-0 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 w-11 h-11 rounded-full bg-white/90 text-black flex items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            playTrack(track, queue);
          }}
          aria-label={`Play ${track.title}`}
        >
          <Play size={22} fill="currentColor" />
        </button>
        <button
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center cursor-pointer text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          onClick={(e) => {
            e.stopPropagation();
            onExpandTrack(track, queue);
          }}
          aria-label="Expand"
        >
          <Maximize2 size={14} />
        </button>
      </div>
      <div className="mt-2 text-sm font-medium text-text truncate" title={track.title}>{track.title}</div>
      <div className="text-xs text-text-secondary truncate mt-0.5" title={track.artist}>{track.artist}</div>
    </div>
  );
}
