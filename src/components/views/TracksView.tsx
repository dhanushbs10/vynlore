import { useState, useMemo } from "react";
import { Track } from "../../App";
import { usePlayer } from "../../context/PlayerContext";
import { convertFileSrc } from "@tauri-apps/api/core";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function TracksView({ tracks }: { tracks: Track[] }) {
const [query, setQuery] = useState("");
const { playTrack, currentTrack } = usePlayer();

const shuffled = useMemo(() => shuffle(tracks), [tracks]);

const filtered = query.trim()
? shuffled.filter(t =>
[t.title, t.artist, t.album].some(field =>
field.toLowerCase().includes(query.toLowerCase())
)
)
: shuffled;

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
const coverSrc =
typeof track.cover_path === "string" && track.cover_path.length > 2
? convertFileSrc(track.cover_path)
: undefined;

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
<span className="format-badge">FLAC</span>
</div>
<div className="track-cell track-meta freq-cell">
{track.sample_rate >= 1000
? `${(track.sample_rate / 1000).toFixed(1)} kHz`
: `${track.sample_rate} Hz`}
</div>
<div className="track-cell track-meta time-cell">
{Math.floor(track.duration_secs / 60)}:
{String(Math.floor(track.duration_secs % 60)).padStart(2, "0")}
</div>
</div>
);
}