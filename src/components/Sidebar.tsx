import { useCallback } from "react";
import { Search, SlidersHorizontal, Home, Library, Disc3, Users, Mic2, ListMusic } from "lucide-react";

import type { AudioDevice } from "../types";
import type { View } from "../App";

interface Props {
  onAddFolder: () => void;
  onRescan?: () => void;
  currentView: View;
  onNavClick: (view: View) => void;
  scanning: boolean;
  hasFolder: boolean;
  onOpenSearch?: () => void;
  onToggleEq?: () => void;
  devices?: AudioDevice[];
  selectedDevice?: number | null;
  onSelectDevice?: (index: number) => void;
}

export function Sidebar({ onAddFolder, onRescan, currentView, onNavClick, scanning, hasFolder, onOpenSearch, onToggleEq, devices, selectedDevice, onSelectDevice }: Props) {
  const mainItems: { label: string; view: View; icon: typeof Home }[] = [
    { label: "Home", view: "now", icon: Home },
    { label: "Library", view: "browse", icon: Library },
    { label: "Albums", view: "albums", icon: Disc3 },
    { label: "Artists", view: "artists", icon: Users },
    { label: "Genres", view: "genres", icon: Mic2 },
    { label: "Playlists", view: "playlists", icon: ListMusic },
  ];

  const handleClick = useCallback((view: View) => {
    onNavClick(view);
  }, [onNavClick]);

  return (
    <aside className="w-[232px] h-full bg-bg border-r border-border flex flex-col shrink-0">
      <div className="px-5 pt-6 pb-4 font-display text-lg font-bold tracking-[5px] text-text">
        VYNLORE
      </div>

      <button
        className="flex items-center gap-2.5 w-[calc(100%-28px)] mx-3.5 mb-2 px-3 py-2 border border-border text-sm text-text-secondary hover:text-text transition-colors cursor-pointer"
        onClick={onOpenSearch}
        aria-label="Search library"
      >
        <Search size={14} />
        <span>Search</span>
        <span className="ml-auto text-[10px] font-semibold text-text-muted border border-border-hover rounded px-1.5 py-0.5">
          Ctrl K
        </span>
      </button>

      <button
        className="flex items-center gap-2.5 w-[calc(100%-28px)] mx-3.5 mb-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text transition-colors cursor-pointer"
        onClick={onToggleEq}
        aria-label="Toggle equalizer"
      >
        <SlidersHorizontal size={14} />
        <span>Equalizer</span>
      </button>

      {devices && devices.length > 1 && onSelectDevice && (
        <div className="w-[calc(100%-28px)] mx-3.5 mb-3">
          <select
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg-raised text-text text-xs cursor-pointer focus:outline-none focus:border-white/30 transition-colors appearance-none"
            value={selectedDevice ?? ""}
            onChange={(e) => onSelectDevice(Number(e.target.value))}
          >
            <option value="">System Default</option>
            {devices.map((d) => (
              <option key={d.index} value={d.index}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      <ul className="list-none flex-1 mx-3.5 space-y-0.5 overflow-y-auto">
        {mainItems.map((item) => {
          const isActive = currentView === item.view;
          return (
            <li
              key={item.view}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] font-medium cursor-pointer transition-colors select-none ${
                isActive
                  ? "bg-white/5 text-white"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text"
              }`}
              onClick={() => handleClick(item.view)}
            >
              <item.icon size={16} strokeWidth={1.9} />
              {item.label}
            </li>
          );
        })}
      </ul>

      <div className="p-3 border-t border-border flex gap-2">
        <button
          disabled={scanning}
          className="flex-1 py-2 px-3 border border-border text-sm font-medium text-text-secondary cursor-pointer hover:text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={onAddFolder}
        >
          {scanning ? "Scanning…" : hasFolder ? "Change Folder" : "+ Add Folder"}
        </button>
        {hasFolder && !scanning && onRescan && (
          <button
            className="py-2 px-2.5 border border-border text-sm font-medium text-text-secondary cursor-pointer hover:text-text transition-colors"
            onClick={onRescan}
          >
            ↻
          </button>
        )}
      </div>
    </aside>
  );
}
