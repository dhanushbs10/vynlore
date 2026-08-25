export function formatDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "0:00";
  const total = Math.floor(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toString().padStart(2, "0");
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s}`;
  return `${m}:${s}`;
}

export function formatSampleRate(sampleRate: number): string {
  if (!sampleRate) return "— Hz";
  return sampleRate >= 1000
    ? `${(sampleRate / 1000).toFixed(1)} kHz`
    : `${sampleRate} Hz`;
}

export function hasCover(track: { cover_path?: string | null }): boolean {
  return typeof track.cover_path === "string" && track.cover_path.length > 2;
}
