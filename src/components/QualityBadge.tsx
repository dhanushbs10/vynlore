import type { Track } from "../types";

const LOSSLESS_FORMATS = new Set(["FLAC", "WAV", "AIFF", "AIF", "DSD", "DFF"]);

export function qualityLabel(track: Pick<Track, "format" | "sample_rate" | "bit_depth" | "bitrate">): string {
  const fmt = (track.format || "").toUpperCase();
  const rate = track.sample_rate >= 1000 ? `${(track.sample_rate / 1000).toFixed(1)}kHz` : `${track.sample_rate}Hz`;
  if (LOSSLESS_FORMATS.has(fmt) && track.bit_depth > 0) {
    return `${fmt} · ${track.bit_depth}-bit ${rate}`;
  }
  const kbps = track.bitrate > 0 ? `${(track.bitrate / 1000).toFixed(0)}kbps` : "";
  return kbps ? `${fmt} ${kbps} · ${rate}` : `${fmt} ${rate}`;
}

export function QualityBadge({ track, className }: { track: Track; className?: string }) {
  const fmt = (track.format || "").toUpperCase();
  const lossless = LOSSLESS_FORMATS.has(fmt);
  return (
    <span
      title={qualityLabel(track)}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border border-border cursor-default ${
        lossless ? "text-accent bg-accent/10 border-accent/20" : "text-text-muted"
      } ${className ?? ""}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${lossless ? "bg-accent" : "bg-white-40"}`} />
      {lossless ? "Lossless" : (fmt || "Audio")}
    </span>
  );
}