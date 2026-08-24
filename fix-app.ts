import fs from "fs";

const content = `import { useEffect, useState, useCallback } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import { Sidebar } from "./components/Sidebar";
import { TracksView } from "./components/views/TracksView";
import { AlbumsView } from "./components/views/AlbumsView";
import { ArtistsView } from "./components/views/ArtistsView";
import { StatsView } from "./components/views/StatsView";
import { FullscreenNowPlaying } from "./components/views/FullscreenNowPlaying";
import PlayerBar from "./components/PlayerBar";

export interface Track {
  id: number;
  file_path: string;
  title: string;
  artist: string;
  album: string;
  sample_rate: number;
  bit_depth: number;
  channels: number;
  duration_secs: number;
  cover_path?: string;
}

export interface AudioDevice {
  index: number;
  name: string;
}

type View = "now" | "browse" | "albums" | "artists" | "stats";

function AppInner() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentView, setCurrentView] = useState<View>("now");
  const [scanning, setScanning] = useState(false);
  const [showFullNow, setShowFullNow] = useState(false);
  const [tauriReady, setTauriReady] = useState(isTauri());
  const { currentTrack, setSelectedDevice, selectedDevice } = usePlayer();

  useEffect(() => {
    if (!tauriReady) return;
    let cancelled = false;
    const load = async () => {
      try {
        const t = await invoke<Track[]>("get_tracks");
        const d = await invoke<AudioDevice[]>("list_devices");
        if (!cancelled) {
          setTracks(t);
          if (d && d.length > 0) setSelectedDevice(d[0].index);
        }
      } catch (err) {
        if (!cancelled) console.error("failed to load library/devices", err);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [tauriReady, setSelectedDevice]);

  useEffect(() => {
    if (!isTauri()) {
      setTauriReady(true);
      return;
    }
    const timer = setTimeout(() => setTauriReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleAddFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    setScanning(true);
    try {
      await invoke<number>("scan_folder", { path: selected });
      const updated = await invoke<Track[]>("get_tracks");
      setTracks(updated);
    } catch (err) {
      console.error("Scan failed:", err);
    } finally {
      setScanning(false);
    }
  }, []);

  const handleNav = useCallback((view: string) => {
    setCurrentView(view as View);
    setShowFullNow(false);
  }, []);

  return (
    <div className="app-shell">
      <Sidebar onAddFolder={handleAddFolder} currentView={currentView} onNavClick={handleNav} scanning={scanning} />
      <main className="app-main">
        <div className="main-scroll">
          {showFullNow && currentTrack ? (
            <FullscreenNowPlaying onClose={() => setShowFullNow(false)} />
          ) : (
            <>
              {currentView === "now" && <TracksView tracks={tracks} />}
              {currentView === "browse" && <TracksView tracks={tracks} />}
              {currentView === "albums" && <AlbumsView tracks={tracks} />}
              {currentView === "artists" && <ArtistsView tracks={tracks} />}
              {currentView === "stats" && <StatsView />}
            </>
          )}
        </div>
      </main>
      <footer className="app-player">
        <PlayerBar devices={[]} onExpand={() => setShowFullNow((v) => !v)} />
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <PlayerProvider>
      <AppInner />
    </PlayerProvider>
  );
}
`;

fs.writeFileSync("src/App.tsx", content);
console.log("wrote src/App.tsx");
