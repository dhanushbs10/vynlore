import { useEffect, useRef, useState, useCallback } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import { Sidebar } from "./components/Sidebar";
import { QueuePanel } from "./components/QueuePanel";
import { EqPanel } from "./components/EqPanel";
import { TracksView } from "./components/views/TracksView";
import { AlbumsView } from "./components/views/AlbumsView";
import { ArtistsView } from "./components/views/ArtistsView";
import { FullscreenNowPlaying } from "./components/views/FullscreenNowPlaying";
import { AlbumDetailView } from "./components/views/AlbumDetailView";
import { ArtistDetailView } from "./components/views/ArtistDetailView";
import { GenresView } from "./components/views/GenresView";
import { GenreDetailView } from "./components/views/GenreDetailView";
import { PlaylistsView } from "./components/views/PlaylistsView";
import { PlaylistDetailView } from "./components/views/PlaylistDetailView";
import { HomeView } from "./components/views/HomeView";
import PlayerBar from "./components/PlayerBar";
import { SearchPalette } from "./components/SearchPalette";
import { Toast } from "./components/Toast";
import type { Track, ToastMessage } from "./types";

export type { Track };

type View = "now" | "browse" | "albums" | "artists" | "playlists" | "playlist-detail" | "genres" | "genre-detail" | "album-detail" | "artist-detail";

type WatcherPayload = { title: string; artist: string; count: number };

function AppInner() {
  const [currentView, setCurrentView] = useState<View>("now");
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showFullNow, setShowFullNow] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showEq, setShowEq] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [tauriReady, setTauriReady] = useState(isTauri());
  const [watchedFolder, setWatchedFolder] = useState<string | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>([]);
  const {
    currentTrackIndex,
    currentTrack,
    libraryTracks,
    displayedTracks,
    setLibraryTracks,
    setDisplayedTracks,
    playTrack,
    togglePlayPause,
    seekTime,
    playNext,
    playPrev,
    currentTime,
  } = usePlayer();

  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSearch((v) => !v);
        return;
      }
      if (typing) return;

      if (e.code === "Space") {
        e.preventDefault();
        void togglePlayPause();
      } else if (e.key === "ArrowRight" && e.ctrlKey) {
        e.preventDefault();
        void playNext();
      } else if (e.key === "ArrowLeft" && e.ctrlKey) {
        e.preventDefault();
        void playPrev();
      } else if (e.key === "ArrowRight") {
        if (!currentTrack) return;
        e.preventDefault();
        seekTime(Math.min(currentTrack.duration_secs, currentTimeRef.current + 5));
      } else if (e.key === "ArrowLeft") {
        if (!currentTrack) return;
        e.preventDefault();
        seekTime(Math.max(0, currentTimeRef.current - 5));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlayPause, playNext, playPrev, seekTime, currentTrack]);

  const loadTracks = useCallback(async () => {
    try {
      const t = await invoke<Track[]>("get_tracks");
      setLibraryTracks(t);
      setDisplayedTracks(t);
    } catch (err) {
      console.error("failed to load library", err);
    }
  }, [setLibraryTracks, setDisplayedTracks]);

  useEffect(() => {
    if (!tauriReady) return;
    loadTracks();
    if (isTauri()) {
      invoke<string | null>("get_watched_folder")
        .then((folder) => {
          if (folder) setWatchedFolder(folder);
        })
        .catch((err) => console.error("failed to read watched folder", err));
    }
  }, [tauriReady, loadTracks]);

  const loadRecentlyPlayed = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setRecentlyPlayed(await invoke<Track[]>("get_recently_played", { limit: 12 }));
    } catch (err) {
      console.error("failed to load recently played", err);
    }
  }, []);

  // Refresh whenever a new track starts playing (its count was just bumped).
  useEffect(() => {
    if (tauriReady) void loadRecentlyPlayed();
  }, [tauriReady, currentTrack?.id, loadRecentlyPlayed]);

  useEffect(() => {
    if (!isTauri()) {
      setTauriReady(true);
      return;
    }
    const timer = setTimeout(() => setTauriReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        const fn = await listen<WatcherPayload>("watcher-event", (event) => {
          const { title, count } = event.payload;
          if (!/^removed$/i.test(title)) {
            const id = Date.now() + Math.random();
            setToasts((prev) => [...prev, { id, title, subtitle: `${count} new track${count > 1 ? "s" : ""}` }]);
          }
          if (/complete|failed/i.test(title)) {
            setScanning(false);
          }
          if (count > 0) {
            loadTracks();
          }
        });
        if (disposed) { fn(); return; }
        unlisten = fn;
      } catch (err) {
        console.error("Failed to listen for watcher events:", err);
      }
    };

    setup();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadTracks]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleAddFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    setScanning(true);
    try {
      await invoke("set_watched_folder", { path: selected });
      setWatchedFolder(selected);
    } catch (err) {
      console.error("Scan failed:", err);
      setScanning(false);
    }
  }, []);

  const handleBackToPlaylist = useCallback(() => setSelectedPlaylist(null), []);

  const handleNav = useCallback(
    (view: string) => {
      setCurrentView(view as View);
      setSelectedAlbum(null);
      setSelectedArtist(null);
      setSelectedGenre(null);
      setSelectedPlaylist(null);
      setDisplayedTracks(libraryTracks);
      setShowFullNow(false);
    },
    [libraryTracks],
  );

  const handleAlbumClick = useCallback((album: string) => {
    setSelectedAlbum(album);
    setCurrentView("album-detail");
    setShowFullNow(false);
  }, []);

  const handleBackToAlbums = useCallback(() => {
    setSelectedAlbum(null);
    setCurrentView("albums");
  }, []);

  const handleArtistClick = useCallback((artist: string) => {
    setSelectedArtist(artist);
    setCurrentView("artist-detail");
    setShowFullNow(false);
  }, []);

  const handleBackToArtists = useCallback(() => {
    setSelectedArtist(null);
    setCurrentView("artists");
  }, []);

  const handleGenreClick = useCallback((genre: string) => {
    setSelectedGenre(genre);
    setCurrentView("genre-detail");
    setShowFullNow(false);
  }, []);

  const handleBackToGenres = useCallback(() => {
    setSelectedGenre(null);
    setCurrentView("genres");
  }, []);

  const handlePlaylistClick = useCallback((playlistId: number) => {
    setSelectedPlaylist(playlistId);
    setCurrentView("playlist-detail");
    setShowFullNow(false);
  }, []);

  const handleExpandTrack = useCallback((track: Track) => {
    playTrack(track, libraryTracks);
    setShowFullNow(true);
  }, [playTrack, libraryTracks]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg">
      <Sidebar
        onAddFolder={handleAddFolder}
        currentView={currentView}
        onNavClick={handleNav}
        scanning={scanning}
        hasFolder={!!watchedFolder}
        onOpenSearch={() => setShowSearch(true)}
        onToggleEq={() => setShowEq((v) => !v)}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto p-8 pb-28">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              {currentView === "now" && (
                <HomeView
                  libraryTracks={libraryTracks}
                  recentlyPlayed={recentlyPlayed}
                  playTrack={playTrack}
                  onExpandTrack={handleExpandTrack}
                  watchedFolder={watchedFolder}
                  onSelectFolder={handleAddFolder}
                  scanning={scanning}
                />
              )}
              {currentView === "browse" && (
                <TracksView tracks={displayedTracks} />
              )}
              {currentView === "albums" && (
                <AlbumsView tracks={libraryTracks} onAlbumClick={handleAlbumClick} />
              )}
              {currentView === "album-detail" && selectedAlbum && (
                <AlbumDetailView
                  albumName={selectedAlbum}
                  tracks={libraryTracks}
                  onBack={handleBackToAlbums}
                  playTrack={playTrack}
                />
              )}
              {currentView === "artists" && (
                <ArtistsView tracks={libraryTracks} onArtistClick={handleArtistClick} />
              )}
              {currentView === "artist-detail" && selectedArtist && (
                <ArtistDetailView
                  artist={selectedArtist}
                  tracks={libraryTracks}
                  onBack={handleBackToArtists}
                  playTrack={playTrack}
                />
              )}
              {currentView === "genres" && (
                <GenresView tracks={libraryTracks} onGenreClick={handleGenreClick} />
              )}
              {currentView === "genre-detail" && selectedGenre && (
                <GenreDetailView
                  genre={selectedGenre}
                  tracks={libraryTracks}
                  onBack={handleBackToGenres}
                  playTrack={playTrack}
                />
              )}
              {currentView === "playlists" && (
                <PlaylistsView
                  onPlaylistClick={handlePlaylistClick}
                />
              )}
              {currentView === "playlist-detail" && selectedPlaylist !== null && (
                <PlaylistDetailView
                  playlistId={selectedPlaylist}
                  playTrack={playTrack}
                  onBack={handleBackToPlaylist}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <QueuePanel
        displayedTracks={displayedTracks}
        currentTrackIndex={currentTrackIndex}
        playTrack={playTrack}
      />
      <EqPanel open={showEq} onClose={() => setShowEq(false)} />
      <PlayerBar onExpandCurrentTrack={() => setShowFullNow(true)} />
      {showSearch && (
        <SearchPalette
          tracks={libraryTracks}
          actions={{
            onClose: () => setShowSearch(false),
            onPlayTrack: (track, queue) => {
              void playTrack(track, queue);
            },
            onGoToArtist: handleArtistClick,
            onGoToAlbum: handleAlbumClick,
            onGoToGenre: handleGenreClick,
          }}
        />
      )}
      <AnimatePresence>
        {showFullNow && currentTrack && (
          <FullscreenNowPlaying
            onClose={() => setShowFullNow(false)}
            onOpenEq={() => { setShowFullNow(false); setShowEq(true); }}
          />
        )}
      </AnimatePresence>
      <Toast toasts={toasts} onDismiss={dismissToast} />
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
