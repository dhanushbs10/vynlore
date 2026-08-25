import { useCallback } from "react";
import { Search, SlidersHorizontal, Home, Library, Disc3, Users, Mic2, ListMusic } from "lucide-react";
import { motion } from "framer-motion";

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
    <aside className="w-[232px] h-screen bg-bg border-r border-border flex flex-col shrink-0">
      <div className="px-6 pt-7 pb-5 font-display text-lg font-bold tracking-[5px] text-text">
        VYNLORE
      </div>

      <motion.button
        whileTap={{ scale: 0.95 }}
        className="flex items-center gap-2.5 w-[calc(100%-28px)] mx-3.5 mb-2.5 px-3 py-2.5 bg-bg-raised border border-border rounded-lg text-sm text-text-secondary hover:border-border-hover hover:text-text transition-colors cursor-pointer"
        onClick={onOpenSearch}
        aria-label="Search library"
      >
        <Search size={14} />
        <span>Search</span>
        <span className="ml-auto text-[10px] font-semibold text-text-muted border border-border-hover rounded px-1.5 py-0.5">
          Ctrl K
        </span>
      </motion.button>

      <motion.button
        whileTap={{ scale: 0.95 }}
        className="flex items-center gap-2.5 w-[calc(100%-28px)] mx-3.5 mb-3 px-3 py-2.5 rounded-lg text-sm text-text-secondary hover:bg-bg-hover hover:text-text transition-colors cursor-pointer"
        onClick={onToggleEq}
        aria-label="Toggle equalizer"
      >
        <SlidersHorizontal size={14} />
        <span>Equalizer</span>
      </motion.button>

      <ul className="list-none flex-1 mx-3.5 space-y-0.5 overflow-y-auto">
        {mainItems.map((item) => {
          const isActive = currentView === item.view;
          return (
            <li
              key={item.view}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13.5px] font-medium cursor-pointer relative transition-colors select-none ${
                isActive
                  ? "bg-accent-soft text-accent font-semibold"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text"
              }`}
              onClick={() => handleClick(item.view)}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-pill"
                  className="absolute inset-0 rounded-lg bg-accent-soft"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2.5">
                <item.icon size={16} strokeWidth={1.9} />
                {item.label}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="p-3.5 border-t border-border">
        <motion.button
          whileTap={{ scale: 0.95 }}
          className="w-full py-2.5 px-3.5 rounded-lg border border-dashed border-border-hover bg-transparent text-sm font-medium text-text-secondary cursor-pointer hover:border-accent hover:text-accent hover:bg-accent-soft transition-all"
          onClick={onAddFolder}
        >
          {scanning ? "Scanning…" : hasFolder ? "Change Folder" : "+ Add Folder"}
        </motion.button>
      </div>
    </aside>
  );
}
