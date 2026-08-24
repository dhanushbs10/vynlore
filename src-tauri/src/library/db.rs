use rusqlite::{Connection, Result};
use std::path::Path;

pub struct LibraryDb {
  pub conn: Connection,
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
  ) -> Result<()> {
    self.conn.execute(
      "INSERT INTO tracks (
        file_path, title, artist, album, genre,
        sample_rate, bit_depth, channels, duration_secs,
        track_number, disc_number, watched_folder, cover_path, lyrics
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
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
        lyrics=excluded.lyrics",
      rusqlite::params![
        file_path, title, artist, album, genre,
        sample_rate, bit_depth, channels, duration_secs,
        track_number, disc_number, watched_folder, cover_path, lyrics
      ],
    )?;
    Ok(())
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

pub fn add_track_to_playlist(&self, playlist_id: i64, track_id: i64) -> Result<()> {
  let pos: i64 = self.conn.query_row(
    "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1",
    [playlist_id],
    |r| Ok(r.get::<_, Option<i64>>(0).unwrap_or(Some(-1)).unwrap_or(-1)),
  )? + 1;
  self.conn.execute(
    "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
    [playlist_id, track_id, pos],
  )?;
  Ok(())
}

  pub fn get_playlist_tracks(&self, playlist_id: i64) -> Result<Vec<(String, String, String, u32, f64, Option<String>)>> {
    let mut stmt = self.conn.prepare(
      "SELECT t.file_path, t.title, t.artist, t.sample_rate, t.duration_secs, COALESCE(t.cover_path,'')
       FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?1
       ORDER BY pt.position ASC",
    )?;
    let iter = stmt.query_map([playlist_id], |row| {
      Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        if row.get::<_, String>(5)?.is_empty() { None } else { Some(row.get(5)?) },
      ))
    })?;
    let mut out = Vec::new();
    for row in iter {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn get_or_create_liked_playlist(&self) -> Result<i64> {
let mut stmt = self
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
self.conn.execute(
"DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
[playlist_id, track_id],
)?;
} else {
let pos: i64 = self
    .conn
    .query_row(
        "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1",
        [playlist_id],
        |r| {
            Ok(r.get::<_, Option<i64>>(0)
                .unwrap_or(Some(-1))
                .unwrap_or(-1)
            )
        },
    )? + 1;
self.conn.execute(
"INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
[playlist_id, track_id, pos],
)?;
}

Ok(!was_liked)
}

pub fn delete_playlist(&self, playlist_id: i64) -> Result<()> {
if let Ok(Some(name)) = self
.conn
.query_row("SELECT name FROM playlists WHERE id = ?1", [playlist_id], |r| {
Ok(Some(r.get::<_, String>(0)?))
}) {
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

pub fn get_all_tracks(&self) -> Result<Vec<(String, String, String, u32)>, rusqlite::Error> {
    let mut stmt = self.conn.prepare(
      "SELECT title, artist, album, sample_rate FROM tracks ORDER BY album, track_number",
    )?;
    let track_iter = stmt.query_map([], |row| {
      Ok((
        row.get::<_, String>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, String>(2)?,
        row.get::<_, u32>(3)?,
      ))
    })?;
    let mut tracks = Vec::new();
    for track in track_iter {
      tracks.push(track?);
    }
    Ok(tracks)
  }

  pub fn search_tracks(&self, query: &str) -> Result<Vec<(String, String, String)>, rusqlite::Error> {
    let search_pattern = format!("%{}%", query);
    let mut stmt = self.conn.prepare(
      "SELECT title, artist, file_path FROM tracks WHERE title LIKE ?1 OR artist LIKE ?1",
    )?;
    let track_iter = stmt.query_map(rusqlite::params![search_pattern], |row| {
      Ok((
        row.get::<_, String>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, String>(2)?,
      ))
    })?;
    let mut tracks = Vec::new();
    for track in track_iter {
      tracks.push(track?);
    }
    Ok(tracks)
  }
}
