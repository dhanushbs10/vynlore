import { useEffect, useRef, useMemo, useState } from "react";
import { usePlayer } from "../../context/PlayerContext";
import { convertFileSrc } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { X, SlidersHorizontal, CloudDownload, Pencil } from "lucide-react";
import { hasCover } from "../../utils/format";
import { WaveformSeekbar } from "../WaveformSeekbar";
import { QualityBadge } from "../QualityBadge";
import { fetchOnlineLyrics } from "../../audio/lyrics";
import type { Track } from "../../types";

interface LyricsLine {
  time: number;
  text: string;
}

function parseLyrics(lyricsText: string): LyricsLine[] {
  if (!lyricsText.trim()) return [];

  const lines: LyricsLine[] = [];
  // Accept 1–2 digit minutes/seconds and 0–3 digit fractions, plus repeated
  // timestamps on one line ("[00:12.34][00:15.00]text" hits both).
  const tagRe = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of lyricsText.split("\n")) {
    tagRe.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = tagRe.exec(rawLine)) !== null) {
      const minutes = parseInt(m[1], 10);
      const seconds = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
      if (Number.isFinite(minutes) && Number.isFinite(seconds) && seconds < 60) {
        stamps.push(minutes * 60 + seconds + ms / 1000);
      }
      lastEnd = m.index + m[0].length;
    }
    if (stamps.length === 0) continue;
    const text = rawLine.slice(lastEnd).trim();
    if (!text) continue;
    for (const time of stamps) {
      lines.push({ time, text });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

export function FullscreenNowPlaying({ onClose, onOpenEq, onEditTrack }: { onClose: () => void; onOpenEq: () => void; onEditTrack?: (track: Track) => void }) {
  const {
    currentTrack,
    currentTime,
    seekTime,
  } = usePlayer();
  const elapsed = currentTime;
  const lineRef = useRef<HTMLDivElement>(null);

  const lyrics = useMemo(
    () => parseLyrics(currentTrack?.lyrics || ""),
    [currentTrack?.lyrics]
  );

  const [onlineLyrics, setOnlineLyrics] = useState<{ synced?: string; plain?: string } | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<"idle" | "loading" | "done" | "none">("idle");

  const embeddedLyrics = currentTrack?.lyrics || "";
  const embeddedTextExists = embeddedLyrics.trim().length > 0;

  useEffect(() => {
    if (!currentTrack) return;
    setOnlineLyrics(null);
    if (lyrics.length > 0) {
      setLyricsStatus("done");
      return;
    }
    setLyricsStatus("loading");
    let active = true;
    void fetchOnlineLyrics(currentTrack).then((res) => {
      if (!active) return;
      setOnlineLyrics(res);
      if (res) setLyricsStatus("done");
      else setLyricsStatus(embeddedTextExists ? "done" : "none");
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentTrack?.file_path, lyrics.length]);

  // For unsynced plain text (embedded or online), derive an approximate sync by
  // spacing each non-empty line across the track duration, weighted by line length.
  const pseudoSynced = useMemo(() => {
    const plain = onlineLyrics?.plain?.trim() || embeddedLyrics.trim();
    const dur = currentTrack?.duration_secs || 0;
    if (!plain || dur < 5) return [];
    const lines = plain.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const weights = lines.map((l) => Math.max(l.length, 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const span = dur * 0.93;
    let acc = 0;
    return lines.map((text, i) => {
      const time = (acc / total) * span;
      acc += weights[i];
      return { time, text };
    });
  }, [onlineLyrics?.plain, embeddedLyrics, currentTrack?.duration_secs]);

  const mergedSynced = useMemo(
    () => (onlineLyrics?.synced ? parseLyrics(onlineLyrics.synced) : lyrics.length > 0 ? lyrics : pseudoSynced),
    [onlineLyrics?.synced, lyrics, pseudoSynced]
  );
  const pseudoActive = mergedSynced.length > 0 && lyrics.length === 0 && !onlineLyrics?.synced;
  const plainText = mergedSynced.length === 0 ? (onlineLyrics?.plain?.trim() || embeddedLyrics.trim()) : "";
  const hasLyrics = mergedSynced.length > 0 || plainText.length > 0;
  const lyricsSourceOnline = mergedSynced.length > 0 && onlineLyrics?.synced ? true : false;

  // Find active line index without allocating a new array every render
  let activeIdx = -1;
  for (let i = mergedSynced.length - 1; i >= 0; i--) {
    if (mergedSynced[i].time <= elapsed) {
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
        className="w-[220px] h-[220px] md:w-[280px] md:h-[280px] lg:w-[320px] lg:h-[320px] rounded-2xl overflow-hidden shrink-0 shadow-2xl ring-1 ring-white/10"
      >
        {coverSrc ? (
          <img className="w-full h-full object-cover" src={coverSrc} alt="" />
        ) : (
          <div className="w-full h-full bg-white-5" />
        )}
      </div>

      <div className="flex flex-col items-center gap-1 w-full min-w-0 px-4">
        <div className="text-xl md:text-2xl lg:text-3xl font-bold text-white truncate font-display text-center">
          {currentTrack.title}
        </div>
        <div className="text-sm md:text-base text-white-50 truncate text-center">
          {currentTrack.artist}
        </div>
        <div className="text-xs text-white-30 truncate text-center">
          {currentTrack.album}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <QualityBadge track={currentTrack} />
          {onEditTrack && (
            <button
              onClick={() => onEditTrack(currentTrack)}
              title="Edit tags…"
              aria-label="Edit tags"
              className="w-6 h-6 flex items-center justify-center rounded-md text-white-40 hover:text-white hover:bg-white-10 transition-colors cursor-pointer"
            >
              <Pencil size={12} />
            </button>
          )}
        </div>
      </div>
    </>
  );

  // ── Lyrics column ────────────────────────────────────────────────
  const lyricsColumn = (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-center gap-1.5 mb-3 shrink-0">
        {lyricsStatus === "loading" ? (
          <span className="text-xs text-white-30 animate-pulse">Looking up lyrics…</span>
        ) : !hasLyrics ? (
          <span className="text-xs text-white-30">
            {lyricsStatus === "none"
              ? "No lyrics found — not embedded and unavailable online"
              : "No lyrics available"}
          </span>
        ) : null}
      </div>
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center w-full">
        <div className="h-[calc(17rem+5px)] w-full max-w-[calc(32rem+5px)] overflow-y-auto space-y-3 px-6 py-2 scrollbar-thin scroll-smooth [mask-image:linear-gradient(to_bottom,transparent,black_15%,black_85%,transparent)]">
{mergedSynced.map((line, i) => {
            const isActive = i === activeIdx;
            const dist = Math.abs(i - activeIdx);
            return (
              <div
                key={i}
                ref={isActive ? lineRef : undefined}
                data-active={isActive}
                className={`text-center leading-snug cursor-pointer select-none transition-all duration-500 ${
                  dist === 0
                    ? "text-xl md:text-2xl font-semibold text-white"
                    : dist === 1
                      ? "text-base md:text-lg text-white-45"
                      : dist === 2
                        ? "text-sm md:text-base text-white-30"
                        : "text-sm text-white-20 hover:text-white-40"
                }`}
                onClick={() => handleSeekToLine(line.time)}
              >
                {line.text}
              </div>
            );
          })}
        {mergedSynced.length === 0 && plainText && (
          <div className="text-center text-white-40 text-base leading-relaxed whitespace-pre-line">
            {plainText}
          </div>
        )}
        {mergedSynced.length === 0 && !plainText && lyricsStatus === "idle" && (
          <div className="text-center text-white-30 text-lg">No lyrics found</div>
        )}
        </div>
        <div className="shrink-0 mt-2 pb-1 flex items-center justify-center gap-1.5">
          {hasLyrics ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white-5 border border-white-10 text-[10px] font-semibold tracking-[0.12em] uppercase text-white-40">
              {lyricsSourceOnline ? <CloudDownload size={10} /> : null}
              {lyricsSourceOnline ? "Lyrics · online" : embeddedTextExists ? "Lyrics · embedded" : "Lyrics"}
              {pseudoActive ? <span className="opacity-70 normal-case tracking-normal ml-1">(approx sync)</span> : null}
            </span>
          ) : null}
        </div>
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
      {/* ── Immersive backdrop: blurred album art under a skin-tinted veil ── */}
      {coverSrc ? (
        <div className="absolute inset-0 overflow-hidden">
          <img
            src={coverSrc}
            alt=""
            className="w-full h-full object-cover blur-2xl scale-110 opacity-70"
          />
          <div className="absolute inset-0 bg-bg/70" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/60" />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-bg-surface via-bg to-bg">
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at 50% 42%, color-mix(in oklab, var(--color-accent) 22%, transparent), transparent 68%)",
            }}
          />
        </div>
      )}

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-6 right-6 z-30 w-10 h-10 rounded-full flex items-center justify-center text-white-40 hover:text-white hover:bg-white-10 transition-colors cursor-pointer"
        aria-label="Close fullscreen"
      >
        <X size={20} />
      </button>

      {/* EQ button */}
      <button
        onClick={onOpenEq}
        className="absolute top-6 left-6 z-30 w-10 h-10 rounded-full flex items-center justify-center text-white-40 hover:text-white hover:bg-white-10 transition-colors cursor-pointer"
        aria-label="Open equalizer"
        title="Open EQ panel"
      >
        <SlidersHorizontal size={18} />
      </button>

      {hasLyrics || lyricsStatus === "loading" ? (
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
