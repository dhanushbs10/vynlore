import React from "react";
import { X, Power, Sparkles } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { EQ_BANDS_HZ, EQ_MAX_GAIN, EQ_PRESETS, presetForGenre } from "../audio/eqPresets";

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
        currentTrack,
    } = usePlayer();

    const autoPreset = eqAuto ? presetForGenre(currentTrack?.genre) : null;

    return (
        <div className={`eq-panel ${open ? "open" : ""}`} aria-hidden={!open}>
            <div className="eq-header">
                <span className="eq-title">EQUALIZER</span>
                <button
                    className={`eq-power ${eqEnabled ? "on" : ""}`}
                    onClick={toggleEq}
                    title={eqEnabled ? "Disable EQ" : "Enable EQ"}
                >
                    <Power size={14} />
                    {eqEnabled ? "ON" : "OFF"}
                </button>
                <button className="eq-close" onClick={onClose} aria-label="Close equalizer">
                    <X size={16} />
                </button>
            </div>

            <label className="eq-auto-row">
                <input type="checkbox" checked={eqAuto} onChange={toggleEqAuto} />
                <Sparkles size={13} />
                <span>Auto-match genre</span>
                {autoPreset && (
                    <span className="eq-auto-hint">→ {autoPreset.label}</span>
                )}
            </label>

            <div className="eq-presets">
                {EQ_PRESETS.map((preset) => (
                    <button
                        key={preset.key}
                        className={`eq-preset-chip ${eqPreset === preset.key ? "active" : ""}`}
                        disabled={!eqEnabled}
                        onClick={() => applyEqPreset(preset.key)}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>

            <div className={`eq-bands ${eqEnabled ? "" : "disabled"}`}>
                {EQ_BANDS_HZ.map((hz, i) => (
                    <div className="eq-band" key={hz}>
                        <span className="eq-band-gain">{gainLabel(eqGains[i] ?? 0)}</span>
                        <input
                            type="range"
                            className="eq-slider"
                            min={-EQ_MAX_GAIN}
                            max={EQ_MAX_GAIN}
                            step={0.5}
                            value={eqGains[i] ?? 0}
                            disabled={!eqEnabled}
                            onChange={(e) => setEqBand(i, Number(e.target.value))}
                            aria-label={`${bandLabel(hz)} Hz`}
                        />
                        <span className="eq-band-hz">{bandLabel(hz)}</span>
                    </div>
                ))}
            </div>

            <div className="eq-footer">
                <button className="eq-reset" onClick={resetEq} disabled={!eqEnabled}>
                    Reset all
                </button>
            </div>
        </div>
    );
};
