import { useState, useMemo } from "react";
import { usePlayer } from "../../context/PlayerContext";
import { convertFileSrc } from "@tauri-apps/api/core";
import { formatDuration, formatSampleRate, hasCover } from "../../utils/format";
import type { Track } from "../../types";

export function TracksView({ tracks }: { tracks: Track[] }) {
  const [query, setQuery] = useState("");
  const { playTrack, currentTrack } = usePlayer();

  const sorted = useMemo(() => {
    return [...tracks].sort((a, b) => {
      const artistCmp = a.artist.localeCompare(b.artist);
      if (artistCmp !== 0) return artistCmp;
      const albumCmp = a.album.localeCompare(b.album);
      if (albumCmp !== 0) return albumCmp;
      const numCmp = (a.track_number ?? 0) - (b.track_number ?? 0);
      if (numCmp !== 0) return numCmp;
      return a.title.localeCompare(b.title);
    });
  }, [tracks]);

  const filtered = query.trim()
    ? sorted.filter(t =>
        [t.title ?? "", t.artist ?? "", t.album ?? ""].some(field =>
          field.toLowerCase().includes(query.toLowerCase())
        )
      )
    : sorted;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-text tracking-tight">Library</h1>
        <p className="text-sm text-text-secondary mt-1">{tracks.length} tracks</p>
      </div>

      <div className="mb-5">
        <input
          className="w-full max-w-sm px-4 py-2.5 rounded-lg border border-border bg-bg-raised text-text text-sm placeholder:text-text-muted focus:outline-none focus:border-white/30 transition-colors"
          placeholder="Search tracks, artists, albums…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <div className="text-base font-semibold text-text-secondary">No tracks found</div>
          <div className="text-sm mt-1">Try adjusting your search query.</div>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-[48px_40px_1fr_1fr_1fr_70px_70px_70px] items-center gap-2.5 px-3 py-2 text-xs font-medium text-text-muted uppercase tracking-wider">
            <div />
            <div>#</div>
            <div>Title</div>
            <div>Artist</div>
            <div>Album</div>
            <div className="text-center">Format</div>
            <div>Freq</div>
            <div className="text-right">Time</div>
          </div>
          {filtered.map((track, idx) => {
            const active = track.id === currentTrack?.id;
            const coverSrc = hasCover(track) ? convertFileSrc(track.cover_path!) : undefined;

            return (
              <TrackRow
                key={track.id}
                track={track}
                index={idx}
                isActive={active}
                playTrack={playTrack}
                coverSrc={coverSrc}
                allTracks={filtered}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TrackRow({
  track,
  index,
  isActive,
  playTrack,
  coverSrc,
  allTracks,
}: {
  track: Track;
  index: number;
  isActive: boolean;
  playTrack: (track: Track, queue?: Track[]) => void;
  coverSrc: string | undefined;
  allTracks: Track[];
}) {
  return (
    <div
      className={`grid grid-cols-[48px_40px_1fr_1fr_1fr_70px_70px_70px] items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-white/5 transition-colors ${isActive ? "bg-white/5" : ""}`}
      onClick={() => playTrack(track, allTracks)}
    >
      <div className="w-12">
        {coverSrc ? (
          <img className="w-10 h-10 rounded-sm object-cover" src={coverSrc} alt="" />
        ) : (
          <div className="w-10 h-10 rounded-sm bg-bg-surface" />
        )}
      </div>
      <div className="text-sm text-text-secondary text-center">
        {isActive ? <span className="eq-bars" /> : index + 1}
      </div>
      <div className="text-sm font-medium text-text truncate">{track.title}</div>
      <div className="text-sm text-text-secondary truncate">{track.artist}</div>
      <div className="text-sm text-text-secondary truncate">{track.album}</div>
      <div className="text-center">
        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wider text-text-muted border border-border">{track.format || "FLAC"}</span>
      </div>
      <div className="text-sm text-text-secondary truncate">{formatSampleRate(track.sample_rate)}</div>
      <div className="text-sm text-text-muted tabular-nums text-right">{formatDuration(track.duration_secs)}</div>
    </div>
  );
}
