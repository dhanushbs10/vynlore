use lofty::{AudioFile, ItemKey};
use std::fs;
use std::io::Write;
use std::path::Path;

pub fn infer_genre_from_path(file_path: &Path, folder_path: &Path) -> &'static str {
  let haystack = format!(
    "{} {}",
    file_path.to_string_lossy().to_lowercase(),
    folder_path.to_string_lossy().to_lowercase()
  );

  if haystack.contains("rock") || haystack.contains("alt-rock") || haystack.contains("punk") || haystack.contains("grunge") {
    return "Rock";
  }
  if haystack.contains("electronic") || haystack.contains("edm") || haystack.contains("techno") || haystack.contains("house") || haystack.contains("ambient") || haystack.contains("drum-and-bass") || haystack.contains("dubstep") {
    return "Electronic";
  }
  if haystack.contains("jazz") || haystack.contains("soul") || haystack.contains("funk") || haystack.contains("blues") {
    return "Jazz";
  }
  if haystack.contains("classical") || haystack.contains("orchestra") || haystack.contains("piano") || haystack.contains("violin") || haystack.contains("opera") {
    return "Classical";
  }
  if haystack.contains("hip-hop") || haystack.contains("rap") || haystack.contains("trap") || haystack.contains("r&b") || haystack.contains("rnb") {
    return "Hip-Hop";
  }
  if haystack.contains("pop") || haystack.contains("dance-pop") {
    return "Pop";
  }
  if haystack.contains("folk") || haystack.contains("acoustic") || haystack.contains("singer-songwriter") {
    return "Folk";
  }
  if haystack.contains("metal") || haystack.contains("heavy-metal") || haystack.contains("death-metal") || haystack.contains("black-metal") {
    return "Metal";
  }
  if haystack.contains("country") || haystack.contains("bluegrass") {
    return "Country";
  }

  "Uncategorized"
}

#[derive(Debug, Clone)]
pub struct TrackMetadata {
  pub title: String,
  pub artist: String,
  pub album: String,
  pub genre: String,
  pub format: String,
  pub sample_rate: u32,
  pub bit_depth: u32,
  pub channels: u8,
  pub duration_secs: f64,
  pub track_number: u32,
  pub disc_number: u32,
  pub cover_path: String,
  pub lyrics: String,
}

/// Extensions the scanner/watcher accept. Keep in sync with the enabled
/// Symphonia features (no Opus codec in symphonia 0.5 — .opus demuxes but
/// cannot decode).
const SUPPORTED_EXTENSIONS: &[(&str, &str)] = &[
  ("flac", "FLAC"),
  ("wav", "WAV"),
  ("wave", "WAV"),
  ("aiff", "AIFF"),
  ("aif", "AIFF"),
  ("aifc", "AIFF"),
  ("mp3", "MP3"),
  ("m4a", "M4A"),
  ("m4b", "M4A"),
  ("ogg", "OGG"),
  ("oga", "OGG"),
];

pub fn is_supported_extension(ext: &str) -> bool {
  SUPPORTED_EXTENSIONS.iter().any(|(e, _)| ext.eq_ignore_ascii_case(e))
}

pub fn format_label_for(ext: &str) -> Option<&'static str> {
  SUPPORTED_EXTENSIONS
    .iter()
    .find(|(e, _)| ext.eq_ignore_ascii_case(e))
    .map(|(_, label)| *label)
}

pub fn read_metadata(path: &Path, cover_dir: &Path) -> Result<TrackMetadata, Box<dyn std::error::Error>> {
  let tagged_file = lofty::read_from_path(path, true)?;
  let tag = match tagged_file.primary_tag() {
    Some(t) => t,
    None => tagged_file.first_tag().ok_or("No tags found in file")?,
  };

  let get_str = |key: ItemKey, default: &str| -> String {
    tag.get_string(&key).map(|s| s.to_string()).unwrap_or_else(|| default.to_string())
  };

  let get_num = |key: ItemKey| -> u32 {
    tag.get_string(&key).and_then(|s| s.parse().ok()).unwrap_or(0)
  };

  let props = tagged_file.properties();
  let duration_secs = props.duration().as_secs_f64();
  let sample_rate = props.sample_rate().unwrap_or(0);
  let bit_depth = props.bit_depth().unwrap_or(0) as u32;
  let channels = props.channels().unwrap_or(0);

  let format = path
    .extension()
    .and_then(|e| e.to_str())
    .and_then(format_label_for)
    .unwrap_or("UNKNOWN")
    .to_string();

  let mut cover_path = String::new();

  if let Some(picture) = tag.pictures().first() {
    let data = picture.data();
    let len = data.len() as u64;
    let mut hash: u64 = len;
    if !data.is_empty() {
        hash = hash.wrapping_mul(0x100000001b3).wrapping_add(data[0] as u64);
        hash = hash.wrapping_mul(0x100000001b3).wrapping_add(data[data.len() - 1] as u64);
        let step = if data.len() > 128 { 16 } else { 1 };
        for (i, &b) in data.iter().enumerate().skip(1).take(data.len().saturating_sub(2)) {
            if i % step == 0 {
                hash = hash.wrapping_mul(0x100000001b3).wrapping_add(b as u64);
            }
        }
    }
    let ext = match picture.mime_type() {
      lofty::MimeType::Png => "png",
      _ => "jpg",
    };
    fs::create_dir_all(cover_dir)?;
    let out_path = cover_dir.join(format!("{:016x}.{}", hash, ext));

    let mut file = fs::File::create(&out_path)?;
    file.write_all(picture.data())?;
    cover_path = out_path.to_string_lossy().to_string();
  }

  Ok(TrackMetadata {
    title: get_str(ItemKey::TrackTitle, &path.file_stem().unwrap_or_default().to_string_lossy()),
    artist: get_str(ItemKey::TrackArtist, "Unknown Artist"),
    album: get_str(ItemKey::AlbumTitle, "Unknown Album"),
    genre: get_str(ItemKey::Genre, ""),
    format,
    sample_rate,
    bit_depth,
    channels,
    duration_secs,
    track_number: get_num(ItemKey::TrackNumber),
    disc_number: get_num(ItemKey::DiscNumber),
    cover_path,
    lyrics: get_lyrics(tag),
  })
}

fn get_lyrics(tag: &lofty::Tag) -> String {
  if let Some(lyrics) = tag.get_string(&ItemKey::Lyrics) {
    return lyrics.to_string();
  }

  for item in tag.items() {
    if *item.key() == ItemKey::Lyrics {
      if let lofty::ItemValue::Text(s) = item.value() {
        return s.clone();
      }
    }
  }

  String::new()
}
