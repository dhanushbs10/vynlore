import React, { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Power, Sparkles, Volume2, VolumeX } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@tauri-apps/api/core";
import { usePlayer } from "../context/PlayerContext";
import { EQ_BANDS_HZ, EQ_MAX_GAIN, EQ_PRESETS } from "../audio/eqPresets";

interface EqPanelProps {
  open: boolean;
  onClose: () => void;
}

function bandLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

function gainLabel(gain: number): string {
  if (gain === 0) return "0";
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

const FREQ_POINTS = EQ_BANDS_HZ.map((hz) => {
  const logMin = Math.log10(30);
  const logMax = Math.log10(16000);
  const logHz = Math.log10(hz);
  return (logHz - logMin) / (logMax - logMin);
});

function eqCurvePath(gains: number[], width: number, height: number): string {
  const padding = 4;
  const plotH = height - padding * 2;
  const plotW = width - padding * 2;
  const maxGain = EQ_MAX_GAIN;

  const points: [number, number][] = gains.map((g, i) => {
    const x = padding + FREQ_POINTS[i] * plotW;
    const normalizedGain = g / maxGain;
    const y = padding + plotH / 2 - normalizedGain * (plotH / 2);
    return [x, y];
  });

  if (points.length < 2) return "";

  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = (prev[0] + curr[0]) / 2;
    d += ` C ${cpx} ${prev[1]}, ${cpx} ${curr[1]}, ${curr[0]} ${curr[1]}`;
  }
  return d;
}

export const EqPanel: React.FC<EqPanelProps> = ({ open, onClose }) => {
  const {
    eqEnabled,
    eqGains,
    eqAuto,
    eqPreset,
    toggleEq,
    toggleEqAuto,
    setEqBand,
    applyEqPreset,
    resetEq,
    volume,
    setVolume,
  } = usePlayer();

  const [preamp, setPreampState] = useState<number>(() => Math.max(0.5, loadNumber(PREAMP_KEY, 1.0)));
  const [balance, setBalanceState] = useState<number>(() => loadNumber(BALANCE_KEY, 0.0));

  const setPreamp = useCallback((val: number) => {
    const clamped = Math.min(2, Math.max(0.5, val));
    setPreampState(clamped);
    try { window.localStorage.setItem(PREAMP_KEY, String(clamped)); } catch { /* ignore */ }
    if (isTauri()) {
      invoke("set_preamp", { preamp: clamped }).catch(() => {});
    }
  }, []);

  const setBalance = useCallback((val: number) => {
    const clamped = Math.min(1, Math.max(-1, val));
    setBalanceState(clamped);
    try { window.localStorage.setItem(BALANCE_KEY, String(clamped)); } catch { /* ignore */ }
    if (isTauri()) {
      invoke("set_balance", { balance: clamped }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!isTauri() || !open) return;
    invoke("set_preamp", { preamp }).catch(() => {});
    invoke("set_balance", { balance }).catch(() => {});
  }, [open]);

  const curveW = 200;
  const curveH = 60;
  const curvePath = eqCurvePath(eqGains, curveW, curveH);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 400, damping: 35 }}
          className="fixed bottom-0 left-[232px] right-0 z-[90] bg-bg-elevated/95 backdrop-blur-xl border-t border-border overflow-y-auto max-h-[280px]"
          aria-hidden={!open}
        >
          {/* Drag handle */}
          <div
            className="flex justify-center pt-2 pb-1 cursor-pointer"
            onClick={onClose}
          >
            <div className="w-10 h-1 rounded-full bg-text-muted/40" />
          </div>

          {/* Top row: volume, preamp, balance | bands | presets, power, close */}
          <div className="flex items-stretch gap-4 px-4 pb-3">

            {/* Volume */}
            <div className="flex flex-col items-center gap-1.5 shrink-0 w-14">
              <button
                onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
                className="text-text-secondary hover:text-text transition-colors bg-transparent border-none cursor-pointer p-0"
                aria-label={volume > 0 ? "Mute" : "Unmute"}
              >
                {volume > 0 ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <input
                type="range"
                className="eq-vertical h-[140px]"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
              />
              <span className="text-[10px] tabular-nums text-text-muted">{Math.round(volume * 100)}</span>
            </div>

            {/* Preamp */}
            <div className="flex flex-col items-center gap-1.5 shrink-0 w-14">
              <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Pre</span>
              <input
                type="range"
                className="eq-vertical h-[140px]"
                min={0.5}
                max={2}
                step={0.1}
                value={preamp}
                onChange={(e) => setPreamp(Number(e.target.value))}
                aria-label="Preamp gain"
              />
              <span className="text-[10px] tabular-nums text-text-muted">{preamp.toFixed(1)}</span>
            </div>

            {/* Balance */}
            <div className="flex flex-col items-center gap-1.5 shrink-0 w-14">
              <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Bal</span>
              <input
                type="range"
                className="eq-vertical h-[140px]"
                min={-1}
                max={1}
                step={0.01}
                value={balance}
                onChange={(e) => setBalance(Number(e.target.value))}
                aria-label="Balance"
              />
              <span className="text-[10px] tabular-nums text-text-muted">{balanceLabel(balance)}</span>
            </div>

            {/* Separator */}
            <div className="w-px bg-border self-stretch shrink-0" />

            {/* 10-band EQ sliders */}
            <div className={`flex justify-between gap-0.5 flex-1 ${eqEnabled ? "" : "opacity-45"}`}>
              {EQ_BANDS_HZ.map((hz, i) => (
                <div className="flex flex-col items-center gap-1 flex-1 min-w-0" key={hz}>
                  <span className="text-[9px] tabular-nums text-text-secondary min-h-3">{gainLabel(eqGains[i] ?? 0)}</span>
                  <input
                    type="range"
                    className="eq-vertical h-[180px]"
                    min={-EQ_MAX_GAIN}
                    max={EQ_MAX_GAIN}
                    step={0.5}
                    value={eqGains[i] ?? 0}
                    disabled={!eqEnabled}
                    onChange={(e) => setEqBand(i, Number(e.target.value))}
                    aria-label={`${bandLabel(hz)} Hz`}
                  />
                  <span className="text-[9px] text-text-muted">{bandLabel(hz)}</span>
                </div>
              ))}
            </div>

            {/* Separator */}
            <div className="w-px bg-border self-stretch shrink-0" />

            {/* Right section: presets, power, close */}
            <div className="flex flex-col items-center gap-2 shrink-0">
              {/* Auto-match + power */}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer select-none">
                  <input type="checkbox" checked={eqAuto} onChange={toggleEqAuto} className="accent-accent" />
                  <Sparkles size={11} />
                  <span>Auto</span>
                </label>
                <button
                  data-on={eqEnabled ? "" : undefined}
                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full border border-border bg-transparent text-text-secondary cursor-pointer hover:border-accent hover:text-accent transition-colors data-[on]:border-accent data-[on]:bg-accent-soft data-[on]:text-accent"
                  onClick={toggleEq}
                  title={eqEnabled ? "Disable EQ" : "Enable EQ"}
                >
                  <Power size={12} />
                  {eqEnabled ? "ON" : "OFF"}
                </button>
                <button
                  className="text-text-muted hover:text-text transition-colors bg-transparent border-none cursor-pointer p-1"
                  onClick={onClose}
                  aria-label="Close equalizer"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Presets */}
              <div className="flex flex-wrap gap-1 max-w-[220px] justify-center">
                {EQ_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    data-active={eqPreset === preset.key ? "" : undefined}
                    className="px-2 py-0.5 text-[10px] font-medium rounded-full border border-border bg-transparent text-text-secondary cursor-pointer transition-all disabled:opacity-40 disabled:cursor-default hover:border-accent hover:text-accent data-[active]:bg-accent data-[active]:border-accent data-[active]:text-bg data-[active]:font-semibold"
                    disabled={!eqEnabled}
                    onClick={() => applyEqPreset(preset.key)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Reset */}
              <button
                className="px-2 py-0.5 text-[10px] rounded-lg border border-border bg-transparent text-text-secondary cursor-pointer hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-default"
                onClick={resetEq}
                disabled={!eqEnabled}
              >
                Reset all
              </button>
            </div>
          </div>

          {/* Frequency response curve */}
          <div className="px-4 pb-3">
            <svg
              viewBox={`0 0 ${curveW} ${curveH}`}
              className="w-full h-[50px]"
              preserveAspectRatio="none"
            >
              {/* 0dB line */}
              <line
                x1={4} y1={curveH / 2} x2={curveW - 4} y2={curveH / 2}
                stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="3,3"
              />
              {/* Grid lines at +6dB and -6dB */}
              <line
                x1={4} y1={curveH / 4} x2={curveW - 4} y2={curveH / 4}
                stroke="var(--color-border)" strokeWidth={0.3} strokeDasharray="2,4"
              />
              <line
                x1={4} y1={curveH * 3 / 4} x2={curveW - 4} y2={curveH * 3 / 4}
                stroke="var(--color-border)" strokeWidth={0.3} strokeDasharray="2,4"
              />
              {/* Band frequency markers */}
              {FREQ_POINTS.map((fx, i) => (
                <line
                  key={i}
                  x1={4 + fx * (curveW - 8)} y1={curveH / 2 - 2}
                  x2={4 + fx * (curveW - 8)} y2={curveH / 2 + 2}
                  stroke="var(--color-border)" strokeWidth={0.5}
                />
              ))}
              {/* EQ curve */}
              {curvePath && (
                <path
                  d={curvePath}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              )}
            </svg>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
