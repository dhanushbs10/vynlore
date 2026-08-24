import { useState, useEffect, useRef } from "react";
import { usePlayer } from "../../context/PlayerContext";
import { convertFileSrc } from "@tauri-apps/api/core";
import { SkipBack, SkipForward } from "lucide-react";

interface LyricsLine {
  time: number;
  text: string;
}

function parseLyrics(lyricsText: string): LyricsLine[] {
  if (!lyricsText.trim()) return [];
  
  const lines: LyricsLine[] = [];
  const regex = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\](.*)/g;
  let match;
  
  while ((match = regex.exec(lyricsText)) !== null) {
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
    const text = match[4].trim();
    
    if (text) {
      lines.push({
        time: minutes * 60 + seconds + milliseconds / 1000,
        text,
      });
    }
  }
  
  return lines.sort((a, b) => a.time - b.time);
}

export function FullscreenNowPlaying({ onClose }: { onClose: () => void }) {
  const {
    currentTrack,
    isPlaying,
    isPaused,
    currentTime,
    togglePlayPause,
    playNext,
    playPrev,
    seekTime,
  } = usePlayer();
  const elapsed = currentTime;
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const lineRef = useRef<HTMLDivElement>(null);
  
  const lyricsText = currentTrack?.lyrics || "";
  const parsedLyrics = useRef<LyricsLine[]>(parseLyrics(lyricsText));
  const lyrics = parsedLyrics.current;
  
  const activeIdx = lyrics.length > 0
    ? lyrics.filter((l) => l.time <= elapsed).length - 1
    : -1;

  useEffect(() => {
    if (!lyricsOpen || !lineRef.current) return;
    lineRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [lyricsOpen, activeIdx]);

  const handleSeekToLine = (time: number) => {
    seekTime(time);
  };

  if (!currentTrack) {
    return (
      <div className="fnow-empty">
        <div className="fnow-close" onClick={onClose}>
          ✕
        </div>
        <div className="fnow-empty-text">Nothing is playing</div>
      </div>
    );
  }

  const pct = currentTrack.duration_secs
    ? Math.min((elapsed / currentTrack.duration_secs) * 100, 100)
    : 0;
  const coverSrc = currentTrack.cover_path
    ? convertFileSrc(currentTrack.cover_path)
    : undefined;

  return (
    <div className="fnow">
      <div className="fnow-bg" />
      <div className="fnow-close" onClick={onClose}>
        ✕
      </div>

      <div className="fnow-top">
        <div className="fnow-art">
          {coverSrc ? (
            <img className="fnow-art-img" src={coverSrc} alt="" />
          ) : (
            <div className="fnow-art-inner" />
          )}
        </div>

        <div className="fnow-track-info">
          <div className="fnow-title">{currentTrack.title}</div>
          <div className="fnow-artist">{currentTrack.artist}</div>
          <div className="fnow-album">{currentTrack.album}</div>
        </div>
      </div>

      <div className="fnow-center">
        {lyricsOpen ? (
          lyrics.length > 0 ? (
            <div className="fnow-lyrics">
              {lyrics.map((line, i) => {
                const isActive = i === activeIdx;
                const isPast = i < activeIdx;
                return (
                  <div
                    key={i}
                    ref={isActive ? lineRef : undefined}
                    className={`fnow-line ${isActive ? "active" : isPast ? "dim" : ""}`}
                    onClick={() => handleSeekToLine(line.time)}
                    style={{ cursor: "pointer" }}
                  >
                    {line.text}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="fnow-empty-text">No lyrics found</div>
          )
        ) : (
          <div className="fnow-seek">
            <span className="fnow-time">
              {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")}
            </span>
            <div className="fnow-track">
              <div className="fnow-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="fnow-time">
              {Math.floor(currentTrack.duration_secs / 60)}:
              {String(Math.floor(currentTrack.duration_secs % 60)).padStart(2, "0")}
            </span>
          </div>
        )}
      </div>

      <div className="fnow-controls">
        <button className="fnow-ctrl" onClick={playPrev} aria-label="Previous">
          <SkipBack size={20} />
        </button>
        <button className="fnow-play" onClick={togglePlayPause}>
          {isPlaying && !isPaused ? "❚❚" : "▶"}
        </button>
        <button className="fnow-ctrl" onClick={playNext} aria-label="Next">
          <SkipForward size={20} />
        </button>
        <button
          className="fnow-ctrl"
          onClick={() => setLyricsOpen((v) => !v)}
        >
          {lyricsOpen ? "HIDE LYRICS" : "LYRICS"}
        </button>
      </div>
    </div>
  );
}
