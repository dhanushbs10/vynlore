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
<div className="view-header">
<div className="view-title">Library</div>
<div className="view-subtitle">{tracks.length} tracks</div>
</div>

<div className="search-bar">
<input
className="search-input"
placeholder="Search tracks, artists, albums…"
value={query}
onChange={e => setQuery(e.target.value)}
/>
</div>

{filtered.length === 0 ? (
<div className="empty-state">
<div className="empty-state-icon">♪</div>
<div className="empty-state-title">No tracks found</div>
<div className="empty-state-desc">Try adjusting your search query.</div>
</div>
) : (
<div className="tracks-table">
<div className="tracks-row track-header">
<div className="track-cell" style={{ width: 48 }} />
<div className="track-cell">#</div>
<div className="track-cell">Title</div>
<div className="track-cell">Artist</div>
<div className="track-cell">Album</div>
<div className="track-cell">FORMAT</div>
<div className="track-cell">FREQ</div>
<div className="track-cell time-cell">TIME</div>
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
className={`tracks-row ${isActive ? "track-active" : ""}`}
onClick={() => playTrack(track, allTracks)}
>
<div className="track-cell" style={{ width: 48 }}>
{coverSrc ? (
<img className="track-thumb" src={coverSrc} alt="" />
) : (
<div className="track-thumb-empty" />
)}
</div>
<div className="track-cell track-num">
{isActive ? <span className="equalizer" /> : index + 1}
</div>
<div className="track-cell track-title">{track.title}</div>
<div className="track-cell track-meta">{track.artist}</div>
<div className="track-cell track-meta">{track.album}</div>
<div className="track-cell track-meta">
<span className="format-badge">{track.format || "FLAC"}</span>
</div>
<div className="track-cell track-meta freq-cell">
{formatSampleRate(track.sample_rate)}
</div>
<div className="track-cell track-meta time-cell">
{formatDuration(track.duration_secs)}
</div>
</div>
);
}
