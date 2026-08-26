import { useMemo, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft, Play, Shuffle, Repeat, Repeat1 } from "lucide-react";
import { motion } from "framer-motion";
import { parseArtists } from "../../utils/artists";
import { usePlayer } from "../../context/PlayerContext";
import { formatDuration, hasCover } from "../../utils/format";
import { fisherYates } from "../../utils/shuffle";
import type { Track } from "../../types";

interface ArtistDetailViewProps {
  artist: string;
  tracks: Track[];
  onBack: () => void;
  playTrack: (track: Track, queue?: Track[]) => void;
}

export function ArtistDetailView({ artist, tracks, onBack, playTrack }: ArtistDetailViewProps) {
  const { currentTrack, isShuffle, toggleShuffle, repeatMode, toggleRepeat } = usePlayer();

  const artistTracks = useMemo(
    () => tracks.filter((t) => parseArtists(t.artist).includes(artist)),
    [tracks, artist]
  );

  const groupedAlbums = useMemo(() => {
    const map = new Map<string, Track[]>();
    const sorted = [...artistTracks].sort((a, b) => {
      const albumCmp = a.album.localeCompare(b.album);
      if (albumCmp !== 0) return albumCmp;
      return (a.track_number ?? 0) - (b.track_number ?? 0);
    });
    sorted.forEach((track) => {
      const album = track.album || "Unknown Album";
      if (!map.has(album)) map.set(album, []);
      map.get(album)!.push(track);
    });
    return Array.from(map.entries()).map(([album, tracks]) => ({ album, tracks }));
  }, [artistTracks]);

  const coverSrc = hasCover(artistTracks[0])
    ? convertFileSrc(artistTracks[0].cover_path!)
    : undefined;

  const totalDuration = artistTracks.reduce((acc, t) => acc + t.duration_secs, 0);
  const albumCount = groupedAlbums.length;

  const handlePlayArtist = useCallback(async () => {
    if (artistTracks.length === 0) return;
    await playTrack(artistTracks[0], artistTracks);
  }, [artistTracks, playTrack]);

  const handleShuffle = useCallback(async () => {
    if (artistTracks.length === 0) return;
    const shuffled = fisherYates(artistTracks);
    if (!isShuffle) {
      toggleShuffle();
    }
    await playTrack(shuffled[0], shuffled);
  }, [artistTracks, isShuffle, toggleShuffle, playTrack]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className="flex items-center gap-4 mb-7">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text transition-colors" aria-label="Back to artists">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold text-text tracking-tight">{artist}</h1>
          <p className="text-sm text-text-secondary mt-1">
            {artistTracks.length} tracks · {albumCount} albums · {formatDuration(totalDuration)}
          </p>
        </div>
      </div>

      <div className="flex gap-8 mb-8 items-start flex-wrap">
        <div className="shrink-0">
          {coverSrc ? (
            <img
              src={coverSrc}
              alt={artist}
              className="w-[220px] h-[220px] rounded-md object-cover"
            />
          ) : (
            <div className="w-[220px] h-[220px] rounded-md bg-bg-surface" />
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="text-[22px] font-bold text-text">{artist}</div>
          <div className="flex gap-2.5">
            <motion.button
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-transparent text-text-secondary text-xs font-semibold hover:bg-white/5 hover:text-text transition-colors w-auto"
              onClick={handleShuffle}
              whileTap={{ scale: 0.95 }}
              aria-label="Shuffle artist"
            >
              <Shuffle size={15} />
              <span>Shuffle</span>
            </motion.button>
            <motion.button
              className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center transition-transform"
              onClick={handlePlayArtist}
              whileTap={{ scale: 0.95 }}
              aria-label="Play artist"
            >
              <Play size={18} fill="currentColor" />
            </motion.button>
            <button
              className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border-none bg-transparent p-0 cursor-pointer transition-colors ${repeatMode === "off" ? "text-text-muted" : "text-white"}`}
              aria-label="Repeat"
              onClick={toggleRepeat}
            >
              {repeatMode === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
            </button>
          </div>
        </div>
      </div>

      <div>
        {groupedAlbums.map(({ album, tracks: albumTracks }) => {
          const albumCover = hasCover(albumTracks[0])
            ? convertFileSrc(albumTracks[0].cover_path!)
            : undefined;

          return (
            <div key={album} className="mb-8">
              <div className="flex items-center gap-4 mb-3.5 border-b border-border pb-2.5">
                {albumCover ? (
                  <img
                    src={albumCover}
                    alt={album}
                    className="w-[52px] h-[52px] rounded-md object-cover"
                  />
                ) : (
                  <div className="w-[52px] h-[52px] rounded-md bg-bg-surface shrink-0" />
                )}
                <div className="text-lg font-bold text-text">{album}</div>
              </div>

              <div>
                <div className="grid grid-cols-[48px_40px_1fr_70px] items-center gap-2.5 px-3 py-2 text-xs font-medium text-text-muted uppercase tracking-wider">
                  <div />
                  <div>#</div>
                  <div>Title</div>
                  <div className="text-right">Time</div>
                </div>
                {albumTracks.length === 0 ? (
                  <div className="text-center py-16 text-text-muted">
                    <div className="text-sm text-text-secondary">No tracks found for this album.</div>
                  </div>
                ) : (
                  albumTracks.map((track, idx) => {
                    const active = currentTrack && track.id === currentTrack.id;
                    const trackCover = hasCover(track)
                      ? convertFileSrc(track.cover_path!)
                      : undefined;
                    return (
                      <div
                        key={track.id}
                        className={`grid grid-cols-[48px_40px_1fr_70px] items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-white/5 transition-colors ${active ? "bg-white/5" : ""}`}
                        onClick={() => playTrack(track, artistTracks)}
                      >
                        <div className="w-12">
                          {trackCover ? (
                            <img className="w-10 h-10 rounded-md object-cover" src={trackCover} alt="" />
                          ) : (
                            <div className="w-10 h-10 rounded-md bg-bg-surface" />
                          )}
                        </div>
                        <div className="text-sm text-text-secondary text-center">
                          {active ? <span className="eq-bars" /> : idx + 1}
                        </div>
                        <div className="text-sm font-medium text-text truncate">{track.title}</div>
                        <div className="text-sm text-text-muted tabular-nums text-right">{formatDuration(track.duration_secs)}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
