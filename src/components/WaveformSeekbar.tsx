import { useEffect, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { SkipBack, SkipForward, Repeat, Shuffle } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { formatDuration } from "../utils/format";

interface Props {
  maxPoints?: number;
}

const SPRING_FRAMES = 8;
const BAR_MIN_HEIGHT = 3;
const BAR_MAX_HEIGHT = 80;
const BAR_GAP = 1;

function sproutFactor(age: number): number {
  if (age >= SPRING_FRAMES) return 1;
  const t = age / SPRING_FRAMES;
  // ease-out cubic
  return 1 - Math.pow(1 - t, 3);
}

interface WaveformPoint {
  value: number;
  age: number;
}

export function WaveformSeekbar({ maxPoints = 100 }: Props) {
  const {
    currentTrack,
    currentTime,
    isPlaying,
    isPaused,
    togglePlayPause,
    playNext,
    playPrev,
    seekTime,
    isShuffle,
    repeatMode,
    toggleShuffle,
    toggleRepeat,
  } = usePlayer();

  const elapsed = currentTime;
  const duration = currentTrack?.duration_secs ?? 0;

  const [points, setPoints] = useState<WaveformPoint[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const pointsRef = useRef<WaveformPoint[]>([]);

  // Keep ref in sync
  pointsRef.current = points;

  useEffect(() => {
    if (!isTauri() || !currentTrack) return;
    let disposed = false;
    const unlisten = listen<{ bins: number[] }>("spectrum-data", (event) => {
      if (disposed) return;
      if (!isPlaying || isPaused) return;
      const bins = event.payload.bins;
      let sum = 0;
      for (let i = 0; i < bins.length; i++) sum += bins[i] * bins[i];
      const rms = Math.sqrt(sum / bins.length);
      setPoints((prev) => {
        // Build new array: age existing points, add new one
        const filtered: WaveformPoint[] = [];
        for (let i = 0; i < prev.length; i++) {
          const aged = prev[i].age + 1;
          if (aged < maxPoints) {
            filtered.push({ value: prev[i].value, age: aged });
          }
        }
        filtered.push({ value: rms, age: 0 });
        // Cap to maxPoints
        if (filtered.length > maxPoints) {
          filtered.splice(0, filtered.length - maxPoints);
        }
        return filtered;
      });
    });
    return () => {
      disposed = true;
      unlisten.then((fn) => fn());
    };
  }, [maxPoints, currentTrack?.id, isPlaying, isPaused]);

  // Clear points when track changes
  useEffect(() => {
    setPoints([]);
  }, [currentTrack?.id]);

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seekTime(ratio * duration);
  };

  if (!currentTrack) return null;

  const barWidth = Math.max(2, Math.min(8, (containerRef.current?.offsetWidth ?? 600) / (maxPoints * 2) - BAR_GAP));

  return (
    <div className="relative w-full select-none" style={{ height: 160 }}>
      {/* Full-width clickable area for seeking */}
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-pointer z-0"
        onClick={handleWaveformClick}
      />

      {/* LEFT HALF — scrolling historical waveform */}
      <div className="absolute left-0 top-0 bottom-0 w-1/2 flex items-center overflow-hidden z-[1]">
        <div
          className="flex items-center h-full px-1"
          style={{ gap: `${BAR_GAP}px` }}
        >
          {points.map((p, i) => {
            const factor = sproutFactor(p.age);
            const h = Math.max(BAR_MIN_HEIGHT, p.value * factor * BAR_MAX_HEIGHT);
            const opacity = 0.4 + Math.min(p.value, 0.6) * 0.6;
            return (
              <div
                key={i}
                className="flex-shrink-0 flex flex-col items-center justify-center"
                style={{
                  width: `${barWidth}px`,
                  height: "100%",
                  gap: "2px",
                }}
              >
                {/* Top half (mirrored) */}
                <div
                  className="flex-1 flex items-end"
                  style={{ minHeight: 0 }}
                >
                  <div
                    className="w-full rounded-t-sm"
                    style={{
                      height: `${h}%`,
                      backgroundColor: `rgba(255,255,255,${opacity})`,
                      transition: "height 60ms linear",
                    }}
                  />
                </div>
                {/* Bottom half */}
                <div
                  className="flex-1 flex items-start"
                  style={{ minHeight: 0 }}
                >
                  <div
                    className="w-full rounded-b-sm"
                    style={{
                      height: `${h}%`,
                      backgroundColor: `rgba(255,255,255,${opacity * 0.85})`,
                      transition: "height 60ms linear",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CENTER — static playhead line */}
      <div className="absolute top-0 bottom-0 w-px bg-white/50 left-1/2 z-[2]" />

      {/* RIGHT HALF — blank (no rendering) */}

      {/* CENTERED TRANSPORT CONTROLS — completely stationary */}
      <div className="absolute inset-0 flex items-center justify-center z-[10] pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <motion.button
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              isShuffle ? "text-accent" : "text-white/35 hover:text-white"
            }`}
            onClick={toggleShuffle}
            whileTap={{ scale: 0.85 }}
            aria-label="Shuffle"
          >
            <Shuffle size={13} />
          </motion.button>

          <motion.button
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/50 hover:text-white transition-colors"
            onClick={playPrev}
            whileTap={{ scale: 0.85 }}
            aria-label="Previous"
          >
            <SkipBack size={16} fill="currentColor" />
          </motion.button>

          <motion.button
            className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-bg shadow-[0_0_24px_rgba(255,255,255,0.15)]"
            onClick={togglePlayPause}
            whileTap={{ scale: 0.9 }}
          >
            {isPlaying && !isPaused ? (
              <div className="flex items-center gap-[3px]">
                <div className="w-[3px] h-[14px] bg-bg rounded-sm" />
                <div className="w-[3px] h-[14px] bg-bg rounded-sm" />
              </div>
            ) : (
              <div className="w-0 h-0 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent border-l-[12px] border-l-bg ml-0.5" />
            )}
          </motion.button>

          <motion.button
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/50 hover:text-white transition-colors"
            onClick={playNext}
            whileTap={{ scale: 0.85 }}
            aria-label="Next"
          >
            <SkipForward size={16} fill="currentColor" />
          </motion.button>

          <motion.button
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              repeatMode !== "off"
                ? "text-accent"
                : "text-white/35 hover:text-white"
            }`}
            onClick={toggleRepeat}
            whileTap={{ scale: 0.85 }}
            aria-label="Repeat"
          >
            <Repeat size={13} />
            {repeatMode === "one" && (
              <span className="absolute text-[6px] font-bold text-accent">
                1
              </span>
            )}
          </motion.button>
        </div>
      </div>

      {/* TIME LABELS */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[11px] text-white/35 tabular-nums px-1 pointer-events-none z-[5]">
        <span>{formatDuration(elapsed)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  );
}
