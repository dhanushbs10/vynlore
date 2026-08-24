import { useEffect, useState, useCallback } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./styles/toast.css";
import { PlayerProvider, usePlayer } from "./context/PlayerContext";
import { Sidebar } from "./components/Sidebar";
import { QueuePanel } from "./components/QueuePanel";
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
import { Toast } from "./components/Toast";
import type { ToastMessage } from "./types";

export interface Track {
  id: number;
  file_path: string;
  title: string;
  artist: string;
  album: string;
  genre?: string;
  sample_rate: number;
  bit_depth: number;
  channels: number;
  duration_secs: number;
  cover_path?: string;
  track_number?: number;
  lyrics?: string;
}

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
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [tauriReady, setTauriReady] = useState(isTauri());
  const [watchedFolder, setWatchedFolder] = useState<string | null>(null);
  const {
    currentTrackIndex,
    currentTrack,
    libraryTracks,
    displayedTracks,
    setLibraryTracks,
    setDisplayedTracks,
    playTrack,
  } = usePlayer();

  const loadTracks = useCallback(async () => {
    try {
      const t = await invoke<Track[]>("get_tracks");
      const uniqueTracks = Array.from(
        new Map(
          t.map((track) => [
            `${track.title}|${track.artist}`.toLowerCase(),
            track,
          ]),
        ).values(),
      );
      setLibraryTracks(uniqueTracks);
      setDisplayedTracks(uniqueTracks);
    } catch (err) {
      console.error("failed to load library", err);
    }
  }, [setLibraryTracks, setDisplayedTracks]);

  useEffect(() => {
    if (!tauriReady) return;
    let cancelled = false;
    const init = async () => {
      try {
        const folder = await invoke<string | null>("get_watched_folder");
        if (folder && !cancelled) {
          setWatchedFolder(folder);
          await invoke("rescan_folder", { path: folder });
        }
      } catch (err) {
        console.error("failed to init watched folder", err);
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [tauriReady]);

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
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        unlisten = await listen<WatcherPayload>("watcher-event", (event) => {
          const { title, count } = event.payload;
          const id = Date.now() + Math.random();
          setToasts((prev) => [...prev, { id, title, subtitle: `${count} new track${count > 1 ? "s" : ""}` }]);
          if (count > 0) {
            loadTracks();
          }
        });
      } catch (err) {
        console.error("Failed to listen for watcher events:", err);
      }
    };

    setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, [loadTracks]);

  useEffect(() => {
    if (!isTauri() || !watchedFolder) return;
    let interval: number | undefined;

    interval = window.setInterval(() => {
      invoke("rescan_folder", { path: watchedFolder }).then(() => {
        loadTracks();
      }).catch(() => {});
    }, 300000);

    return () => {
      if (interval) window.clearInterval(interval);
    };
  }, [watchedFolder, loadTracks]);

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
    } finally {
      setScanning(false);
    }
  }, [loadTracks]);

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
    <div className="app-shell">
      <Sidebar
        onAddFolder={handleAddFolder}
        currentView={currentView}
        onNavClick={handleNav}
        scanning={scanning}
        hasFolder={!!watchedFolder}
      />
      <main className="app-main">
        <div className="main-scroll">
          {showFullNow && currentTrack ? (
            <FullscreenNowPlaying onClose={() => setShowFullNow(false)} />
          ) : (
            <>
              {currentView === "now" && (
                <HomeView
                  libraryTracks={libraryTracks}
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
                  displayedTracksSetter={setDisplayedTracks}
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
                  _libraryTracks={libraryTracks}
                  _playTrack={playTrack}
                  onPlaylistClick={handlePlaylistClick}
                />
              )}
              {currentView === "playlist-detail" && selectedPlaylist !== null && (
                <PlaylistDetailView
                  playlistId={selectedPlaylist}
                  playTrack={playTrack}
                  onBack={() => setSelectedPlaylist(null)}
                  currentTrack={currentTrack}
                />
              )}
            </>
          )}
        </div>
      </main>
      <QueuePanel
        displayedTracks={displayedTracks}
        currentTrackIndex={currentTrackIndex}
        playTrack={playTrack}
      />
      <PlayerBar onExpandCurrentTrack={() => setShowFullNow(true)} />
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
