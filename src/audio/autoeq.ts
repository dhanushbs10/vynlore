/**
 * Parse AutoEQ parametric EQ `.txt` files into Vynlore EQ settings.
 *
 * Expected format (one per line):
 *   Preamp: -1.5 dB
 *   Filter  1: ON  PK  Fc    105 Hz  Gain   -2.0 dB  Q  1.41
 *   Filter  2: ON  PK  Fc    320 Hz  Gain    3.0 dB  Q  2.00
 *   ...
 *
 * Returns parametric bands with per-band Q, or null on parse failure.
 */

export interface AutoEqBand {
  freqHz: number;
  gainDb: number;
  q: number;
}

export interface AutoEqResult {
  preampDb: number;
  bands: AutoEqBand[];
}

const LINE_RE = /^Filter\s+\d+:\s+ON\s+\w+\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+([+-]?[\d.]+)\s*dB\s+Q\s+([\d.]+)/i;
const PREAMP_RE = /^Preamp:\s+([+-]?[\d.]+)\s*dB/i;

export function parseAutoEq(text: string): AutoEqResult | null {
  const lines = text.split(/\r?\n/);
  const bands: AutoEqBand[] = [];
  let preampDb = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const preampMatch = PREAMP_RE.exec(line);
    if (preampMatch) {
      preampDb = parseFloat(preampMatch[1]);
      if (!Number.isFinite(preampDb)) preampDb = 0;
      continue;
    }

    const m = LINE_RE.exec(line);
    if (m) {
      const freqHz = parseFloat(m[1]);
      const gainDb = parseFloat(m[2]);
      const q = parseFloat(m[3]);
      if (!Number.isFinite(freqHz) || !Number.isFinite(gainDb) || !Number.isFinite(q)) continue;
      if (freqHz <= 0 || q <= 0) continue;
      bands.push({ freqHz, gainDb, q });
    }
  }

  if (bands.length === 0) return null;
  return { preampDb, bands };
}

/**
 * Convert AutoEQ bands to Vynlore EQ format.
 * Returns { gains, qs, bandHz } arrays of matching length.
 */
export function autoEqToVynlore(result: AutoEqResult): {
  gains: number[];
  qs: number[];
  bandHz: number[];
} {
  return {
    gains: result.bands.map((b) => b.gainDb),
    qs: result.bands.map((b) => b.q),
    bandHz: result.bands.map((b) => b.freqHz),
  };
}
