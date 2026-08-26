import { useEffect, useRef, useMemo } from "react";
import { usePlayer } from "../../context/PlayerContext";
import { convertFileSrc } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { X, SlidersHorizontal, Volume2 } from "lucide-react";
import { hasCover } from "../../utils/format";
import { WaveformSeekbar } from "../WaveformSeekbar";

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
    const milliseconds = match[3] ? parseInt(match[3].padEnd(3, "0"), 10) : 0;
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

export function FullscreenNowPlaying({ onClose, onOpenEq }: { onClose: () => void; onOpenEq: () => void }) {
  const {
    currentTrack,
    currentTime,
    seekTime,
    volume,
    setVolume,
  } = usePlayer();
  const elapsed = currentTime;
  const lineRef = useRef<HTMLDivElement>(null);

  const lyrics = useMemo(
    () => parseLyrics(currentTrack?.lyrics || ""),
    [currentTrack?.lyrics]
  );

  const hasLyrics = lyrics.length > 0;

  // Find active line index without allocating a new array every render
  let activeIdx = -1;
  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (lyrics[i].time <= elapsed) {
      activeIdx = i;
      break;
    }
  }

  // Scroll active line into view with a short delay to ensure DOM has updated
  useEffect(() => {
    if (!hasLyrics || activeIdx < 0) return;
    const timer = requestAnimationFrame(() => {
      lineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(timer);
  }, [hasLyrics, activeIdx]);

  const handleSeekToLine = (time: number) => {
    seekTime(time);
  };

  if (!currentTrack) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[1000] flex items-center justify-center bg-bg"
      >
        <button
          onClick={onClose}
          className="absolute top-6 right-6 w-10 h-10 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-hover transition-colors cursor-pointer"
        >
          <X size={20} />
        </button>
        <div className="text-lg text-text-muted">Nothing is playing</div>
      </motion.div>
    );
  }

  const coverSrc = hasCover(currentTrack)
    ? convertFileSrc(currentTrack.cover_path!)
    : undefined;

  // ── Album art + info block (shared by both layouts) ──────────────
  const artAndInfo = (
    <>
      <div
        className="w-[220px] h-[220px] md:w-[280px] md:h-[280px] lg:w-[320px] lg:h-[320px] rounded-lg overflow-hidden shrink-0"
      >
        {coverSrc ? (
          <img className="w-full h-full object-cover" src={coverSrc} alt="" />
        ) : (
          <div className="w-full h-full bg-white/5" />
        )}
      </div>

      <div className="flex flex-col items-center gap-1 w-full min-w-0 px-4">
        <div className="text-xl md:text-2xl font-bold text-white truncate font-display text-center">
          {currentTrack.title}
        </div>
        <div className="text-sm md:text-base text-white/50 truncate text-center">
          {currentTrack.artist}
        </div>
        <div className="text-xs text-white/30 truncate text-center">
          {currentTrack.album}
        </div>
      </div>
    </>
  );

  // ── Lyrics column ────────────────────────────────────────────────
  const lyricsColumn = (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="flex-1 overflow-y-auto px-6 pb-8 space-y-3 scrollbar-thin scroll-smooth"
      >
        {lyrics.map((line, i) => {
          const isActive = i === activeIdx;
          const isPast = i < activeIdx;
          return (
            <div
              key={i}
              ref={isActive ? lineRef : undefined}
              data-active={isActive}
              className={`text-center text-lg cursor-pointer transition-all duration-300 ${
                isActive
                  ? "text-white font-bold text-xl"
                  : isPast
                    ? "text-white/20"
                    : "text-white/35 hover:text-white/60"
              }`}
              onClick={() => handleSeekToLine(line.time)}
            >
              {line.text}
            </div>
          );
        })}
        {lyrics.length === 0 && (
          <div className="text-center text-white/30 text-lg">No lyrics found</div>
        )}
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[1000] flex flex-col items-center bg-bg overflow-hidden"
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-6 right-6 z-30 w-10 h-10 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        aria-label="Close fullscreen"
      >
        <X size={20} />
      </button>

      {/* Volume control */}
      <div className="absolute top-6 right-20 z-30 flex items-center gap-2">
        <Volume2 size={16} className="text-white/40" />
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          className="w-24 volume-slider"
          aria-label="Volume"
        />
        <span className="text-[10px] text-white/40 tabular-nums w-[28px] text-right">{Math.round(volume * 100)}%</span>
      </div>

      {/* EQ button */}
      <button
        onClick={onOpenEq}
        className="absolute top-6 left-6 z-30 w-10 h-10 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        aria-label="Open equalizer"
        title="Open EQ panel"
      >
        <SlidersHorizontal size={18} />
      </button>

      {hasLyrics ? (
        /* ── Two-column layout: art+controls | lyrics ───────────── */
        <div className="relative z-10 flex-1 flex w-full max-w-6xl px-8 py-16 gap-8 min-h-0">
          {/* LEFT: art + track info + waveform + transport */}
          <div className="flex flex-col items-center justify-center gap-5 w-1/2 min-w-0">
            {artAndInfo}
            <div className="w-full">
              <WaveformSeekbar />
            </div>
          </div>

          {/* RIGHT: lyrics inline column */}
          <div className="flex-1 flex flex-col justify-center min-h-0">
            {lyricsColumn}
          </div>
        </div>
      ) : (
        /* ── Single centered column (no lyrics) ─────────────────── */
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center w-full max-w-5xl px-8 gap-5">
          {artAndInfo}
          <div className="w-full">
              <WaveformSeekbar />
            </div>
        </div>
      )}
    </motion.div>
  );
}
