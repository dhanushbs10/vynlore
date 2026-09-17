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

  // Whole-token matching for single-word genres so a folder like "Rocket",
  // "Trapdoor" or "Metallica" isn't mis-tagged as Rock/Hip-Hop/Metal merely
  // because its name contains a genre word. Multi-word phrases (alt-rock,
  // drum-and-bass, r&b, heavy-metal…) still match as contiguous substrings.
  fn has_word(haystack: &str, token: &str) -> bool {
    haystack
      .split(|c: char| !c.is_alphanumeric())
      .any(|w| w == token)
  }
  let has_phrase = |phrase: &str| haystack.contains(phrase);

  if has_word(&haystack, "rock") || has_phrase("alt-rock") || has_word(&haystack, "punk") || has_word(&haystack, "grunge") {
    return "Rock";
  }
  if has_word(&haystack, "electronic") || has_word(&haystack, "edm") || has_word(&haystack, "techno") || has_word(&haystack, "house") || has_word(&haystack, "ambient") || has_phrase("drum-and-bass") || has_word(&haystack, "dubstep") {
    return "Electronic";
  }
  if has_word(&haystack, "jazz") || has_word(&haystack, "soul") || has_word(&haystack, "funk") || has_word(&haystack, "blues") {
    return "Jazz";
  }
  if has_word(&haystack, "classical") || has_word(&haystack, "orchestra") || has_word(&haystack, "piano") || has_word(&haystack, "violin") || has_word(&haystack, "opera") {
    return "Classical";
  }
  if has_phrase("hip-hop") || has_word(&haystack, "rap") || has_word(&haystack, "trap") || has_phrase("r&b") || has_word(&haystack, "rnb") {
    return "Hip-Hop";
  }
  if has_word(&haystack, "pop") || has_phrase("dance-pop") {
    return "Pop";
  }
  if has_word(&haystack, "folk") || has_word(&haystack, "acoustic") || has_phrase("singer-songwriter") {
    return "Folk";
  }
  if has_word(&haystack, "metal") || has_phrase("heavy-metal") || has_phrase("death-metal") || has_phrase("black-metal") {
    return "Metal";
  }
  if has_word(&haystack, "country") || has_word(&haystack, "bluegrass") {
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
  pub track_gain: Option<f64>,
  pub track_peak: Option<f64>,
  pub bitrate: u32,
}

/// (mtime_secs, size_bytes) for a path, or (0,0) when the file can't be
/// stat'ed. Used to skip unchanged files during rescan and to guard against
/// reading files mid-write.
pub fn file_signature(path: &Path) -> (i64, i64) {
  let Ok(m) = std::fs::metadata(path) else { return (0, 0) };
  let size = m.len() as i64;
  let mtime = m
    .modified()
    .ok()
    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
    .map(|d| d.as_secs() as i64)
    .unwrap_or(0);
  (mtime, size)
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
    tag.get_string(&key)
      .and_then(|s| {
        // Tag values can be "3/15" (track no / total) — use the left-hand side.
        let head = s.split('/').next().unwrap_or(&s).trim();
        head.parse().ok().or_else(|| s.parse().ok())
      })
      .unwrap_or(0)
  };

  let props = tagged_file.properties();
  let duration_secs = props.duration().as_secs_f64();
  let sample_rate = props.sample_rate().unwrap_or(0);
  let bit_depth = props.bit_depth().unwrap_or(0) as u32;
  let channels = props.channels().unwrap_or(0);
  let bitrate = props.audio_bitrate().unwrap_or(0);

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
      lofty::MimeType::Jpeg => "jpg",
      // Anything else (BMP/GIF/TIFF/WebP/unknown): sniff the magic bytes so
      // the file lands with an extension viewers can actually decode instead
      // of a lying ".jpg".
      _ => {
        if data.len() >= 12
          && (data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP".as_slice())
            || data.starts_with(b"GIF8"))
        {
          if data.starts_with(b"GIF8") { "gif" } else { "webp" }
        } else if data.len() >= 2 && data.starts_with(b"BM") {
          "bmp"
        } else if data.len() >= 4
          && (data.starts_with(b"\x89PNG") || data.starts_with(b"\xff\xd8\xff"))
        {
          if data.starts_with(b"\x89PNG") { "png" } else { "jpg" }
        } else {
          // Unknown payload: keep the bytes but don't pretend it's a JPEG.
          "bin"
        }
      }
    };
    fs::create_dir_all(cover_dir)?;
    let out_path = cover_dir.join(format!("{:016x}.{}", hash, ext));

    // Identical artwork (same content hash) is already on disk — skip the
    // rewrite instead of churning the file on every scan.
    if !out_path.exists() {
      let mut file = fs::File::create(&out_path)?;
      file.write_all(picture.data())?;
    }
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
    track_gain: None,
    track_peak: None,
    bitrate,
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
