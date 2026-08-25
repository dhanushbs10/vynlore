import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";

interface SpectrumPayload { bins: number[]; }

interface Props {
  bars?: number;
  className?: string;
}

function smoothBins(raw: number[], target: number): number[] {
  if (raw.length === target) return raw;
  const result: number[] = [];
  const binSize = raw.length / target;
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * binSize);
    const end = Math.min(Math.ceil((i + 1) * binSize), raw.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += raw[j];
    result.push(sum / (end - start));
  }
  return result;
}

export function SpectrumBars({ bars = 64, className = "" }: Props) {
  const [bins, setBins] = useState<number[]>(() => new Array(bars).fill(0));
  const smoothRef = useRef<number[]>(new Array(bars).fill(0));

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisten = listen<SpectrumPayload>("spectrum-data", (event) => {
      if (disposed) return;
      const smoothed = smoothBins(event.payload.bins, bars);
      for (let i = 0; i < bars; i++) {
        smoothRef.current[i] = smoothRef.current[i] * 0.55 + smoothed[i] * 0.45;
      }
      setBins([...smoothRef.current]);
    });
    return () => {
      disposed = true;
      unlisten.then((fn) => fn());
    };
  }, [bars]);

  return (
    <div className={`flex items-end justify-center gap-[2px] w-full h-full ${className}`}>
      {bins.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm min-w-[2px] max-w-[6px]"
          style={{
            height: `${Math.max(3, v * 100)}%`,
            backgroundColor: `rgba(255, 255, 255, ${0.15 + v * 0.75})`,
            transition: "height 50ms ease-out",
          }}
        />
      ))}
    </div>
  );
}
