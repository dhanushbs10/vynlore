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
  pub sample_rate: u32,
  pub bit_depth: u32,
  pub channels: u8,
  pub duration_secs: f64,
  pub track_number: u32,
  pub disc_number: u32,
  pub cover_path: String,
  pub lyrics: String,
}

impl TrackMetadata {
  pub fn placeholder(file_path: &Path) -> Self {
    Self {
      title: file_path.file_stem().unwrap_or_default().to_string_lossy().to_string(),
      artist: "Unknown Artist".to_string(),
      album: "Unknown Album".to_string(),
      genre: String::new(),
      sample_rate: 0,
      bit_depth: 0,
      channels: 0,
      duration_secs: 0.0,
      track_number: 0,
      disc_number: 0,
      cover_path: String::new(),
      lyrics: String::new(),
    }
  }
}

pub fn read_metadata(path: &Path) -> Result<TrackMetadata, Box<dyn std::error::Error>> {
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

  let mut cover_path = String::new();

  if let Some(picture) = tag.pictures().first() {
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let cache_dir = dirs::cache_dir()
      .unwrap_or_else(|| Path::new(".").to_path_buf())
      .join("vynlore-art");
    fs::create_dir_all(&cache_dir)?;
    let out_path = cache_dir.join(format!("{}.jpg", stem));

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
      return format!("{:?}", item.value());
    }
  }

  String::new()
}
