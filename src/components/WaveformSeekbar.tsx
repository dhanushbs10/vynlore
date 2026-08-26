import { useEffect, useRef, useState, useMemo } from "react";
import { usePlayer } from "../context/PlayerContext";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { Shuffle, SkipBack, SkipForward, Repeat, Repeat1 } from "lucide-react";

const MAX_POINTS = 80;
const BAR_GAP = 1;

export function WaveformSeekbar() {
  const {
    currentTime, currentTrack, isPlaying, isPaused, seekTime,
    togglePlayPause, toggleShuffle, toggleRepeat, playNext, playPrev,
    isShuffle, repeatMode,
  } = usePlayer();
  const [rawPeaks, setRawPeaks] = useState<number[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const elapsed = currentTime;
  const duration = currentTrack?.duration_secs ?? 0;

  useEffect(() => {
    if (!isTauri() || !currentTrack) return;
    let disposed = false;
    setRawPeaks([]);
    invoke<number[]>("get_waveform", { filePath: currentTrack.file_path })
      .then((peaks) => {
        if (!disposed && peaks && peaks.length > 0) setRawPeaks(peaks);
      })
      .catch((e) => {
        console.error("[Waveform] get_waveform failed:", e);
      });
    return () => { disposed = true; };
  }, [currentTrack?.id, currentTrack?.file_path]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      if (disposed) return;
      const unlisten = listen<{ file_path: string }>("waveform-ready", (event) => {
        const path = event.payload.file_path;
        if (currentTrack?.file_path !== path) return;
        invoke<number[]>("get_waveform", { filePath: path })
          .then((peaks) => {
            if (!disposed && peaks && peaks.length > 0) setRawPeaks(peaks);
          })
          .catch(() => {});
      });
      cleanup = () => { unlisten.then((fn) => fn()); };
    });
    return () => { disposed = true; cleanup?.(); };
  }, [currentTrack?.file_path]);

  const bars = useMemo(() => {
    if (rawPeaks.length === 0) return [];
    if (rawPeaks.length <= MAX_POINTS) return rawPeaks;
    const step = rawPeaks.length / MAX_POINTS;
    return Array.from({ length: MAX_POINTS }, (_, i) => {
      const start = Math.floor(i * step);
      const end = Math.min(Math.floor((i + 1) * step), rawPeaks.length);
      let max = 0;
      for (let j = start; j < end; j++) if (rawPeaks[j] > max) max = rawPeaks[j];
      return max;
    });
  }, [rawPeaks]);

  const currentBarIndex = useMemo(() => {
    if (bars.length === 0 || duration <= 0) return -1;
    return Math.min(bars.length - 1, Math.floor((elapsed / duration) * bars.length));
  }, [bars.length, elapsed, duration]);

  const playheadPct = duration > 0 ? Math.min(100, Math.max(0, (elapsed / duration) * 100)) : 0;

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (duration <= 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTime(pct * duration);
  }

  return (
    <div className="w-full flex flex-col gap-2">
      <div
        ref={containerRef}
        className="relative w-full cursor-pointer"
        style={{ height: 80, minWidth: 200 }}
        onClick={handleClick}
      >
        {/* Bars — flex-1 per bar, fills full width, no padding, no JS width */}
        <div
          className="absolute inset-0 flex items-stretch pointer-events-none z-[1] overflow-hidden"
          style={{ gap: `${BAR_GAP}px` }}
        >
          {bars.map((peak, i) => {
            const h = Math.max(3, peak * 100);
            const played = i <= currentBarIndex;
            return (
              <div key={i} className="flex-1 flex flex-col" style={{ minWidth: 0 }}>
                {/* Top half */}
                <div className="flex-1 flex items-end" style={{ minHeight: 0 }}>
                  <motion.div
                    key={`${currentTrack?.id}-${i}`}
                    className="w-full rounded-t-[1px]"
                    initial={{ height: "0%" }}
                    animate={{ height: `${h}%` }}
                    transition={{ duration: 0.25, delay: i * 0.008, ease: "easeOut" }}
                    style={{
                      backgroundColor: played ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.15)",
                      transition: "background-color 150ms ease-out",
                    }}
                  />
                </div>
                {/* Bottom half */}
                <div className="flex-1 flex items-start" style={{ minHeight: 0 }}>
                  <motion.div
                    key={`${currentTrack?.id}-${i}`}
                    className="w-full rounded-b-[1px]"
                    initial={{ height: "0%" }}
                    animate={{ height: `${h}%` }}
                    transition={{ duration: 0.25, delay: i * 0.008, ease: "easeOut" }}
                    style={{
                      backgroundColor: played ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.1)",
                      transition: "background-color 150ms ease-out",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Playhead — same container as bars, so left% aligns with color boundary */}
        {duration > 0 && (
          <div
            className="absolute top-0 bottom-0 w-[2px] z-[2]"
            style={{
              left: `${playheadPct}%`,
              backgroundColor: "rgba(255,255,255,0.9)",
              boxShadow: "0 0 4px rgba(255,255,255,0.2)",
              transform: "translateX(-1px)",
              transition: "left 100ms linear",
            }}
          />
        )}
      </div>

      {/* Time labels */}
      <div
        className="flex justify-between text-[10px] tabular-nums pointer-events-none z-[5]"
        style={{ color: "rgba(255,255,255,0.4)" }}
      >
        <span>{formatTime(elapsed)}</span>
        <span style={{ marginLeft: "auto" }}>-{formatTime(Math.max(0, duration - elapsed))}</span>
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-4 z-[10]">
        <button
          onClick={toggleShuffle}
          className={`transition-colors ${isShuffle ? "text-white" : "text-[rgba(255,255,255,0.4)] hover:text-white"}`}
          aria-label="Shuffle"
        >
          <Shuffle size={16} />
        </button>
        <button
          onClick={playPrev}
          className="text-[rgba(255,255,255,0.5)] hover:text-white transition-colors"
          aria-label="Previous"
        >
          <SkipBack size={18} />
        </button>
        <button
          onClick={togglePlayPause}
          className="w-9 h-9 flex items-center justify-center rounded-full text-white hover:bg-[rgba(255,255,255,0.1)] transition-colors"
          aria-label={isPlaying && !isPaused ? "Pause" : "Play"}
        >
          {isPlaying && !isPaused ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>
        <button
          onClick={playNext}
          className="text-[rgba(255,255,255,0.5)] hover:text-white transition-colors"
          aria-label="Next"
        >
          <SkipForward size={18} />
        </button>
        <button
          onClick={toggleRepeat}
          className={`relative transition-colors ${repeatMode !== "off" ? "text-white" : "text-[rgba(255,255,255,0.4)] hover:text-white"}`}
          aria-label="Repeat"
        >
          {repeatMode === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
          {repeatMode === "one" && (
            <span className="absolute -top-1 -right-1 text-[8px] font-bold text-white leading-none">1</span>
          )}
        </button>
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
