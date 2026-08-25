import { useCallback } from "react";
import { Search, SlidersHorizontal, Home, Library, Disc3, Users, Mic2, ListMusic } from "lucide-react";

interface Props {
  onAddFolder: () => void;
  currentView: string;
  onNavClick: (view: string) => void;
  scanning: boolean;
  hasFolder: boolean;
  onOpenSearch?: () => void;
  onToggleEq?: () => void;
}

export function Sidebar({ onAddFolder, currentView, onNavClick, scanning, hasFolder, onOpenSearch, onToggleEq }: Props) {
  const mainItems = [
    { label: "Home", view: "now", icon: Home },
    { label: "Library", view: "browse", icon: Library },
    { label: "Albums", view: "albums", icon: Disc3 },
    { label: "Artists", view: "artists", icon: Users },
    { label: "Genres", view: "genres", icon: Mic2 },
    { label: "Playlists", view: "playlists", icon: ListMusic },
  ];

  const handleClick = useCallback((view: string) => {
    onNavClick(view);
  }, [onNavClick]);

  return (
    <aside className="app-sidebar">
      <div className="sidebar-logo">VYNLORE</div>

      <button
        className="sidebar-search-btn"
        onClick={onOpenSearch}
        aria-label="Search library"
      >
        <Search size={14} />
        <span>Search</span>
        <span className="sidebar-search-kbd">Ctrl K</span>
      </button>

      <button
        className="sidebar-eq-btn"
        onClick={onToggleEq}
        aria-label="Toggle equalizer"
      >
        <SlidersHorizontal size={14} />
        <span>Equalizer</span>
      </button>

      <ul className="sidebar-nav">
        {mainItems.map((item) => (
          <li
            key={item.view}
            className={`sidebar-item ${currentView === item.view ? "active" : ""}`}
            onClick={() => handleClick(item.view)}
          >
            <item.icon size={16} strokeWidth={1.9} />
            {item.label}
          </li>
        ))}
      </ul>

      <div className="sidebar-bottom">
        <button className="add-folder-btn" onClick={onAddFolder}>
          {scanning ? "Scanning…" : hasFolder ? "Change Folder" : "+ Add Folder"}
        </button>
      </div>
    </aside>
  );
}
