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

/// Shared 14-field track row: (id, file_path, title, artist, album, genre,
/// sample_rate, bit_depth, channels, duration_secs, track_number, cover_path,
/// lyrics, format).
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
  Option<String>,
  Option<String>,
  String,
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
    if row.get::<_, String>(11)?.is_empty() { None } else { Some(row.get(11)?) },
    if row.get::<_, String>(12)?.is_empty() { None } else { Some(row.get(12)?) },
    row.get(13)?,
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
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN cover_path TEXT", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN lyrics TEXT", []);
    let _ = conn.execute(
      "ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0",
      [],
    );
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN last_played INTEGER", []);
    let _ = conn.execute(
      "ALTER TABLE tracks ADD COLUMN format TEXT NOT NULL DEFAULT ''",
      [],
    );
    let _ = conn.execute_batch(
      "CREATE INDEX IF NOT EXISTS idx_tracks_last_played ON tracks(last_played);",
    );

    let _ = conn.execute_batch("DELETE FROM playlist_tracks WHERE rowid NOT IN (
      SELECT MIN(rowid) FROM playlist_tracks GROUP BY playlist_id, track_id
    );");
    let _ = conn.execute_batch(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_playlist_track
       ON playlist_tracks(playlist_id, track_id);
       CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pos
       ON playlist_tracks(playlist_id, position);
       CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
       CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
       CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);",
    );

    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );",
    )?;
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
      if std::fs::metadata(p).is_err() {
        self.conn.execute("DELETE FROM tracks WHERE file_path = ?1", [p])?;
        removed += 1;
      }
    }
    Ok(removed)
  }

  pub fn create_playlist(&self, name: &str) -> Result<i64> {
    self.conn.execute("INSERT INTO playlists (name) VALUES (?1)", [name])?;
    Ok(self.conn.last_insert_rowid())
  }

  pub fn get_playlists(&self) -> Result<Vec<(i64, String, i64)>> {
    let mut stmt = self.conn.prepare(
      "SELECT p.id, p.name, COUNT(pt.track_id) FROM playlists p LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id GROUP BY p.id ORDER BY p.created_at DESC",
    )?;
    let iter = stmt.query_map([], |row| {
      Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
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
              COALESCE(t.track_number, 0), COALESCE(t.cover_path,''), COALESCE(t.lyrics,''),
              COALESCE(NULLIF(t.format,''), 'FLAC')
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
              COALESCE(t.track_number, 0), COALESCE(t.cover_path,''), COALESCE(t.lyrics,''),
              COALESCE(NULLIF(t.format,''), 'FLAC')
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
}
