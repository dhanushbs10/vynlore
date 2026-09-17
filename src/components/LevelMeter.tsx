import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";

interface SpectrumPayload {
  bins: number[];
  peak: number;
  clipped: boolean;
}

/**
 * Output level meter + clip indicator fed by the "spectrum-data" event the
 * backend already emits at ~30fps. The backend reports a true peak (max over
 * channels, decayed) and a clip latch, so this stays passive and cheap.
 */
export function LevelMeter({ className = "" }: { className?: string }) {
  const [level, setLevel] = useState(0);
  const [clipped, setClipped] = useState(false);
  const clipUntilRef = useRef(0);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisten = listen<SpectrumPayload>("spectrum-data", (event) => {
      if (disposed) return;
      const p = event.payload;
      setLevel((prev) => {
        const next = p.peak ?? 0;
        // Smooth up fast, down a hair slower for a natural meter fall.
        return Math.max(0, Math.min(1, next > prev ? next : prev * 0.9 + next * 0.1));
      });
      if (p.clipped) {
        clipUntilRef.current = performance.now() + 800;
        setClipped(true);
      } else if (clipUntilRef.current < performance.now()) {
        setClipped(false);
      }
    });
    return () => {
      disposed = true;
      unlisten.then((fn) => fn());
    };
  }, []);

  const pct = (Math.sqrt(level) * 100).toFixed(1);

  return (
    <div className={`flex flex-col items-center gap-1 w-full ${className}`}>
      <span className="text-[8px] font-bold text-white-40 uppercase tracking-[0.14em]">OUT</span>
      <div className="relative w-full h-2 rounded-sm overflow-hidden bg-white-5">
        <div
          className="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-75"
          style={{
            width: `${pct}%`,
            background:
              level > 0.98
                ? "linear-gradient(to right, var(--color-white) 0%, var(--color-danger) 100%)"
                : "linear-gradient(to right, color-mix(in srgb, var(--color-white) 35%, transparent), var(--color-white))",
          }}
        />
        {/* 0 dB / full-scale marker */}
        <div className="absolute inset-y-0 right-0 w-px bg-white-30" />
      </div>
      <div
        className={`flex items-center gap-1 transition-opacity duration-100 ${clipped ? "opacity-100" : "opacity-25"}`}
        title={clipped ? "Clipping! Lower the volume or preamp." : "Output level"}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: clipped ? "var(--color-danger)" : "var(--color-white)" }} />
        <span className={`text-[7px] font-bold tracking-widest ${clipped ? "text-danger" : "text-white-35"}`}>
          {clipped ? "CLIP" : `${Math.round(level * 100)}%`}
        </span>
      </div>
    </div>
  );
}