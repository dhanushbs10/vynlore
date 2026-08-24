import { useCallback } from "react";

interface Props {
  onAddFolder: () => void;
  currentView: string;
  onNavClick: (view: string) => void;
  scanning: boolean;
  hasFolder: boolean;
}

export function Sidebar({ onAddFolder, currentView, onNavClick, scanning, hasFolder }: Props) {
  const mainItems = [
    { label: "Home", view: "now" },
    { label: "Library", view: "browse" },
    { label: "Albums", view: "albums" },
    { label: "Artists", view: "artists" },
    { label: "Genres", view: "genres" },
    { label: "Playlists", view: "playlists" },
  ];

  const handleClick = useCallback((view: string) => {
    onNavClick(view);
  }, [onNavClick]);

  return (
    <aside className="app-sidebar">
      <div className="sidebar-logo">VYNLORE</div>

      <ul className="sidebar-nav">
        {mainItems.map((item) => (
          <li
            key={item.view}
            className={`sidebar-item ${currentView === item.view ? "active" : ""}`}
            onClick={() => handleClick(item.view)}
          >
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
