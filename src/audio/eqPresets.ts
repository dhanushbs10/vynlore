export const EQ_BANDS_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_MAX_GAIN = 12;

export type EqGains = number[];

function p(...gains: number[]): EqGains {
    if (gains.length !== EQ_BANDS_HZ.length) throw new Error("bad preset length");
    return gains;
}

export interface EqPreset {
    key: string;
    label: string;
    gains: EqGains;
}

export const EQ_PRESETS: EqPreset[] = [
    { key: "flat", label: "Flat", gains: p(0, 0, 0, 0, 0, 0, 0, 0, 0, 0) },
    { key: "rock", label: "Rock", gains: p(4.8, 3.8, 2.9, 0.5, -2.0, -1.0, 1.5, 3.0, 4.0, 4.5) },
    { key: "pop", label: "Pop", gains: p(-1.0, 0.5, 2.5, 4.0, 3.5, 1.0, -0.5, -1.5, -1.0, -0.5) },
    { key: "jazz", label: "Jazz", gains: p(3.0, 2.0, 1.0, 1.5, -1.0, -1.0, 0.0, 1.5, 2.5, 3.0) },
    { key: "classical", label: "Classical", gains: p(3.5, 3.0, 2.5, 1.5, -0.5, -0.5, 0.0, 1.5, 2.5, 3.5) },
    { key: "electronic", label: "Electronic", gains: p(4.5, 3.5, 1.0, 0.0, -1.5, 1.5, 0.5, 1.0, 3.5, 4.0) },
    { key: "hiphop", label: "Hip-Hop", gains: p(5.5, 4.5, 2.5, 1.0, -0.5, -0.5, 1.0, -0.5, 1.5, 2.0) },
    { key: "folk", label: "Folk", gains: p(2.0, 1.5, 0.5, 1.0, 2.0, 2.5, 2.0, 1.5, 1.0, 0.5) },
    { key: "metal", label: "Metal", gains: p(4.5, 3.5, 2.0, -1.0, -2.5, -1.0, 2.0, 3.5, 4.5, 4.5) },
    { key: "country", label: "Country", gains: p(2.5, 2.0, 1.0, 0.5, -0.5, 0.0, 1.0, 1.5, 2.0, 2.0) },
    { key: "bass", label: "Bass Boost", gains: p(7, 6, 5, 3, 1, 0, 0, 0, 0, 0) },
    { key: "treble", label: "Treble Boost", gains: p(0, 0, 0, 0, 0, 1, 2, 4, 6, 7) },
    { key: "vocal", label: "Vocal", gains: p(-2.0, -1.0, 0.0, 2.5, 4.0, 4.0, 3.0, 1.0, -0.5, -1.5) },
];

// Maps library genre names (as inferred/stored by the scanner) to presets.
const GENRE_ALIASES: Record<string, string> = {
    rock: "rock",
    "alt-rock": "rock",
    punk: "rock",
    grunge: "rock",
    pop: "pop",
    "dance-pop": "pop",
    jazz: "jazz",
    blues: "jazz",
    soul: "jazz",
    funk: "jazz",
    classical: "classical",
    orchestra: "classical",
    opera: "classical",
    electronic: "electronic",
    edm: "electronic",
    techno: "electronic",
    house: "electronic",
    ambient: "electronic",
    "drum-and-bass": "electronic",
    dubstep: "electronic",
    "hip-hop": "hiphop",
    rap: "hiphop",
    trap: "hiphop",
    "r&b": "hiphop",
    rnb: "hiphop",
    folk: "folk",
    acoustic: "folk",
    metal: "metal",
    "heavy-metal": "metal",
    "death-metal": "metal",
    "black-metal": "metal",
    country: "country",
    bluegrass: "country",
};

export function presetForGenre(genre?: string | null): EqPreset | null {
    if (!genre) return null;
    const key = GENRE_ALIASES[genre.trim().toLowerCase()];
    if (!key) return null;
    return EQ_PRESETS.find((pr) => pr.key === key) ?? null;
}
