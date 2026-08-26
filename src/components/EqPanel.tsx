import React, { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Power, Sparkles,
  SlidersHorizontal, Download, RotateCcw, Zap,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { usePlayer } from "../context/PlayerContext";
import {
  EQ_MAX_GAIN,
  EQ_MAX_BOOST,
  EQ_PRESETS,
  BAND_COUNT_PRESETS,
} from "../audio/eqPresets";
import { parseAutoEq, autoEqToVynlore } from "../audio/autoeq";

interface EqPanelProps {
  open: boolean;
  onClose: () => void;
}

function bandLabel(hz: number): string {
  if (hz >= 10000) return `${Math.round(hz / 1000)}k`;
  if (hz >= 1000) return `${(hz / 1000).toFixed(1)}k`;
  return String(Math.round(hz));
}

function gainLabel(gain: number): string {
  if (Math.abs(gain) < 0.05) return "0";
  return `${gain > 0 ? "+" : ""}${gain.toFixed(1)}`;
}

function balanceLabel(bal: number): string {
  if (Math.abs(bal) < 0.01) return "C";
  return bal < 0 ? `L${Math.abs(bal * 100).toFixed(0)}` : `R${(bal * 100).toFixed(0)}`;
}

const PREAMP_KEY = "vynlore.preamp";
const BALANCE_KEY = "vynlore.balance";

function loadNumber(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  } catch { /* ignore */ }
  return fallback;
}

/* ═══════════════════════════════════════════════════════
   SVG curve helpers
   ═══════════════════════════════════════════════════════ */

function eqCurvePath(gains: number[], bandHz: number[], w: number, h: number): string {
  const pad = 4;
  const pH = h - pad * 2;
  const pW = w - pad * 2;
  const logMin = Math.log10(20);
  const logMax = Math.log10(20000);
  const pts: [number, number][] = gains.map((g, i) => {
    const hz = bandHz[i] ?? 1000;
    const logHz = Math.log10(Math.max(20, Math.min(20000, hz)));
    const fx = (logHz - logMin) / (logMax - logMin);
    return [pad + fx * pW, pad + pH / 2 - (g / EQ_MAX_GAIN) * (pH / 2)];
  });
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const cpx = (pts[i - 1][0] + pts[i][0]) / 2;
    d += ` C ${cpx} ${pts[i - 1][1]}, ${cpx} ${pts[i][1]}, ${pts[i][0]} ${pts[i][1]}`;
  }
  return d;
}

function eqCurveFill(gains: number[], bandHz: number[], w: number, h: number): string {
  const pad = 4;
  const pH = h - pad * 2;
  const pW = w - pad * 2;
  const logMin = Math.log10(20);
  const logMax = Math.log10(20000);
  const pts: [number, number][] = gains.map((g, i) => {
    const hz = bandHz[i] ?? 1000;
    const logHz = Math.log10(Math.max(20, Math.min(20000, hz)));
    const fx = (logHz - logMin) / (logMax - logMin);
    return [pad + fx * pW, pad + pH / 2 - (g / EQ_MAX_GAIN) * (pH / 2)];
  });
  if (pts.length < 2) return "";
  const midY = pad + pH / 2;
  let d = `M ${pts[0][0]} ${midY} L ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const cpx = (pts[i - 1][0] + pts[i][0]) / 2;
    d += ` C ${cpx} ${pts[i - 1][1]}, ${cpx} ${pts[i][1]}, ${pts[i][0]} ${pts[i][1]}`;
  }
  d += ` L ${pts[pts.length - 1][0]} ${midY} Z`;
  return d;
}

/* ═══════════════════════════════════════════════════════
   Custom vertical fader (mouse-drag based, no native issues)
   ═══════════════════════════════════════════════════════ */

interface VFaderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  color?: string;
  width?: number;
  height?: number;
}

const VFader: React.FC<VFaderProps> = ({
  value, min, max, step = 0.5, onChange, disabled, color, width = 18, height = 160,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pct = max === min ? 50 : ((value - min) / (max - min)) * 100;
  const clampedPct = Math.max(0, Math.min(100, pct));

  const computeValue = useCallback((clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = 1 - (clientY - rect.top) / rect.height;
    const raw = min + Math.max(0, Math.min(1, ratio)) * (max - min);
    const stepped = Math.round(raw / step) * step;
    const clamped = Math.max(min, Math.min(max, stepped));
    onChange(Math.round(clamped * 100) / 100);
  }, [min, max, step, onChange]);

  useEffect(() => {
    if (disabled) return;
    const onMove = (e: MouseEvent) => { if (dragging.current) computeValue(e.clientY); };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [computeValue, disabled]);

  const fillColor = color ?? "#ffffff";

  return (
    <div
      ref={trackRef}
      className={`relative flex items-center justify-center ${disabled ? "opacity-30" : "cursor-pointer"}`}
      style={{ width, height, touchAction: "none" }}
      onMouseDown={(e) => { if (!disabled) { dragging.current = true; computeValue(e.clientY); } }}
      onTouchStart={(e) => { if (!disabled) { dragging.current = true; computeValue(e.touches[0].clientY); } }}
      onTouchMove={(e) => { if (dragging.current) computeValue(e.touches[0].clientY); }}
      onTouchEnd={() => { dragging.current = false; }}
    >
      {/* Track groove */}
      <div className="absolute top-1 bottom-1 left-1/2 -translate-x-1/2 rounded-full"
        style={{ width: 3, background: "rgba(255,255,255,0.05)" }} />
      {/* Fill */}
      <div className="absolute left-1/2 -translate-x-1/2 rounded-full pointer-events-none transition-all duration-75"
        style={{
          width: 3,
          top: `${100 - clampedPct}%`,
          bottom: "0%",
          background: `linear-gradient(to top, ${fillColor}33, ${fillColor}bb)`,
        }} />
      {/* Thumb */}
      <div className="absolute left-1/2 -translate-x-1/2 rounded-sm pointer-events-none transition-all duration-75"
        style={{
          width: width - 4,
          height: 7,
          top: `calc(${100 - clampedPct}% - 3.5px)`,
          background: disabled ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.7)",
          boxShadow: "none",
        }} />
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
   MAIN EQ PANEL
   ═══════════════════════════════════════════════════════ */

export const EqPanel: React.FC<EqPanelProps> = ({ open, onClose }) => {
  const {
    eqEnabled, eqGains, eqAuto, eqPreset, eqParametric, eqQs,
    eqBandHz, eqBandCount, eqBassBoostDb, eqTrebleBoostDb,
    toggleEq, toggleEqAuto, toggleEqParametric,
    setEqBand, setEqBandQ, setBandCount, setEqFreqs,
    setBassBoostDb, setTrebleBoostDb, applyEqPreset, resetEq,
    volume, setVolume,
  } = usePlayer();

  const [preamp, setPreampState] = useState<number>(() => {
    const v = loadNumber(PREAMP_KEY, 1.0);
    return v < 0.5 ? 1.0 : v;
  });
  const [balance, setBalanceState] = useState<number>(() => loadNumber(BALANCE_KEY, 0.0));
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedBand, setSelectedBand] = useState<number | null>(null);
  const [abState, setAbState] = useState<{
    a: number[] | null; b: number[] | null; active: "a" | "b" | null;
  }>({ a: null, b: null, active: null });

  const setPreamp = useCallback((val: number) => {
    const clamped = Math.min(2, Math.max(0.5, val));
    setPreampState(clamped);
    try { window.localStorage.setItem(PREAMP_KEY, String(clamped)); } catch { /* */ }
    if (isTauri()) invoke("set_preamp", { preamp: clamped }).catch(() => {});
  }, []);

  const setBalanceVal = useCallback((val: number) => {
    const clamped = Math.min(1, Math.max(-1, val));
    setBalanceState(clamped);
    try { window.localStorage.setItem(BALANCE_KEY, String(clamped)); } catch { /* */ }
    if (isTauri()) invoke("set_balance", { balance: clamped }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri() || !open) return;
    invoke("set_preamp", { preamp }).catch(() => {});
    invoke("set_balance", { balance }).catch(() => {});
  }, [open]);

  const handleAutoEqImport = useCallback(async () => {
    setImportError(null);
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: "EQ Text", extensions: ["txt"] }],
      });
      if (!selected) return;
      const path = selected as string;
      const text = await invoke<string>("read_text_file", { path: path as string });
      const result = parseAutoEq(text);
      if (!result || result.bands.length === 0) {
        setImportError("No EQ bands found");
        return;
      }
      const { gains, qs, bandHz } = autoEqToVynlore(result);
      setEqFreqs(bandHz);
      if (!eqParametric) toggleEqParametric();
      for (let i = 0; i < gains.length; i++) setEqBand(i, gains[i]);
      for (let i = 0; i < qs.length; i++) setEqBandQ(i, qs[i]);
    } catch (err) {
      setImportError(String(err));
    }
  }, [eqParametric, toggleEqParametric, setEqFreqs, setEqBand, setEqBandQ]);

  const handleAb = useCallback((slot: "a" | "b") => {
    setAbState((prev) => {
      if (slot === "a") {
        if (prev.active === "a") {
          if (prev.b) for (let i = 0; i < prev.b.length; i++) setEqBand(i, prev.b[i]);
          return { ...prev, active: "b" };
        }
        return { ...prev, a: [...eqGains], active: "a" };
      }
      if (prev.active === "b") {
        if (prev.a) for (let i = 0; i < prev.a.length; i++) setEqBand(i, prev.a[i]);
        return { ...prev, active: "a" };
      }
      return { ...prev, b: [...eqGains], active: "b" };
    });
  }, [eqGains, setEqBand]);

  const curveW = 800;
  const curveH = 220;
  const curvePath = eqCurvePath(eqGains, eqBandHz, curveW, curveH);
  const curveFillPath = eqCurveFill(eqGains, eqBandHz, curveW, curveH);
  const presetsAvailable = eqBandCount === 10 || eqBandCount === 31 || eqBandCount === 32;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[500] flex flex-col bg-bg"
        >
          {/* ═══ TOP BAR ═══ */}
          <div className="h-11 shrink-0 flex items-center justify-between px-5 border-b border-white/[0.06]">
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-white/30 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer">
                <X size={16} />
              </button>
              <div className="h-4 w-px bg-white/[0.07]" />
              <h2 className="text-[11px] font-bold text-white/50 tracking-[0.2em] uppercase font-display">Equalizer</h2>
              <div className="flex items-center gap-1.5 ml-1">
                <div className={`w-1.5 h-1.5 rounded-full transition-all ${eqEnabled ? "bg-white" : "bg-white/10"}`} />
                <span className={`text-[9px] font-bold tracking-wider ${eqEnabled ? "text-white/70" : "text-white/15"}`}>{eqEnabled ? "ON" : "OFF"}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleAutoEqImport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-medium border border-white/[0.07] bg-white/[0.02] text-white/35 hover:text-white/60 hover:border-white/[0.12] hover:bg-white/[0.04] transition-all cursor-pointer">
                <Download size={11} /> Import
              </button>
              {importError && <span className="text-[9px] text-red-400/80 max-w-[100px] truncate">{importError}</span>}
              <div className="flex items-center border border-white/[0.07] rounded-md overflow-hidden">
                {(["a", "b"] as const).map((s, idx) => (
                  <React.Fragment key={s}>
                    {idx === 1 && <div className="w-px h-3.5 bg-white/[0.07]" />}
                    <button onClick={() => handleAb(s)}
                      className={`px-2.5 py-1 text-[9px] font-bold tracking-wider cursor-pointer border-none transition-all ${abState.active === s ? "bg-white/15 text-white" : "bg-transparent text-white/25 hover:text-white/50"}`}>
                      {s.toUpperCase()}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              <button onClick={resetEq} disabled={!eqEnabled}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium border border-white/[0.07] bg-white/[0.02] text-white/35 hover:text-white/60 hover:border-white/[0.12] transition-all cursor-pointer disabled:opacity-25 disabled:cursor-default">
                <RotateCcw size={10} /> Reset
              </button>
              <button onClick={toggleEq}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[10px] font-bold tracking-wider border transition-all cursor-pointer ${eqEnabled ? "border-white/30 bg-white/10 text-white" : "border-white/[0.07] bg-white/[0.02] text-white/25 hover:text-white/50"}`}>
                <Power size={12} /> {eqEnabled ? "ACTIVE" : "BYPASS"}
              </button>
            </div>
          </div>

          {/* ═══ MAIN ═══ */}
          <div className="flex-1 flex min-h-0">

            {/* ─── LEFT: Master controls ─── */}
            <div className="w-[88px] shrink-0 border-r border-white/[0.05] flex flex-col items-center gap-2 py-4 px-2">
              {([
                { label: "VOL", value: volume, min: 0, max: 1, step: 0.01, set: setVolume, display: `${Math.round(volume * 100)}%`, color: undefined },
                { label: "PRE", value: preamp, min: 0.5, max: 2, step: 0.1, set: setPreamp, display: `${preamp.toFixed(1)}×`, color: undefined },
                { label: "BASS", value: eqBassBoostDb, min: -EQ_MAX_BOOST, max: EQ_MAX_BOOST, step: 0.5, set: setBassBoostDb, display: `${gainLabel(eqBassBoostDb)}dB`, color: undefined },
                { label: "TRBL", value: eqTrebleBoostDb, min: -EQ_MAX_BOOST, max: EQ_MAX_BOOST, step: 0.5, set: setTrebleBoostDb, display: `${gainLabel(eqTrebleBoostDb)}dB`, color: undefined },
              ] as const).map((f, idx) => (
                <React.Fragment key={f.label}>
                  {idx > 0 && <div className="w-6 h-px bg-white/[0.04]" />}
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[8px] font-bold text-white/20 uppercase tracking-[0.14em]">{f.label}</span>
                    <VFader value={f.value} min={f.min} max={f.max} step={f.step} onChange={f.set}
                      disabled={!eqEnabled && idx >= 2} color={f.color} width={24} height={120} />
                    <span className="text-[9px] tabular-nums text-white/35 font-medium">{f.display}</span>
                  </div>
                </React.Fragment>
              ))}
              {/* Balance */}
              <div className="w-6 h-px bg-white/[0.04]" />
              <div className="flex flex-col items-center gap-1 w-full px-1">
                <span className="text-[8px] font-bold text-white/20 uppercase tracking-[0.14em]">BAL</span>
                <input type="range" min={-1} max={1} step={0.01} value={balance}
                  onChange={(e) => setBalanceVal(Number(e.target.value))}
                  className="w-full h-1" />
                <button
                  onClick={() => setBalanceVal(0)}
                  className={`text-[9px] tabular-nums font-medium bg-transparent border-none cursor-pointer transition-colors hover:text-white/70 ${Math.abs(balance) > 0.01 ? "text-white/60" : "text-white"}`}
                  title="Click to center"
                >
                  {balanceLabel(balance)}
                </button>
              </div>
            </div>

            {/* ─── CENTER ─── */}
            <div className="flex-1 flex flex-col min-w-0">

              {/* ─── FREQUENCY RESPONSE CURVE ─── */}
              <div className={`px-5 pt-4 pb-2 shrink-0 transition-opacity duration-300 ${eqEnabled ? "" : "opacity-25"}`}>
                <div className="relative rounded-lg overflow-hidden border border-white/[0.04] bg-white/[0.01]">
                  <svg viewBox={`0 0 ${curveW} ${curveH}`} className="w-full" style={{ height: 180 }} preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ffffff" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="eqStroke" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#ffffff" />
                        <stop offset="50%" stopColor="#ffffff" />
                        <stop offset="100%" stopColor="#ffffff" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal grid */}
                    {[-12, -6, 0, 6, 12].map((db) => {
                      const y = curveH / 2 - (db / 12) * (curveH / 2);
                      return (
                        <g key={db}>
                          <line x1={0} y1={y} x2={curveW} y2={y}
                            stroke={db === 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.025)"}
                            strokeWidth={db === 0 ? 0.8 : 0.5} strokeDasharray={db === 0 ? "none" : "3,8"} />
                          <text x={curveW - 4} y={y - 3} textAnchor="end" fill="rgba(255,255,255,0.1)" fontSize={8} fontFamily="Inter">
                            {db > 0 ? `+${db}` : db}
                          </text>
                        </g>
                      );
                    })}

                    {/* Vertical freq markers */}
                    {[31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((hz) => {
                      const x = ((Math.log10(hz) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * curveW;
                      return (
                        <g key={hz}>
                          <line x1={x} y1={0} x2={x} y2={curveH} stroke="rgba(255,255,255,0.025)" strokeWidth={0.5} />
                          <text x={x} y={curveH - 5} textAnchor="middle" fill="rgba(255,255,255,0.12)" fontSize={8} fontFamily="Inter">
                            {bandLabel(hz)}
                          </text>
                        </g>
                      );
                    })}

                    {/* Fill */}
                    {curveFillPath && <path d={curveFillPath} fill="url(#eqFill)" opacity={0.6} />}

                    {/* Main curve */}
                    {curvePath && <path d={curvePath} fill="none" stroke="url(#eqStroke)" strokeWidth={2} strokeLinecap="round" />}

                    {/* Band dots */}
                    {eqBandHz.map((hz, i) => {
                      const logHz = Math.log10(Math.max(20, Math.min(20000, hz)));
                      const fx = (logHz - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
                      const x = fx * curveW;
                      const g = eqGains[i] ?? 0;
                      const y = curveH / 2 - (g / EQ_MAX_GAIN) * (curveH / 2);
                      const sel = selectedBand === i;
                      return (
                        <g key={`${hz}-${i}`} onClick={() => setSelectedBand(sel ? null : i)} style={{ cursor: "pointer" }}>
                          {sel && <circle cx={x} cy={y} r={10} fill="#ffffff" opacity={0.07} />}
                          {sel && <circle cx={x} cy={y} r={6} fill="none" stroke="#ffffff" strokeWidth={0.8} opacity={0.3} />}
                          <circle cx={x} cy={y} r={sel ? 4 : 2.5}
                            fill={sel ? "#ffffff" : "rgba(255,255,255,0.15)"}
                            stroke={sel ? "#ffffff" : "none"} strokeWidth={0.5} />
                          {sel && (
                            <>
                              <rect x={x - 28} y={y - 22} width={56} height={14} rx={3} fill="rgba(6,6,10,0.92)" stroke="#ffffff" strokeWidth={0.5} />
                              <text x={x} y={y - 11} textAnchor="middle" fill="#ffffff" fontSize={8} fontWeight="bold" fontFamily="Inter">
                                {bandLabel(hz)} {gainLabel(g)}
                              </text>
                            </>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* ─── BAND FADERS ─── */}
              <div className={`flex-1 flex flex-col min-h-0 px-4 pb-2 transition-opacity duration-300 ${eqEnabled ? "" : "opacity-25"}`}>
                {/* Controls row */}
                <div className="flex items-center gap-3 mb-2 shrink-0 flex-wrap">
                  <div className="flex items-center gap-0.5">
                    <span className="text-[8px] text-white/20 uppercase tracking-wider mr-1">Bands</span>
                    {BAND_COUNT_PRESETS.map((n) => (
                      <button key={n}
                        data-active={eqBandCount === n ? "" : undefined}
                        className="px-1.5 py-0.5 text-[9px] rounded border border-white/[0.07] bg-transparent text-white/25 cursor-pointer transition-all hover:border-white/[0.15] hover:text-white/50 data-[active]:bg-white/10 data-[active]:border-white/30 data-[active]:text-white font-semibold"
                        onClick={() => setBandCount(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <div className="h-3 w-px bg-white/[0.06]" />
                  <button data-on={eqParametric ? "" : undefined}
                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-white/[0.07] bg-transparent text-white/25 text-[9px] font-semibold cursor-pointer transition-all hover:border-white/[0.15] hover:text-white/50 data-[on]:border-white/30 data-[on]:bg-white/10 data-[on]:text-white uppercase tracking-wider"
                    onClick={toggleEqParametric}>
                    <SlidersHorizontal size={10} /> {eqParametric ? "Para" : "Geo"}
                  </button>
                  <label className="flex items-center gap-1 text-[9px] text-white/25 cursor-pointer select-none uppercase tracking-wider font-semibold hover:text-white/40 transition-colors">
                    <input type="checkbox" checked={eqAuto} onChange={toggleEqAuto} className="accent-white scale-90" />
                    <Sparkles size={10} /> Auto
                  </label>
                  {!presetsAvailable && <span className="text-[8px] text-white/10 italic">Presets: 10 bands</span>}
                </div>

                {/* Fader columns */}
                <div className="flex-1 flex items-stretch min-h-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                  {eqBandHz.map((hz, i) => {
                    const gain = eqGains[i] ?? 0;
                    const q = eqQs[i] ?? 1.1;
                    const sel = selectedBand === i;
                    const isPos = gain > 0.05;
                    const isNeg = gain < -0.05;

                    return (
                      <div key={`${hz}-${i}`}
                        onClick={() => setSelectedBand(sel ? null : i)}
                        className={`flex flex-col items-center flex-1 min-w-[28px] mx-[1px] rounded-lg cursor-pointer transition-all border ${sel ? "bg-white/[0.03] border-white/10" : "bg-transparent border-transparent hover:bg-white/[0.015]"}`}>

                        {/* Gain readout */}
                        <div className="pt-2 pb-1 shrink-0">
                          <span className={`text-[10px] tabular-nums font-bold ${isPos ? "text-white" : isNeg ? "text-red-400/80" : "text-white/20"}`}>
                            {gainLabel(gain)}
                          </span>
                        </div>

                        {/* Fader */}
                        <div className="flex-1 min-h-0 w-full flex items-center justify-center">
                          <VFader value={gain} min={-EQ_MAX_GAIN} max={EQ_MAX_GAIN} step={0.5}
                            onChange={(v) => setEqBand(i, v)} width={20} height={200} />
                        </div>

                        {/* Q slider (parametric) */}
                        {eqParametric && (
                          <div className="w-full px-1.5 py-1 shrink-0">
                            <input type="range" min={0.3} max={10} step={0.1} value={q}
                              title={`Q = ${q.toFixed(1)}`}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => { e.stopPropagation(); setEqBandQ(i, Number(e.target.value)); }}
                              className="w-full h-1" style={{ accentColor: "#ffffff" }} />
                            <span className="text-[7px] text-white/12 block text-center mt-0.5">Q{q.toFixed(1)}</span>
                          </div>
                        )}

                        {/* Frequency label */}
                        <div className="pb-2 pt-1 shrink-0">
                          <span className={`text-[8px] leading-tight block ${sel ? "text-white font-bold" : "text-white/20"}`}>{bandLabel(hz)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ─── RIGHT: Presets ─── */}
            <div className="w-[180px] shrink-0 border-l border-white/[0.05] flex flex-col overflow-y-auto"
              style={{ scrollbarWidth: "none" }}>
              <div className="px-3 pt-3 pb-1.5">
                <span className="text-[8px] font-bold text-white/20 uppercase tracking-[0.15em]">Presets</span>
              </div>
              <div className="flex-1 px-2 pb-3 space-y-0.5">
                {presetsAvailable ? (
                  EQ_PRESETS.map((preset) => {
                    const isActive = eqPreset === preset.key;
                    return (
                      <button key={preset.key}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-[10px] font-medium transition-all cursor-pointer border ${isActive ? "bg-white/[0.06] border-white/15 text-white" : "bg-transparent border-transparent text-white/25 hover:text-white/50 hover:bg-white/[0.02]"}`}
                        disabled={!eqEnabled}
                        onClick={() => applyEqPreset(preset.key)}>
                        <div className="flex items-center justify-between mb-1">
                          <span>{preset.label}</span>
                          {isActive && <Zap size={9} className="text-white" />}
                        </div>
                        <div className="flex items-end gap-[1px] h-[10px]">
                          {preset.gains.map((g, j) => (
                            <div key={j} className="flex-1 rounded-[1px]" style={{
                              height: `${Math.max(1, Math.abs(g) / EQ_MAX_GAIN * 100)}%`,
                              background: g > 0 ? "#ffffff" : g < 0 ? "rgba(239,68,68,0.45)" : "rgba(255,255,255,0.06)",
                              alignSelf: g >= 0 ? "flex-end" : "flex-start",
                              opacity: isActive ? 1 : 0.4,
                            }} />
                          ))}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-8 text-center">
                    <span className="text-[9px] text-white/10 italic">Select 10 bands</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
