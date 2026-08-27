export interface SkinColors {
  bg: string;
  "bg-raised": string;
  "bg-surface": string;
  "bg-hover": string;
  "bg-elevated": string;
  text: string;
  "text-secondary": string;
  "text-muted": string;
  tint: string;
  shade: string;
  accent: string;
  "accent-glow"?: string;
  border?: string;
  "border-hover"?: string;
  success?: string;
  danger?: string;
}

export interface Skin {
  name: string;
  colors: SkinColors;
  vars?: Record<string, string>;
  css?: string;
}

export const DEFAULT_COLORS: SkinColors = {
  bg: "#000000",
  "bg-raised": "#0d0d0d",
  "bg-surface": "#141414",
  "bg-hover": "#1a1a1a",
  "bg-elevated": "#111111",
  text: "#ffffff",
  "text-secondary": "#888888",
  "text-muted": "#555555",
  tint: "#ffffff",
  shade: "#000000",
  accent: "#ffffff",
  "accent-glow": "transparent",
  success: "#34d399",
  danger: "#f87171",
};

export function effectiveColors(colors: Partial<SkinColors> | undefined): SkinColors {
  return { ...DEFAULT_COLORS, ...colors };
}

export function parseSkin(raw: string): Skin | null {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null) return null;
    if (typeof obj.name !== "string" || !obj.name.trim()) return null;

    const skin: Skin = { name: obj.name.trim(), colors: DEFAULT_COLORS };

    if (typeof obj.colors === "object" && obj.colors !== null) {
      const merged: SkinColors = { ...DEFAULT_COLORS };
      for (const [k, v] of Object.entries(obj.colors)) {
        if (typeof v === "string") {
          (merged as unknown as Record<string, string>)[k] = v;
        } else {
          return null;
        }
      }
      skin.colors = merged;
    }

    if (obj.vars !== undefined) {
      if (typeof obj.vars !== "object" || obj.vars === null) return null;
      const vars: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj.vars)) {
        if (!k.startsWith("--") || typeof v !== "string") return null;
        vars[k] = v;
      }
      if (Object.keys(vars).length > 0) skin.vars = vars;
    }

    if (obj.css !== undefined) {
      if (typeof obj.css !== "string") return null;
      if (obj.css.trim().length > 0) skin.css = obj.css;
    }

    return skin;
  } catch {
    return null;
  }
}

const SKIN_STYLE_ID = "vynlore-skin-css";

function applySkinCss(css: string | undefined) {
  let style = document.getElementById(SKIN_STYLE_ID) as HTMLStyleElement | null;
  if (!css || css.trim().length === 0) {
    if (style) {
      style.textContent = "";
      style.remove();
    }
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = SKIN_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

export function applyTheme(colors: SkinColors, skin?: Skin): void {
  const r = document.documentElement.style;
  const tint = colors.tint;
  r.setProperty("--color-bg", colors.bg);
  r.setProperty("--color-bg-raised", colors["bg-raised"]);
  r.setProperty("--color-bg-surface", colors["bg-surface"]);
  r.setProperty("--color-bg-hover", colors["bg-hover"]);
  r.setProperty("--color-bg-elevated", colors["bg-elevated"]);
  r.setProperty("--color-text", colors.text);
  r.setProperty("--color-text-secondary", colors["text-secondary"]);
  r.setProperty("--color-text-muted", colors["text-muted"]);
  r.setProperty("--color-white", tint);
  r.setProperty("--color-black", colors.shade);
  r.setProperty("--color-accent", colors.accent);
  r.setProperty("--color-accent-glow", colors["accent-glow"] ?? "transparent");
  r.setProperty("--color-border", colors.border ?? "color-mix(in srgb, var(--color-white) 8%, transparent)");
  r.setProperty("--color-border-hover", colors["border-hover"] ?? "color-mix(in srgb, var(--color-white) 15%, transparent)");
  r.setProperty("--color-success", colors.success ?? DEFAULT_COLORS.success!);
  r.setProperty("--color-danger", colors.danger ?? DEFAULT_COLORS.danger!);

  if (skin?.vars) {
    for (const [k, v] of Object.entries(skin.vars)) {
      r.setProperty(k, v);
    }
  }
  applySkinCss(skin?.css);
}

export function fileNameForSkin(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9 \-_]/g, "_")
    .trim()
    .replace(/\s+/g, " ");
  const base = cleaned.length === 0 ? "Untitled theme" : cleaned;
  return `${base}.json`;
}

export interface BuiltIn {
  id: string;
  name: string;
  colors: SkinColors;
}

export const BUILTIN_THEMES: BuiltIn[] = [
  {
    id: "onyx",
    name: "Onyx",
    colors: DEFAULT_COLORS,
  },
  {
    id: "midnight",
    name: "Midnight",
    colors: {
      bg: "#05070f",
      "bg-raised": "#0c101f",
      "bg-surface": "#131a2e",
      "bg-hover": "#1c2540",
      "bg-elevated": "#0f1526",
      text: "#e8ecff",
      "text-secondary": "#93a0c8",
      "text-muted": "#5a658c",
      tint: "#dbe4ff",
      shade: "#000000",
      accent: "#7aa2ff",
      "accent-glow": "#7aa2ff33",
      success: "#34d399",
      danger: "#f87171",
    },
  },
  {
    id: "steel",
    name: "Steel",
    colors: {
      bg: "#0a0c0f",
      "bg-raised": "#12151a",
      "bg-surface": "#1a1e24",
      "bg-hover": "#22262e",
      "bg-elevated": "#14171c",
      text: "#f2f5f8",
      "text-secondary": "#9aa4af",
      "text-muted": "#5d6670",
      tint: "#eaeef3",
      shade: "#000000",
      accent: "#8fb3d9",
      "accent-glow": "#8fb3d933",
      success: "#34d399",
      danger: "#f87171",
    },
  },
  {
    id: "violet",
    name: "Violet",
    colors: {
      bg: "#0d0714",
      "bg-raised": "#170e24",
      "bg-surface": "#211335",
      "bg-hover": "#2a1a46",
      "bg-elevated": "#180e28",
      text: "#f3ecff",
      "text-secondary": "#a897d6",
      "text-muted": "#6b5c99",
      tint: "#e9deff",
      shade: "#050208",
      accent: "#a78bfa",
      "accent-glow": "#a78bfa40",
      success: "#34d399",
      danger: "#f87171",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    colors: {
      bg: "#041018",
      "bg-raised": "#0a1b26",
      "bg-surface": "#102837",
      "bg-hover": "#173446",
      "bg-elevated": "#0c1f2b",
      text: "#e6f7ff",
      "text-secondary": "#7fb8d4",
      "text-muted": "#45738f",
      tint: "#d6f2ff",
      shade: "#000a10",
      accent: "#22d3ee",
      "accent-glow": "#22d3ee33",
      success: "#34d399",
      danger: "#f87171",
    },
  },
  {
    id: "mint",
    name: "Mint",
    colors: {
      bg: "#04120b",
      "bg-raised": "#0b1d12",
      "bg-surface": "#12291a",
      "bg-hover": "#1a3824",
      "bg-elevated": "#0d2215",
      text: "#eafff1",
      "text-secondary": "#86c9a4",
      "text-muted": "#4c7d63",
      tint: "#e2ffee",
      shade: "#02100a",
      accent: "#34d399",
      "accent-glow": "#34d39933",
      success: "#34d399",
      danger: "#f87171",
    },
  },
  {
    id: "amber",
    name: "Amber",
    colors: {
      bg: "#120c04",
      "bg-raised": "#201708",
      "bg-surface": "#2d200c",
      "bg-hover": "#3a2a10",
      "bg-elevated": "#241a09",
      text: "#fff4e0",
      "text-secondary": "#d4b98a",
      "text-muted": "#9a7f52",
      tint: "#ffe9c4",
      shade: "#0a0602",
      accent: "#fbbf24",
      "accent-glow": "#fbbf2433",
      success: "#34d399",
      danger: "#f87171",
    },
  },
  {
    id: "rose",
    name: "Rose",
    colors: {
      bg: "#140508",
      "bg-raised": "#230a12",
      "bg-surface": "#31101a",
      "bg-hover": "#401a26",
      "bg-elevated": "#280d15",
      text: "#ffe9ee",
      "text-secondary": "#d98b9d",
      "text-muted": "#9c5c6d",
      tint: "#ffdde6",
      shade: "#0a0205",
      accent: "#fb7185",
      "accent-glow": "#fb718533",
      success: "#34d399",
      danger: "#f87171",
    },
  },
  {
    id: "paper",
    name: "Paper",
    colors: {
      bg: "#f7f7f5",
      "bg-raised": "#ffffff",
      "bg-surface": "#ececea",
      "bg-hover": "#e0e0dd",
      "bg-elevated": "#f2f2f0",
      text: "#17171a",
      "text-secondary": "#5a5a60",
      "text-muted": "#9a9aa0",
      tint: "#1a1a1f",
      shade: "#000000",
      accent: "#2563eb",
      "accent-glow": "#2563eb2e",
      success: "#15803d",
      danger: "#dc2626",
    },
  },
];