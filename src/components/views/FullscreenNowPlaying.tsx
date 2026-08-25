import { useState, useEffect, useRef, useMemo } from "react";
import { usePlayer } from "../../context/PlayerContext";
import { convertFileSrc } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { X, SlidersHorizontal } from "lucide-react";
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
  } = usePlayer();
  const elapsed = currentTime;
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const lineRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const lyrics = useMemo(
    () => parseLyrics(currentTrack?.lyrics || ""),
    [currentTrack?.lyrics]
  );

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
    if (!lyricsOpen || activeIdx < 0) return;
    const timer = requestAnimationFrame(() => {
      lineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(timer);
  }, [lyricsOpen, activeIdx]);

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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[1000] flex flex-col items-center bg-bg overflow-hidden"
    >
      {/* Subtle background gradient */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03)_0%,transparent_70%)]" />

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-6 right-6 z-30 w-10 h-10 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        aria-label="Close fullscreen"
      >
        <X size={20} />
      </button>

      {/* EQ button */}
      <button
        onClick={onOpenEq}
        className="absolute top-6 left-6 z-30 w-10 h-10 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        aria-label="Open equalizer"
        title="Open EQ panel"
      >
        <SlidersHorizontal size={18} />
      </button>


      {/* Center content area */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center w-full max-w-5xl px-8 gap-5">

        {/* Album art */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-[220px] h-[220px] md:w-[280px] md:h-[280px] lg:w-[320px] lg:h-[320px] rounded-2xl overflow-hidden shadow-[0_20px_80px_rgba(0,0,0,0.6),0_0_1px_rgba(255,255,255,0.1)]"
        >
          {coverSrc ? (
            <img className="w-full h-full object-cover" src={coverSrc} alt="" />
          ) : (
            <div className="w-full h-full bg-white/5" />
          )}
        </motion.div>

        {/* Track info */}
        <div className="flex flex-col items-center gap-1 w-full min-w-0 px-4">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-xl md:text-2xl font-bold text-white truncate font-display text-center"
          >
            {currentTrack.title}
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-sm md:text-base text-white/50 truncate text-center"
          >
            {currentTrack.artist}
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="text-xs text-white/30 truncate text-center"
          >
            {currentTrack.album}
          </motion.div>
        </div>

        {/* Waveform seekbar with transport controls overlaid */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="w-full"
        >
          <WaveformSeekbar maxPoints={100} />
        </motion.div>

        {/* Lyrics toggle */}
        <motion.button
          className="relative z-[10] px-5 py-2 rounded-full border border-white/15 text-xs font-semibold uppercase tracking-wider text-white/40 hover:text-white hover:bg-white/5 transition-colors"
          onClick={() => setLyricsOpen((v) => !v)}
          whileTap={{ scale: 0.95 }}
        >
          {lyricsOpen ? "Hide Lyrics" : "Lyrics"}
        </motion.button>
      </div>

      {/* Lyrics overlay */}
      <AnimatePresence>
        {lyricsOpen && (
          <motion.div
            key="lyrics-panel"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.25 }}
            className="absolute bottom-0 left-0 right-0 z-[5] h-[40vh] flex items-end"
          >
            <div className="w-full h-full flex flex-col">
              {/* Spacer to push lyrics toward the bottom while keeping them scrollable */}
              <div className="flex-1 bg-gradient-to-t from-bg/95 via-bg/70 to-transparent pointer-events-none" />
              <div
                ref={scrollContainerRef}
                className="h-[35vh] overflow-y-auto px-8 pb-8 space-y-3 scrollbar-thin scroll-smooth"
              >
                {lyrics.length > 0 ? (
                  lyrics.map((line, i) => {
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
                  })
                ) : (
                  <div className="text-center text-white/30 text-lg">No lyrics found</div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
