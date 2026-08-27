import { createContext, useContext, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  BUILTIN_THEMES,
  Skin,
  applyTheme,
  fileNameForSkin,
  parseSkin,
} from "../themes";

const STORAGE_KEY = "vynlore.theme";
const DEFAULT_ID = BUILTIN_THEMES[0].id;

export const builtinId = (id: string) => `builtin:${id}`;
export const customId = (fileName: string) => `custom:${fileName}`;

interface ThemeContextValue {
  currentId: string;
  builtins: typeof BUILTIN_THEMES;
  custom: Skin[];
  setTheme: (id: string) => void;
  importTheme: () => Promise<void>;
  exportTheme: (id: string) => Promise<void>;
  deleteTheme: (id: string) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function findSkin(id: string, custom: Skin[]): Skin | null {
  if (id.startsWith("builtin:")) {
    const b = BUILTIN_THEMES.find((t) => builtinId(t.id) === id);
    return b ? { name: b.name, colors: b.colors } : null;
  }
  if (id.startsWith("custom:")) {
    const fileName = id.slice("custom:".length);
    return custom.find((c) => fileNameForSkin(c.name) === fileName) ?? null;
  }
  return null;
}

function applyById(id: string, custom: Skin[]) {
  const skin = findSkin(id, custom);
  if (skin) applyTheme(skin.colors, skin);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [currentId, setCurrentId] = useState<string>(DEFAULT_ID);
  const [custom, setCustom] = useState<Skin[]>([]);

  useEffect(() => {
    (async () => {
      let customList: Skin[] = [];
      try {
        const raws = await invoke<string[]>("list_theme_files");
        customList = raws
          .map(parseSkin)
          .filter((s): s is Skin => s !== null);
      } catch {
        // backend unavailable (plain vite) — built-ins still work
      }
      setCustom(customList);

      const saved = localStorage.getItem(STORAGE_KEY);
      const valid =
        saved &&
        (saved.startsWith("builtin:") || saved.startsWith("custom:")) &&
        findSkin(saved, customList) !== null;
      const target = valid ? saved! : DEFAULT_ID;
      setCurrentId(target);
      localStorage.setItem(STORAGE_KEY, target);
      applyById(target, customList);
    })();
  }, []);

  const setTheme = (id: string) => {
    if (findSkin(id, custom) === null) return;
    setCurrentId(id);
    localStorage.setItem(STORAGE_KEY, id);
    applyById(id, custom);
  };

  const importTheme = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Vynlore theme", extensions: ["json"] }],
      });
      if (typeof selected !== "string") return;
      const raw = await invoke<string>("read_text_file", { path: selected });
      const skin = parseSkin(raw);
      if (!skin) {
        console.error("Invalid theme file");
        return;
      }
      const fileName = fileNameForSkin(skin.name);
      await invoke("save_theme_file", {
        fileName,
        content: JSON.stringify(skin),
      });
      const raws = await invoke<string[]>("list_theme_files");
      const customList = raws
        .map(parseSkin)
        .filter((s): s is Skin => s !== null);
      setCustom(customList);
      const id = customId(fileName);
      setCurrentId(id);
      localStorage.setItem(STORAGE_KEY, id);
      applyById(id, customList);
    } catch (e) {
      console.error(e);
    }
  };

  const exportTheme = async (id: string) => {
    const skin = findSkin(id, custom);
    if (!skin) return;
    try {
      const fileName = fileNameForSkin(skin.name);
      const target = await save({
        defaultPath: fileName,
        filters: [{ name: "Vynlore theme", extensions: ["json"] }],
      });
      if (typeof target !== "string") return;
      await invoke("export_theme_file", {
        fileName,
        targetPath: target,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const deleteTheme = async (id: string) => {
    if (!id.startsWith("custom:")) return;
    const fileName = id.slice("custom:".length);
    try {
      await invoke("delete_theme_file", { fileName });
      const raws = await invoke<string[]>("list_theme_files");
      const customList = raws
        .map(parseSkin)
        .filter((s): s is Skin => s !== null);
      setCustom(customList);
      const resetId = DEFAULT_ID;
      setCurrentId(resetId);
      localStorage.setItem(STORAGE_KEY, resetId);
      applyById(resetId, customList);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <ThemeContext.Provider
      value={{ currentId, builtins: BUILTIN_THEMES, custom, setTheme, importTheme, exportTheme, deleteTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemes(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemes must be used inside ThemeProvider");
  return ctx;
}