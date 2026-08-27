import { useEffect, useRef } from "react";
import {
  X,
  FolderOpen,
  RefreshCw,
  Music2,
  Palette,
  Upload,
  Download,
  Trash2,
  Timer,
  XCircle,
  Cloud,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useThemes, builtinId, customId } from "../context/ThemeContext";
import { usePlayer } from "../context/PlayerContext";

export interface ScanProgress {
  scanned: number;
  total: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  watchedFolder: string | null;
  scanning: boolean;
  scanProgress: ScanProgress | null;
  onSelectFolder: () => void;
  onRescan: () => void;
}

export function SettingsModal({
  open,
  onClose,
  watchedFolder,
  scanning,
  scanProgress,
  onSelectFolder,
  onRescan,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { builtins, custom, currentId, setTheme, importTheme, exportTheme, deleteTheme } =
    useThemes();
  const { sleepTimerSeconds, sleepRemainingMs, setSleepTimer, cancelSleepTimer, replaygainMode, setReplaygainMode, scrobbleEnabled, scrobbleToken, setScrobbleEnabled, setScrobbleToken } =
    usePlayer();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const pct = scanProgress?.total
    ? Math.min(100, (scanProgress.scanned / scanProgress.total) * 100)
    : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[2000] bg-black-70 flex justify-center items-center"
          onMouseDown={onClose}
        >
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="w-[min(560px,92vw)] max-h-[80vh] bg-bg-elevated border border-border rounded-lg flex flex-col overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
              <h2 className="text-[15px] font-bold text-text font-display tracking-wide">Settings</h2>
              <button
                className="ml-auto w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-white-5 transition-colors cursor-pointer"
                onClick={onClose}
                aria-label="Close settings"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto">
              <div className="flex items-center gap-2 mb-4">
                <Music2 size={15} className="text-text-muted" />
                <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-text-muted">
                  Music
                </span>
              </div>

              <div className="mb-3">
                <div className="text-[13px] font-semibold text-text mb-1.5">Music folder</div>
                <div
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-raised text-[12.5px] text-text-secondary truncate"
                  title={watchedFolder ?? undefined}
                >
                  {watchedFolder ?? "No folder selected yet"}
                </div>
                <div className="text-[11px] text-text-muted mt-1.5">
                  Vynlore plays the supported audio files (FLAC, WAV, AIFF, MP3, M4A, OGG) found in this
                  folder and watches it for changes.
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  disabled={scanning}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-[13px] font-semibold cursor-pointer hover:bg-white-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={onSelectFolder}
                >
                  <FolderOpen size={14} />
                  Change folder…
                </button>
                <button
                  disabled={!watchedFolder || scanning}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-[13px] font-medium text-text-secondary cursor-pointer hover:text-text hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={onRescan}
                >
                  <RefreshCw size={13} />
                  Rescan now
                </button>
              </div>

              {scanning && (
                <div className="mt-5">
                  <div className="text-[12px] text-text-secondary mb-2">
                    Scanning…
                    {scanProgress &&
                      ` ${scanProgress.scanned.toLocaleString()}${scanProgress.total ? ` / ${scanProgress.total.toLocaleString()}` : ""}`}
                  </div>
                  {pct !== null ? (
                    <div className="h-1.5 w-full bg-bg-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white-80 rounded-full transition-[width] duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : (
                    <div className="h-1.5 w-full bg-bg-surface rounded-full overflow-hidden">
                      <div className="h-full w-1/3 bg-white-80 rounded-full animate-pulse" />
                    </div>
                  )}
                </div>
              )}

              <div className="mt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Timer size={15} className="text-text-muted" />
                  <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-text-muted">
                    Playback
                  </span>
                </div>

                <div className="mb-1.5 text-[13px] font-semibold text-text">Sleep timer</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium cursor-pointer transition-colors ${
                      sleepTimerSeconds === null
                        ? "border-[var(--color-accent)] text-text"
                        : "border-border text-text-secondary hover:text-text hover:bg-bg-hover"
                    }`}
                    onClick={cancelSleepTimer}
                  >
                    <XCircle size={13} />
                    Off
                  </button>
                  {[15, 30, 45, 60, 90].map((m) => (
                    <button
                      key={m}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium cursor-pointer transition-colors ${
                        sleepTimerSeconds === m
                          ? "border-[var(--color-accent)] text-text"
                          : "border-border text-text-secondary hover:text-text hover:bg-bg-hover"
                      }`}
                      onClick={() => setSleepTimer(m)}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
                {sleepRemainingMs !== null && sleepRemainingMs > 0 && (
                  <div className="text-[11px] text-text-muted mt-1.5">
                    {Math.floor(sleepRemainingMs / 60000)}m{" "}
                    {Math.ceil((sleepRemainingMs % 60000) / 1000)}s remaining — playback will pause
                    when it ends
                  </div>
                )}

                <div className="mt-4 mb-1.5 text-[13px] font-semibold text-text">Loudness (ReplayGain)</div>
                <div className="flex gap-2">
                  {[
                    { v: 0, label: "Off" },
                    { v: 1, label: "Per track" },
                    { v: 2, label: "Per album" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      className={`flex-1 items-center justify-center px-3 py-1.5 rounded-lg border text-[12px] font-medium cursor-pointer transition-colors ${
                        replaygainMode === opt.v
                          ? "border-[var(--color-accent)] text-text"
                          : "border-border text-text-secondary hover:text-text hover:bg-bg-hover"
                      }`}
                      onClick={() => setReplaygainMode(opt.v)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-text-muted mt-1.5">
                  Levels every song to a consistent loudness (EBU R128). Computed automatically when
                  your library is scanned; songs without analysis play unchanged.
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Cloud size={15} className="text-text-muted" />
                  <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-text-muted">
                    Scrobbling
                  </span>
                </div>

                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] font-semibold text-text">ListenBrainz</span>
                  <button
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium cursor-pointer transition-colors ${
                      scrobbleEnabled
                        ? "border-[var(--color-accent)] text-text"
                        : "border-border text-text-secondary hover:text-text hover:bg-bg-hover"
                    }`}
                    onClick={() => setScrobbleEnabled(!scrobbleEnabled)}
                  >
                    {scrobbleEnabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
                <input
                  type="password"
                  value={scrobbleToken}
                  onChange={(e) => setScrobbleToken(e.target.value)}
                  placeholder="Enter your ListenBrainz API token"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg-raised text-[12.5px] text-text-secondary placeholder:text-text-muted focus:outline-none focus:border-[var(--color-accent)]"
                />
                <div className="text-[11px] text-text-muted mt-1.5">
                  Finishes (75% or 4+ minutes) are reported to listenbrainz.org. Grab a token from
                  your account's settings — no API key or signup wall.
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Palette size={15} className="text-text-muted" />
                  <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-text-muted">
                    Appearance
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {builtins.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(builtinId(t.id))}
                      className={`group relative rounded-lg border p-2 text-left transition-colors cursor-pointer ${
                        currentId === builtinId(t.id)
                          ? "border-[var(--color-accent)]"
                          : "border-border hover:border-border-hover"
                      }`}
                      style={{ background: t.colors["bg-surface"] }}
                      title={t.name}
                    >
                      <div
                        className="h-8 w-full rounded-md"
                        style={{ background: t.colors.bg }}
                      />
                      <div
                        className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium truncate"
                        style={{ color: t.colors.text }}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: t.colors.accent }}
                        />
                        {t.name}
                      </div>
                      {currentId === builtinId(t.id) && (
                        <div
                          className="absolute top-2 right-2 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                          style={{ background: t.colors.accent }}
                        >
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: t.colors.bg }} />
                        </div>
                      )}
                    </button>
                  ))}

                  {custom.map((s) => (
                    <div
                      key={customId(s.name)}
                      className={`relative rounded-lg border p-2 text-left transition-colors ${
                        currentId === customId(s.name)
                          ? "border-[var(--color-accent)]"
                          : "border-border"
                      }`}
                      style={{ background: s.colors["bg-surface"] }}
                      title={s.name}
                    >
                      <button
                        onClick={() => setTheme(customId(s.name))}
                        className="w-full text-left cursor-pointer"
                      >
                        <div
                          className="h-8 w-full rounded-md"
                          style={{ background: s.colors.bg }}
                        />
                        <div
                          className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium truncate"
                          style={{ color: s.colors.text }}
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: s.colors.accent }}
                          />
                          {s.name}
                        </div>
                      </button>
                      <div className="absolute top-1.5 right-1.5 flex gap-1">
                        {currentId === customId(s.name) && (
                          <div
                            className="w-3.5 h-3.5 rounded-full flex items-center justify-center"
                            style={{ background: s.colors.accent }}
                          >
                            <div className="w-1.5 h-1.5 rounded-full" style={{ background: s.colors.bg }} />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12px] font-medium text-text-secondary cursor-pointer hover:text-text hover:bg-bg-hover transition-colors"
                    onClick={importTheme}
                  >
                    <Upload size={13} />
                    Import theme…
                  </button>
                  {currentId.startsWith("custom:") && (
                    <>
                      <button
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12px] font-medium text-text-secondary cursor-pointer hover:text-text hover:bg-bg-hover transition-colors"
                        onClick={() => exportTheme(currentId)}
                      >
                        <Download size={13} />
                        Export
                      </button>
                      <button
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12px] font-medium text-text-secondary cursor-pointer hover:text-danger hover:bg-bg-hover transition-colors"
                        onClick={() => deleteTheme(currentId)}
                      >
                        <Trash2 size={13} />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-border">
                <div className="text-[11px] text-text-muted">
                  Library and cached artwork live in your system app-data folder. Switching the music
                  folder replaces the library with the new folder's audio.
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}