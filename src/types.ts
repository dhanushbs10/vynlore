export interface Track {
  id: number;
  file_path: string;
  title: string;
  artist: string;
  album: string;
  genre?: string | null;
  sample_rate: number;
  bit_depth: number;
  channels: number;
  duration_secs: number;
  track_number: number;
  disc_number: number;
  cover_path?: string | null;
  lyrics?: string | null;
  format: string;
  play_count: number;
}

export interface AudioDevice {
  index: number;
  name: string;
}

export interface ToastMessage {
  id: number;
  title: string;
  subtitle?: string;
}

export type RepeatMode = "off" | "all" | "one";
