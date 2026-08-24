export interface Track {
  id: number;
  file_path: string;
  title: string;
  artist: string;
  album: string;
  sample_rate: number;
  bit_depth: number;
  channels: number;
  duration_secs: number;
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
