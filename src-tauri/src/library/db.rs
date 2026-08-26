use rusqlite::{Connection, Result};
use std::path::Path;

pub const UPSERT_TRACK_SQL: &str = "INSERT INTO tracks (
        file_path, title, artist, album, genre,
        sample_rate, bit_depth, channels, duration_secs,
        track_number, disc_number, watched_folder, cover_path, lyrics, format
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
      ON CONFLICT(file_path) DO UPDATE SET
        title=excluded.title,
        artist=excluded.artist,
        album=excluded.album,
        genre=excluded.genre,
        sample_rate=excluded.sample_rate,
        bit_depth=excluded.bit_depth,
        channels=excluded.channels,
        duration_secs=excluded.duration_secs,
        track_number=excluded.track_number,
        disc_number=excluded.disc_number,
        cover_path=excluded.cover_path,
        lyrics=excluded.lyrics,
        format=excluded.format";

pub struct LibraryDb {
  pub conn: Connection,
}

/// Shared 16-field track row: (id, file_path, title, artist, album, genre,
/// sample_rate, bit_depth, channels, duration_secs, track_number, disc_number,
/// cover_path, lyrics, format, play_count).
pub type TrackRow = (
  i64,
  String,
  String,
  String,
  String,
  Option<String>,
  u32,
  u32,
  u8,
  f64,
  i64,
  i64,
  Option<String>,
  Option<String>,
  String,
  i64,
);

fn map_track_row(
  row: &rusqlite::Row<'_>,
) -> rusqlite::Result<TrackRow> {
  Ok((
    row.get(0)?,
    row.get(1)?,
    row.get(2)?,
    row.get(3)?,
    row.get(4)?,
    row.get::<_, Option<String>>(5)?,
    row.get(6)?,
    row.get(7)?,
    row.get::<_, i64>(8)? as u8,
    row.get(9)?,
    row.get(10)?,
    row.get(11)?,
    if row.get::<_, String>(12)?.is_empty() { None } else { Some(row.get(12)?) },
    if row.get::<_, String>(13)?.is_empty() { None } else { Some(row.get(13)?) },
    row.get(14)?,
    row.get(15)?,
  ))
}

impl LibraryDb {
  pub fn new(path: &Path) -> Result<Self> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE NOT NULL,
        title TEXT,
        artist TEXT,
        album TEXT,
        genre TEXT,
        sample_rate INTEGER,
        bit_depth INTEGER,
        channels INTEGER,
        duration_secs REAL,
        track_number INTEGER,
        disc_number INTEGER,
        watched_folder TEXT,
        cover_path TEXT,
        lyrics TEXT
      );",
    )?;
    if let Err(e) = conn.execute("ALTER TABLE tracks ADD COLUMN cover_path TEXT", []) {
      eprintln!("[db] migration warning: {}", e);
    }
    if let Err(e) = conn.execute("ALTER TABLE tracks ADD COLUMN lyrics TEXT", []) {
      eprintln!("[db] migration warning: {}", e);
    }
    if let Err(e) = conn.execute(
      "ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0",
      [],
    ) {
      eprintln!("[db] migration warning: {}", e);
    }
    if let Err(e) = conn.execute("ALTER TABLE tracks ADD COLUMN last_played INTEGER", []) {
      eprintln!("[db] migration warning: {}", e);
    }
    if let Err(e) = conn.execute(
      "ALTER TABLE tracks ADD COLUMN format TEXT NOT NULL DEFAULT ''",
      [],
    ) {
      eprintln!("[db] migration warning: {}", e);
    }
    if let Err(e) = conn.execute("ALTER TABLE tracks ADD COLUMN waveform BLOB", []) {
      eprintln!("[db] migration warning: {}", e);
    }
    if let Err(e) = conn.execute_batch(
      "CREATE INDEX IF NOT EXISTS idx_tracks_last_played ON tracks(last_played);",
    ) {
      eprintln!("[db] migration warning: {}", e);
    }

    if let Err(e) = conn.execute_batch("DELETE FROM playlist_tracks WHERE rowid NOT IN (
      SELECT MIN(rowid) FROM playlist_tracks GROUP BY playlist_id, track_id
    );") {
      eprintln!("[db] migration warning: {}", e);
    }
    if let Err(e) = conn.execute_batch(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_playlist_track
       ON playlist_tracks(playlist_id, track_id);
       CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pos
       ON playlist_tracks(playlist_id, position);
       CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
       CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
       CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);",
    ) {
      eprintln!("[db] migration warning: {}", e);
    }

    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );",
    )?;
    if let Err(e) = conn.execute("ALTER TABLE playlists ADD COLUMN cover_path TEXT", []) {
      eprintln!("[db] migration warning: {}", e);
    }
    if let Err(e) = conn.execute("ALTER TABLE playlists ADD COLUMN color TEXT", []) {
      eprintln!("[db] migration warning: {}", e);
    }
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id INTEGER,
        track_id INTEGER,
        position INTEGER,
        FOREIGN KEY(playlist_id) REFERENCES playlists(id),
        FOREIGN KEY(track_id) REFERENCES tracks(id)
      );",
    )?;
    Ok(Self { conn })
  }

  #[allow(clippy::too_many_arguments)]
  pub fn upsert_track(
    &self,
    file_path: &str,
    title: &str,
    artist: &str,
    album: &str,
    genre: &str,
    sample_rate: u32,
    bit_depth: u32,
    channels: u8,
    duration_secs: f64,
    track_number: u32,
    disc_number: u32,
    watched_folder: &str,
    cover_path: &str,
    lyrics: &str,
    format: &str,
  ) -> Result<()> {
    self.conn.execute(
      UPSERT_TRACK_SQL,
      rusqlite::params![
        file_path, title, artist, album, genre,
        sample_rate, bit_depth, channels, duration_secs,
        track_number, disc_number, watched_folder, cover_path, lyrics, format
      ],
    )?;
    Ok(())
  }

  /// Removes a single track row by its file path (used when the watcher sees
  /// a delete). Playlist links cascade.
  pub fn remove_track_by_path(&self, file_path: &str) -> Result<usize> {
    let removed = self
      .conn
      .execute("DELETE FROM tracks WHERE file_path = ?1", [file_path])?;
    Ok(removed)
  }

  /// Drops rows whose file no longer exists on disk — cleans up files that
  /// were deleted or moved while the app wasn't running. Returns how many
  /// rows were pruned.
  pub fn prune_missing_files(&self) -> Result<usize> {
    let paths: Vec<String> = {
      let mut stmt = self.conn.prepare("SELECT file_path FROM tracks")?;
      let rows = stmt.query_map([], |row| row.get(0))?;
      rows.filter_map(|r| r.ok()).collect()
    };
    let mut removed = 0;
    for p in &paths {
      if let Err(e) = std::fs::metadata(p) {
        if e.kind() == std::io::ErrorKind::NotFound {
          self.conn.execute("DELETE FROM tracks WHERE file_path = ?1", [p])?;
          removed += 1;
        }
      }
    }
    Ok(removed)
  }

  pub fn create_playlist(&self, name: &str) -> Result<i64> {
    self.conn.execute("INSERT INTO playlists (name) VALUES (?1)", [name])?;
    Ok(self.conn.last_insert_rowid())
  }

  pub fn rename_playlist(&self, playlist_id: i64, name: &str) -> Result<()> {
    self.conn.execute("UPDATE playlists SET name = ?1 WHERE id = ?2", [name, &playlist_id.to_string()])?;
    Ok(())
  }

  pub fn set_playlist_cover(&self, playlist_id: i64, cover_path: &str) -> Result<()> {
    self.conn.execute("UPDATE playlists SET cover_path = ?1 WHERE id = ?2", [cover_path, &playlist_id.to_string()])?;
    Ok(())
  }

  pub fn get_playlist_cover(&self, playlist_id: i64) -> Result<Option<String>> {
    let result = self.conn.query_row(
      "SELECT cover_path FROM playlists WHERE id = ?1",
      [playlist_id],
      |row| row.get::<_, Option<String>>(0),
    );
    match result {
      Ok(path) => Ok(path),
      Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
      Err(e) => Err(e),
    }
  }

  pub fn set_playlist_color(&self, playlist_id: i64, color: &str) -> Result<()> {
    self.conn.execute("UPDATE playlists SET color = ?1 WHERE id = ?2", [color, &playlist_id.to_string()])?;
    Ok(())
  }

  pub fn get_playlist_color(&self, playlist_id: i64) -> Result<Option<String>> {
    let result = self.conn.query_row(
      "SELECT color FROM playlists WHERE id = ?1",
      [playlist_id],
      |row| row.get::<_, Option<String>>(0),
    );
    match result {
      Ok(color) => Ok(color),
      Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
      Err(e) => Err(e),
    }
  }

  /// If the playlist has no cover, set it to a random track's cover.
  pub fn auto_set_cover_from_first_track(&self, playlist_id: i64) -> Result<()> {
    let current: Option<String> = self.conn.query_row(
      "SELECT cover_path FROM playlists WHERE id = ?1",
      [playlist_id],
      |row| row.get(0),
    )?;
    if current.is_some_and(|c| !c.is_empty()) {
      return Ok(());
    }
    let first_cover: Option<String> = self.conn.query_row(
      "SELECT t.cover_path FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ?1 AND t.cover_path IS NOT NULL AND t.cover_path != '' ORDER BY RANDOM() LIMIT 1",
      [playlist_id],
      |row| row.get(0),
    )?;
    if let Some(cover) = first_cover.filter(|c| !c.is_empty()) {
      self.conn.execute("UPDATE playlists SET cover_path = ?1 WHERE id = ?2", [&cover, &playlist_id.to_string()])?;
    }
    Ok(())
  }

  pub fn get_playlists(&self) -> Result<Vec<(i64, String, i64, Option<String>, Option<String>)>> {
    let mut stmt = self.conn.prepare(
      "SELECT p.id, p.name, COUNT(pt.track_id), p.cover_path, p.color FROM playlists p LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id GROUP BY p.id ORDER BY p.created_at DESC",
    )?;
    let iter = stmt.query_map([], |row| {
      Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?))
    })?;
    let mut out = Vec::new();
    for row in iter {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn get_playlist_name(&self, playlist_id: i64) -> Result<Option<String>> {
    let result = self.conn.query_row(
      "SELECT name FROM playlists WHERE id = ?1",
      [playlist_id],
      |row| row.get::<_, String>(0),
    );
    match result {
      Ok(name) => Ok(Some(name)),
      Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
      Err(e) => Err(e),
    }
  }

  pub fn add_track_to_playlist(&self, playlist_id: i64, track_id: i64) -> Result<()> {
    let pos: i64 = self.conn.query_row(
      "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1",
      [playlist_id],
      |r| Ok(r.get::<_, Option<i64>>(0).unwrap_or(Some(-1)).unwrap_or(-1)),
    )? + 1;
    self.conn.execute(
      "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
      [playlist_id, track_id, pos],
    )?;
    let _ = self.auto_set_cover_from_first_track(playlist_id);
    Ok(())
  }

  pub fn remove_track_from_playlist(&self, playlist_id: i64, track_id: i64) -> Result<()> {
    self.conn.execute(
      "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
      [playlist_id, track_id],
    )?;
    Ok(())
  }

  #[allow(clippy::type_complexity)]
  pub fn get_playlist_tracks(
    &self,
    playlist_id: i64,
  ) -> Result<Vec<TrackRow>> {
    let mut stmt = self.conn.prepare(
      "SELECT t.id, t.file_path, t.title, t.artist, t.album, t.genre,
              t.sample_rate, t.bit_depth, t.channels, t.duration_secs,
              COALESCE(t.track_number, 0), COALESCE(t.disc_number, 0), COALESCE(t.cover_path,''), COALESCE(t.lyrics,''),
              COALESCE(NULLIF(t.format,''), 'FLAC'), COALESCE(t.play_count, 0)
       FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?1
       ORDER BY pt.position ASC",
    )?;
    let iter = stmt.query_map([playlist_id], map_track_row)?;
    let mut out = Vec::new();
    for row in iter {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn increment_play_count(&self, file_path: &str) -> Result<()> {
    self.conn.execute(
      "UPDATE tracks
       SET play_count = play_count + 1,
           last_played = CAST(strftime('%s','now') AS INTEGER)
       WHERE file_path = ?1",
      [file_path],
    )?;
    Ok(())
  }

  pub fn recently_played(
    &self,
    limit: u32,
  ) -> Result<Vec<TrackRow>> {
    let mut stmt = self.conn.prepare(
      "SELECT t.id, t.file_path, t.title, t.artist, t.album, t.genre,
              t.sample_rate, t.bit_depth, t.channels, t.duration_secs,
              COALESCE(t.track_number, 0), COALESCE(t.disc_number, 0), COALESCE(t.cover_path,''), COALESCE(t.lyrics,''),
              COALESCE(NULLIF(t.format,''), 'FLAC'), COALESCE(t.play_count, 0)
       FROM tracks t
       WHERE t.last_played IS NOT NULL
       ORDER BY t.last_played DESC
       LIMIT ?1",
    )?;
    let iter = stmt.query_map([limit], map_track_row)?;
    let mut out = Vec::new();
    for row in iter {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn get_or_create_liked_playlist(&self) -> Result<i64> {    let mut stmt = self
      .conn
      .prepare("SELECT id FROM playlists WHERE name = ?1 LIMIT 1")?;
    if let Ok(Some(id)) = stmt.query_row(["Liked Songs"], |r| Ok(Some(r.get::<_, i64>(0)?))) {
      return Ok(id);
    }

    self.conn.execute("INSERT INTO playlists (name) VALUES (?1)", ["Liked Songs"])?;
    Ok(self.conn.last_insert_rowid())
  }

  pub fn is_track_in_playlist(&self, playlist_id: i64, track_id: i64) -> Result<bool> {
    let mut stmt = self
      .conn
      .prepare("SELECT 1 FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2 LIMIT 1")?;
    let exists = stmt.query_row([playlist_id, track_id], |_| Ok(true)).unwrap_or(false);
    Ok(exists)
  }

  pub fn toggle_track_in_playlist(&self, playlist_id: i64, track_id: i64) -> Result<bool> {
    let was_liked = self.is_track_in_playlist(playlist_id, track_id)?;

    if was_liked {
      self.remove_track_from_playlist(playlist_id, track_id)?;
    } else {
      self.add_track_to_playlist(playlist_id, track_id)?;
    }

    Ok(!was_liked)
  }

  pub fn delete_playlist(&self, playlist_id: i64) -> Result<()> {
    if let Ok(Some(name)) = self
      .conn
      .query_row("SELECT name FROM playlists WHERE id = ?1", [playlist_id], |r| {
        Ok(Some(r.get::<_, String>(0)?))
      })
    {
      if name == "Liked Songs" {
        return Ok(());
      }
    }

    self.conn
      .execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [playlist_id])?;
    self.conn
      .execute("DELETE FROM playlists WHERE id = ?1", [playlist_id])?;
    Ok(())
  }

  /// Returns the cached waveform peak data for a track, or None if not yet
  /// computed or if the blob is from an older extraction algorithm (no version
  /// prefix).  The blob format is: 1 version byte (must match
  /// WAVEFORM_CACHE_VERSION) followed by raw little-endian f32 array (400 points).
  pub fn get_waveform(&self, file_path: &str) -> Result<Option<Vec<f32>>> {
    let blob: Option<Vec<u8>> = self.conn.query_row(
      "SELECT waveform FROM tracks WHERE file_path = ?1",
      [file_path],
      |row| row.get(0),
    )?;
    match blob {
      Some(bytes) if bytes.len() >= 5 && bytes[0] == crate::decoder::waveform::WAVEFORM_CACHE_VERSION => {
        let floats: Vec<f32> = bytes[1..]
          .chunks_exact(4)
          .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
          .collect();
        Ok(Some(floats))
      }
      _ => Ok(None),
    }
  }

  /// Stores the computed waveform peak data for a track, prefixed with the
  /// cache version byte so stale blobs are detected on read.
  pub fn set_waveform(&self, file_path: &str, peaks: &[f32]) -> Result<()> {
    let mut bytes = Vec::with_capacity(1 + peaks.len() * 4);
    bytes.push(crate::decoder::waveform::WAVEFORM_CACHE_VERSION);
    for p in peaks {
      bytes.extend_from_slice(&p.to_le_bytes());
    }
    self.conn.execute(
      "UPDATE tracks SET waveform = ?1 WHERE file_path = ?2",
      rusqlite::params![bytes, file_path],
    )?;
    Ok(())
  }
}
