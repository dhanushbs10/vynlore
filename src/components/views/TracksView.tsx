import { useState, useMemo } from "react";
import { usePlayer } from "../../context/PlayerContext";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ListMusic, FileUp, FileDown, Pencil } from "lucide-react";
import { formatDuration, formatSampleRate, hasCover } from "../../utils/format";
import { QualityBadge } from "../QualityBadge";
import type { Track } from "../../types";

function transientTrack(path: string): Track {
  const fileName = path.split(/[/\\]/).pop() || "Unknown";
  return {
    id: -1,
    title: fileName,
    artist: "",
    album: "",
    file_path: path,
    cover_path: null,
    duration_secs: 0,
    format: fileName.split(".").pop()?.toUpperCase() || "",
    sample_rate: 0,
    bit_depth: 0,
    channels: 2,
    track_number: 0,
    disc_number: 0,
    play_count: 0,
    bitrate: 0,
    genre: null,
  };
}

export function TracksView({ tracks, onEditTrack }: { tracks: Track[]; onEditTrack?: (track: Track) => void }) {
  const [query, setQuery] = useState("");
  const { playTrack, currentTrack, displayedTracks } = usePlayer();

  const handleImport = async () => {
    if (!isTauri()) return;
    const selected = await openDialog({
      multiple: false,
      filters: [
        { name: "Playlist", extensions: ["m3u", "m3u8"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!selected) return;
    try {
      const paths = await invoke<string[]>("read_playlist_file", { path: selected as string });
      const queue = paths.map(transientTrack).filter((t) => t.file_path.length > 0);
      if (queue.length > 0) {
        await playTrack(queue[0], queue);
      }
    } catch (err) {
      console.error("M3U import failed:", err);
    }
  };

  const handleExport = async () => {
    if (!isTauri()) return;
    const targets = displayedTracks.length > 0 ? displayedTracks : tracks;
    if (targets.length === 0) return;
    const selected = await saveDialog({
      defaultPath: "vynlore.m3u",
      filters: [{ name: "Playlist", extensions: ["m3u"] }],
    });
    if (!selected) return;
    try {
      await invoke("write_playlist_file", {
        path: selected as string,
        entries: targets.map((t) => ({
          title: t.title,
          artist: t.artist || "Unknown Artist",
          duration_secs: t.duration_secs || 0,
          file_path: t.file_path,
        })),
      });
    } catch (err) {
      console.error("M3U export failed:", err);
    }
  };

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
      <div className="mb-6 flex items-center gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-text tracking-tight">Library</h1>
          <p className="text-sm text-text-secondary mt-1">{tracks.length} tracks</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleImport}
            title="Import an .m3u playlist and play it"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12px] font-medium text-text-secondary cursor-pointer hover:text-text hover:bg-bg-hover transition-colors"
          >
            <FileUp size={13} />
            Import playlist…
          </button>
          <button
            onClick={handleExport}
            disabled={tracks.length === 0}
            title="Export the current queue as an .m3u file"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12px] font-medium text-text-secondary cursor-pointer hover:text-text hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileDown size={13} />
            Export queue…
          </button>
        </div>
      </div>

      <div className="mb-5 flex items-center gap-4">
        <input
          className="w-full max-w-sm px-4 py-2.5 rounded-lg border border-border bg-bg-raised text-text text-sm placeholder:text-text-muted focus:outline-none focus:border-white-30 transition-colors"
          placeholder="Search tracks, artists, albums…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {displayedTracks.length > 0 && displayedTracks[0].id === -1 && (
          <span className="text-xs text-text-muted flex items-center gap-1.5">
            <ListMusic size={13} />
            Playing an imported playlist
          </span>
        )}
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
                onEditTrack={onEditTrack}
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
  onEditTrack,
}: {
  track: Track;
  index: number;
  isActive: boolean;
  playTrack: (track: Track, queue?: Track[]) => void;
  coverSrc: string | undefined;
  allTracks: Track[];
  onEditTrack?: (track: Track) => void;
}) {
  return (
    <div
      className={`group relative grid grid-cols-[48px_40px_1fr_1fr_1fr_70px_70px_70px] items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-white-5 transition-colors ${isActive ? "bg-white-5" : ""}`}
      onClick={() => playTrack(track, allTracks)}
    >
      {onEditTrack && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEditTrack(track);
          }}
          title="Edit tags…"
          aria-label={`Edit tags for ${track.title}`}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 flex items-center justify-center rounded-md text-text-muted opacity-0 group-hover:opacity-100 hover:text-text hover:bg-white-10 transition-all cursor-pointer"
        >
          <Pencil size={13} />
        </button>
      )}
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
        <QualityBadge track={track} />
      </div>
      <div className="text-sm text-text-secondary truncate">{formatSampleRate(track.sample_rate)}</div>
      <div className="text-sm text-text-muted tabular-nums text-right">{formatDuration(track.duration_secs)}</div>
    </div>
  );
}
