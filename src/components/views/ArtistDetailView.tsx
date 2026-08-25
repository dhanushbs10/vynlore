import { useMemo, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft, Play, Shuffle } from "lucide-react";
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
  const { currentTrack } = usePlayer();
  const { isShuffle, toggleShuffle } = usePlayer();

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
    <div>
      <div className="view-header" style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
        <button className="ctrl-btn" onClick={onBack} aria-label="Back to artists">
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="view-title">{artist}</div>
          <div className="view-subtitle">
            {artistTracks.length} tracks · {albumCount} albums · {formatDuration(totalDuration)}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 32, marginBottom: 32, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flexShrink: 0 }}>
          {coverSrc ? (
            <img
              src={coverSrc}
              alt={artist}
              style={{
                width: 220,
                height: 220,
                borderRadius: 12,
                objectFit: "cover",
                boxShadow: "0 16px 48px rgba(0,0,0,0.45)",
              }}
            />
          ) : (
            <div
              style={{
                width: 220,
                height: 220,
                borderRadius: 12,
                background: "linear-gradient(145deg, #1c1f2b 0%, #252a38 100%)",
                boxShadow: "0 16px 48px rgba(0,0,0,0.45)",
              }}
            />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>{artist}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="ctrl-btn"
              onClick={handleShuffle}
              aria-label="Shuffle artist"
              style={{ padding: "0 12px", gap: 8, width: "auto" }}
            >
              <Shuffle size={15} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Shuffle</span>
            </button>
            <button
              className="play-btn"
              onClick={handlePlayArtist}
              style={{ width: 44, height: 44, background: "#d4a373", color: "#0c0d12" }}
              aria-label="Play artist"
            >
              <Play size={18} fill="#0c0d12" />
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
            <div key={album} style={{ marginBottom: 32 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  marginBottom: 14,
                  borderBottom: "1px solid var(--border-subtle)",
                  paddingBottom: 10,
                }}
              >
                {albumCover ? (
                  <img
                    src={albumCover}
                    alt={album}
                    style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover", boxShadow: "0 8px 20px rgba(0,0,0,0.35)" }}
                  />
                ) : (
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 8,
                      background: "var(--bg-raised)",
                      flexShrink: 0,
                    }}
                  />
                )}
                <div className="view-title" style={{ fontSize: 18, marginBottom: 0 }}>
                  {album}
                </div>
              </div>

              <div className="tracks-table">
                <div className="tracks-row track-header">
                  <div className="track-cell" style={{ width: 48 }} />
                  <div className="track-cell">#</div>
                  <div className="track-cell">Title</div>
                  <div className="track-cell time-cell">TIME</div>
                </div>
                {albumTracks.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-text">No tracks found for this album.</div>
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
                        className={`tracks-row ${active ? "track-active" : ""}`}
                        onClick={() => playTrack(track, artistTracks)}
                      >
                        <div className="track-cell" style={{ width: 48 }}>
                          {trackCover ? (
                            <img className="track-thumb" src={trackCover} alt="" />
                          ) : (
                            <div className="track-thumb-empty" />
                          )}
                        </div>
                        <div className="track-cell track-num">
                          {active ? <span className="equalizer" /> : idx + 1}
                        </div>
                        <div className="track-cell track-title">{track.title}</div>
                        <div className="track-cell time-cell">{formatDuration(track.duration_secs)}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
