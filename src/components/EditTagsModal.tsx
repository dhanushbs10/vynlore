import { useEffect, useState } from "react";
import { X, Save } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../types";

interface Props {
  track: Track | null;
  onClose: () => void;
  onSaved: (track: Track, patch: Partial<Track>) => void;
}

const INPUT_CLASS =
  "w-full px-3 py-2.5 rounded-lg border border-border bg-bg-raised text-text text-[13px] placeholder:text-text-muted focus:outline-none focus:border-white-30 transition-colors";

export function EditTagsModal({ track, onClose, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [genre, setGenre] = useState("");
  const [trackNo, setTrackNo] = useState("");
  const [discNo, setDiscNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!track) return;
    setTitle(track.title ?? "");
    setArtist(track.artist ?? "");
    setAlbum(track.album ?? "");
    setGenre(track.genre ?? "");
    setTrackNo(track.track_number > 0 ? String(track.track_number) : "");
    setDiscNo(track.disc_number > 0 ? String(track.disc_number) : "");
    setError(null);
  }, [track]);

  useEffect(() => {
    if (!track) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [track, onClose]);

  const handleSave = async () => {
    if (!track) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("edit_tags", {
        filePath: track.file_path,
        title,
        artist,
        album,
        genre,
        trackNumber: trackNo.trim() === "" ? undefined : Number(trackNo),
        discNumber: discNo.trim() === "" ? undefined : Number(discNo),
      });
      const patch: Partial<Track> = {
        title,
        artist,
        album,
        genre,
        track_number: trackNo.trim() === "" ? track.track_number : Number(trackNo),
        disc_number: discNo.trim() === "" ? track.disc_number : Number(discNo),
      };
      onSaved(track, patch);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {track && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[2100] bg-black-70 flex justify-center items-center"
          onMouseDown={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="w-[min(480px,92vw)] max-h-[80vh] bg-bg-elevated border border-border rounded-lg flex flex-col overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
              <h2 className="text-[15px] font-bold text-text font-display tracking-wide">Edit tags</h2>
              <button
                className="ml-auto w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-white-5 transition-colors cursor-pointer"
                onClick={onClose}
                aria-label="Close tag editor"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3">
              <div className="text-[11px] text-text-muted truncate" title={track.file_path}>
                {track.file_path}
              </div>

              <label className="block">
                <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-text-muted mb-1.5 block">Title</span>
                <input className={INPUT_CLASS} value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>

              <label className="block">
                <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-text-muted mb-1.5 block">Artist</span>
                <input className={INPUT_CLASS} value={artist} onChange={(e) => setArtist(e.target.value)} />
              </label>

              <label className="block">
                <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-text-muted mb-1.5 block">Album</span>
                <input className={INPUT_CLASS} value={album} onChange={(e) => setAlbum(e.target.value)} />
              </label>

              <label className="block">
                <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-text-muted mb-1.5 block">Genre</span>
                <input className={INPUT_CLASS} value={genre} onChange={(e) => setGenre(e.target.value)} />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-text-muted mb-1.5 block">Track no.</span>
                  <input
                    className={INPUT_CLASS}
                    value={trackNo}
                    inputMode="numeric"
                    placeholder="Leave empty to keep"
                    onChange={(e) => setTrackNo(e.target.value.replace(/[^0-9]/g, ""))}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-text-muted mb-1.5 block">Disc no.</span>
                  <input
                    className={INPUT_CLASS}
                    value={discNo}
                    inputMode="numeric"
                    placeholder="Leave empty to keep"
                    onChange={(e) => setDiscNo(e.target.value.replace(/[^0-9]/g, ""))}
                  />
                </label>
              </div>

              <p className="text-[11px] text-text-muted">
                Leaving a text field empty removes that tag. Changes are written straight to the file —
                the library refreshes automatically.
              </p>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-[12px] text-red-400">
                  {error}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-border text-[12.5px] font-medium text-text-secondary hover:text-text hover:bg-white-5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-[12.5px] font-semibold text-bg hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={14} />
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}