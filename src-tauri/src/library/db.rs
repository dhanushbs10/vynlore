use rusqlite::{Connection, Result};
use std::collections::HashMap;
use std::path::Path;

pub const UPSERT_TRACK_SQL: &str = "INSERT INTO tracks (
        file_path, title, artist, album, genre,
        sample_rate, bit_depth, channels, duration_secs,
        track_number, disc_number, watched_folder, cover_path, lyrics, format,
        track_gain, track_peak, bitrate, mtime, size
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
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
        format=excluded.format,
        track_gain=COALESCE(excluded.track_gain, tracks.track_gain),
        track_peak=COALESCE(excluded.track_peak, tracks.track_peak),
        bitrate=COALESCE(excluded.bitrate, tracks.bitrate),
        mtime=excluded.mtime,
        size=excluded.size";

const SCHEMA_VERSION: i64 = 6;

fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
  let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
  let cols: Vec<String> = stmt
    .query_map([], |r| r.get::<_, String>(1))?
    .collect::<rusqlite::Result<Vec<_>>>()?;
  Ok(cols.iter().any(|c| c == column))
}

/// Incremental, idempotent, user_version-tracked schema upgrades. Columns are
/// added only when missing (legacy DBs upgrade in place), indexes are
/// idempotent, and every run converges on SCHEMA_VERSION. This replaces the
/// old ad-hoc ALTER chain where every missing/duplicate column logged a
/// "migration warning" on each open.
fn run_schema_migrations(conn: &Connection) -> rusqlite::Result<()> {
  let additions: &[(&str, &str, &str)] = &[
    ("tracks", "cover_path", "TEXT"),
    ("tracks", "lyrics", "TEXT"),
    ("tracks", "play_count", "INTEGER NOT NULL DEFAULT 0"),
    ("tracks", "last_played", "INTEGER"),
    ("tracks", "format", "TEXT NOT NULL DEFAULT ''"),
    ("tracks", "waveform", "BLOB"),
    ("tracks", "track_gain", "REAL"),
    ("tracks", "track_peak", "REAL"),
    ("tracks", "album_gain", "REAL"),
    ("tracks", "bitrate", "INTEGER"),
    ("tracks", "mtime", "INTEGER"),
    ("tracks", "size", "INTEGER"),
    ("playlists", "cover_path", "TEXT"),
    ("playlists", "color", "TEXT"),
  ];
  for &(table, col, ddl) in additions {
    if !column_exists(conn, table, col)? {
      conn.execute(&format!("ALTER TABLE {} ADD COLUMN {} {}", table, col, ddl), [])?;
    }
  }
  conn.execute_batch(
    "CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album, album_gain);
     CREATE INDEX IF NOT EXISTS idx_tracks_album_plain ON tracks(album);
     CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
     CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
     CREATE INDEX IF NOT EXISTS idx_tracks_last_played ON tracks(last_played);
     CREATE INDEX IF NOT EXISTS idx_tracks_mtime ON tracks(mtime);
     DELETE FROM playlist_tracks WHERE rowid NOT IN (SELECT MIN(rowid) FROM playlist_tracks GROUP BY playlist_id, track_id);
     CREATE UNIQUE INDEX IF NOT EXISTS uq_playlist_track ON playlist_tracks(playlist_id, track_id);
     CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pos ON playlist_tracks(playlist_id, position);
     DELETE FROM playlist_tracks WHERE playlist_id NOT IN (SELECT id FROM playlists);
     DELETE FROM playlist_tracks WHERE track_id NOT IN (SELECT id FROM tracks);",
  )?;
  let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
  if v < SCHEMA_VERSION {
    conn.execute_batch(&format!("PRAGMA user_version = {}", SCHEMA_VERSION))?;
  }
  Ok(())
}

pub struct LibraryDb {
  pub conn: Connection,
}

/// Shared 17-field track row: (id, file_path, title, artist, album, genre,
/// sample_rate, bit_depth, channels, duration_secs, track_number, disc_number,
/// cover_path, lyrics, format, play_count, bitrate).
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
  u32,
);

pub(crate) fn map_track_row(
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
    row.get::<_, i64>(16)? as u32,
  ))
}

/// Playback-relevant row state stashed before a watcher-driven delete so a
/// file that vanishes briefly (tag editor save, atomic replace) and comes
/// back doesn't lose its likes, play counts, loudness analysis or waveform.
#[derive(Clone)]
pub struct StashedTrackState {
  pub play_count: i64,
  pub last_played: Option<i64>,
  pub liked: bool,
  pub track_gain: Option<f64>,
  pub track_peak: Option<f64>,
  pub album_gain: Option<f64>,
  pub waveform: Option<Vec<u8>>,
}

impl LibraryDb {
  pub fn new(path: &Path) -> Result<Self> {
    let conn = Connection::open(path)?;
    // Enforce referential integrity so stale / orphan playlist links can't
    // accumulate, and so fresh databases benefit from ON DELETE CASCADE.
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
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
        FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );",
    )?;
    run_schema_migrations(&conn)?;

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
    bitrate: u32,
    mtime: i64,
    size: i64,
  ) -> Result<()> {
    self.conn.execute(
      UPSERT_TRACK_SQL,
      rusqlite::params![
        file_path, title, artist, album, genre,
        sample_rate, bit_depth, channels, duration_secs,
        track_number, disc_number, watched_folder, cover_path, lyrics, format,
        None::<f64>, None::<f64>, bitrate as i64, mtime, size
      ],
    )?;
    Ok(())
  }

  /// (file_path, mtime, size) for rows that already have loudness analysis —
  /// i.e. fully processed files. The scanner skips these outright when the
  /// on-disk signature still matches, making rescans O(changed files) instead
  /// of re-reading (and re-decoding for ReplayGain) the whole library.
  pub fn get_scanned_states(&self) -> Result<Vec<(String, i64, i64)>> {
    let mut stmt = self.conn.prepare(
      "SELECT file_path, COALESCE(mtime,0), COALESCE(size,0) FROM tracks WHERE track_gain IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |r| {
      Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
      out.push(row?);
    }
    Ok(out)
  }

  /// Removes a single track row by its file path (used when the watcher sees
  /// a delete). Referencing playlist links are cleared first so the delete
  /// works both with and without ON DELETE CASCADE in the schema.
  pub fn remove_track_by_path(&self, file_path: &str) -> Result<usize> {
    self.conn.execute(
      "DELETE FROM playlist_tracks WHERE track_id IN (SELECT id FROM tracks WHERE file_path = ?1)",
      [file_path],
    )?;
    self.conn.execute("DELETE FROM tracks WHERE file_path = ?1", [file_path])
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
          self.remove_track_by_path(p)?;
          removed += 1;
        }
      }
    }
    Ok(removed)
  }

  /// Fetches a single track row by its unique file path.
  pub fn get_track_by_path(&self, file_path: &str) -> Result<Option<TrackRow>> {
    let mut stmt = self.conn.prepare(
      "SELECT id, file_path, title, artist, album, genre,
              sample_rate, bit_depth, channels, duration_secs,
              COALESCE(track_number, 0), COALESCE(disc_number, 0), COALESCE(cover_path,''), COALESCE(lyrics,''),
              COALESCE(NULLIF(format,''), 'FLAC'), COALESCE(play_count, 0), COALESCE(bitrate, 0)
       FROM tracks WHERE file_path = ?1",
    )?;
    let mut rows = stmt.query_map([file_path], map_track_row)?;
    match rows.next() {
      Some(Ok(row)) => Ok(Some(row)),
      Some(Err(e)) => Err(e),
      None => Ok(None),
    }
  }

  /// ReplayGain values for a track: (track_gain, album_gain, track_peak).
  pub fn get_replaygain(&self, file_path: &str) -> Result<(Option<f64>, Option<f64>, Option<f64>)> {
    let mut stmt = self.conn.prepare(
      "SELECT track_gain, album_gain, track_peak FROM tracks WHERE file_path = ?1",
    )?;
    let mut rows = stmt.query_map([file_path], |r| {
      Ok((
        r.get::<_, Option<f64>>(0)?,
        r.get::<_, Option<f64>>(1)?,
        r.get::<_, Option<f64>>(2)?,
      ))
    })?;
    match rows.next() {
      Some(Ok(row)) => Ok(row),
      Some(Err(e)) => Err(e),
      None => Ok((None, None, None)),
    }
  }

  /// Deletes every track that belongs to a different watched folder. Called
  /// after a successful folder scan so switching folders (or a changed
  /// configured folder at startup) doesn't leave stale rows from the old one.
  /// Rows with no watched folder (externally opened "Open with" files) are
  /// never pruned — they belong to no folder.
  pub fn remove_tracks_not_in_folder(&self, folder: &str) -> Result<usize> {
    let target = Self::normalize_folder_key(folder);
    let folders: Vec<String> = {
      let mut stmt = self.conn.prepare(
        "SELECT DISTINCT watched_folder FROM tracks WHERE watched_folder IS NOT NULL AND watched_folder != ''",
      )?;
      let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
      let mut out = Vec::new();
      for r in rows {
        out.push(r?);
      }
      out
    };
    let mut removed = 0;
    for f in folders {
      if f.is_empty() {
        continue;
      }
      if Self::normalize_folder_key(&f) != target {
        removed += self.remove_tracks_in_folder(&f)?;
      }
    }
    Ok(removed)
  }

  fn remove_tracks_in_folder(&self, folder: &str) -> Result<usize> {
    self.conn.execute(
      "DELETE FROM playlist_tracks WHERE track_id IN (SELECT id FROM tracks WHERE watched_folder = ?1)",
      [folder],
    )?;
    self.conn.execute("DELETE FROM tracks WHERE watched_folder = ?1", [folder])
  }

  fn normalize_folder_key(f: &str) -> String {
    let s = f.trim().trim_end_matches(['/', '\\']);
    let s = s.strip_prefix(r"\\?\").unwrap_or(s);
    s.to_lowercase()
  }

  pub fn create_playlist(&self, name: &str) -> Result<i64, String> {
    if name.eq_ignore_ascii_case("Liked Songs") {
      return Err("'Liked Songs' is a reserved playlist name".into());
    }
    self.conn
      .execute("INSERT INTO playlists (name) VALUES (?1)", [name])
      .map_err(|e| e.to_string())?;
    Ok(self.conn.last_insert_rowid())
  }

  pub fn rename_playlist(&self, playlist_id: i64, name: &str) -> Result<(), String> {
    if name.eq_ignore_ascii_case("Liked Songs") {
      return Err("'Liked Songs' is a reserved playlist name".into());
    }
    let current: Option<String> = self
      .conn
      .query_row("SELECT name FROM playlists WHERE id = ?1", [playlist_id], |r| {
        r.get(0)
      })
      .map_err(|e| e.to_string())?;
    if current.as_deref().is_some_and(|n| n.eq_ignore_ascii_case("Liked Songs")) {
      return Err("'Liked Songs' cannot be renamed".into());
    }
    self
      .conn
      .execute("UPDATE playlists SET name = ?1 WHERE id = ?2", [name, &playlist_id.to_string()])
      .map_err(|e| e.to_string())?;
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
              COALESCE(NULLIF(t.format,''), 'FLAC'), COALESCE(t.play_count, 0), COALESCE(t.bitrate, 0)
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
              COALESCE(NULLIF(t.format,''), 'FLAC'), COALESCE(t.play_count, 0), COALESCE(t.bitrate, 0)
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

  pub fn recently_added(&self, limit: u32) -> Result<Vec<TrackRow>> {
    let mut stmt = self.conn.prepare(
      "SELECT t.id, t.file_path, t.title, t.artist, t.album, t.genre,
              t.sample_rate, t.bit_depth, t.channels, t.duration_secs,
              COALESCE(t.track_number, 0), COALESCE(t.disc_number, 0), COALESCE(t.cover_path,''), COALESCE(t.lyrics,''),
              COALESCE(NULLIF(t.format,''), 'FLAC'), COALESCE(t.play_count, 0), COALESCE(t.bitrate, 0)
       FROM tracks t
       ORDER BY t.id DESC
       LIMIT ?1",
    )?;
    let iter = stmt.query_map([limit], map_track_row)?;
    let mut out = Vec::new();
    for row in iter {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn top_played(&self, limit: u32) -> Result<Vec<TrackRow>> {
    let mut stmt = self.conn.prepare(
      "SELECT t.id, t.file_path, t.title, t.artist, t.album, t.genre,
              t.sample_rate, t.bit_depth, t.channels, t.duration_secs,
              COALESCE(t.track_number, 0), COALESCE(t.disc_number, 0), COALESCE(t.cover_path,''), COALESCE(t.lyrics,''),
              COALESCE(NULLIF(t.format,''), 'FLAC'), COALESCE(t.play_count, 0), COALESCE(t.bitrate, 0)
       FROM tracks t
       WHERE COALESCE(t.play_count, 0) > 0
       ORDER BY t.play_count DESC, t.last_played DESC NULLS LAST
       LIMIT ?1",
    )?;
    let iter = stmt.query_map([limit], map_track_row)?;
    let mut out = Vec::new();
    for row in iter {
      out.push(row?);
    }
    Ok(out)
  }

  pub fn get_or_create_liked_playlist(&self) -> Result<i64> {
    let mut stmt = self.conn
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
      // Only the system-created "Liked Songs" playlist is protected; create /
      // rename now reject that name, so no user playlist can ever claim it.
      if name.eq_ignore_ascii_case("Liked Songs") {
        return Ok(());
      }
    }

    self.conn
      .execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [playlist_id])?;
    self.conn
      .execute("DELETE FROM playlists WHERE id = ?1", [playlist_id])?;
    Ok(())
  }

  /// Snapshot the restorable state of a track row. Returns None when the row
/// doesn't exist (genuinely new file — nothing to preserve).
pub fn stash_track_state(&self, file_path: &str) -> Option<StashedTrackState> {
  let (track_id, play_count, last_played): (i64, i64, Option<i64>) = self
    .conn
    .query_row(
      "SELECT id, COALESCE(play_count,0), last_played FROM tracks WHERE file_path = ?1",
      [file_path],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .ok()?;
  let (track_gain, album_gain, track_peak) = self.get_replaygain(file_path).ok()?;
  let waveform: Option<Vec<u8>> = self
    .conn
    .query_row("SELECT waveform FROM tracks WHERE file_path = ?1", [file_path], |r| {
      r.get(0)
    })
    .unwrap_or(None);
  let liked = self
    .get_or_create_liked_playlist()
    .ok()
    .map(|liked_id| self.is_track_in_playlist(liked_id, track_id).unwrap_or(false))
    .unwrap_or(false);
  Some(StashedTrackState {
    play_count,
    last_played,
    liked,
    track_gain,
    track_peak,
    album_gain,
    waveform,
  })
}

/// Restore stashed state onto a freshly re-added row. Freshly analyzed values
/// (gain/waveform computed since the delete) always win via COALESCE — the
/// stash only backfills what would otherwise be lost.
pub fn restore_track_state(&self, file_path: &str, s: &StashedTrackState) -> Result<()> {
  self.conn.execute(
    "UPDATE tracks SET play_count = ?1, last_played = ?2,
       track_gain = COALESCE(track_gain, ?3), track_peak = COALESCE(track_peak, ?4),
       album_gain = COALESCE(album_gain, ?5), waveform = COALESCE(waveform, ?6)
     WHERE file_path = ?7",
    rusqlite::params![
      s.play_count,
      s.last_played,
      s.track_gain,
      s.track_peak,
      s.album_gain,
      s.waveform,
      file_path
    ],
  )?;
  if s.liked {
    if let Ok(track_id) = self.conn.query_row(
      "SELECT id FROM tracks WHERE file_path = ?1",
      [file_path],
      |r| r.get::<_, i64>(0),
    ) {
      if let Ok(liked_id) = self.get_or_create_liked_playlist() {
        let _ = self.add_track_to_playlist(liked_id, track_id);
      }
    }
  }
  Ok(())
}

  /// Recomputes `album_gain` (mean of analyzed track gains) for every album.
  /// Albums are keyed by (title, watched folder): two different releases
  /// that share a title but live in different folders stay independent,
  /// while a various-artists compilation in one folder still levels as a
  /// single release. Rows outside any watched folder ("Open with" files)
  /// keep NULL gain so they gracefully fall back to track gain. Clears
  /// gains whose album no longer has any analyzed track so nothing goes stale.
  pub fn recompute_album_gains(&self) -> Result<()> {
    let mut stmt = self.conn.prepare(
      "SELECT album, COALESCE(watched_folder, ''), track_gain FROM tracks
       WHERE track_gain IS NOT NULL AND COALESCE(watched_folder, '') != ''",
    )?;
    let rows: Vec<(String, String, f64)> = stmt
      .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
      .filter_map(|r| r.ok())
      .collect();

    let mut sums: HashMap<(String, String), (f64, u64)> = HashMap::new();
    for (album, folder, gain) in &rows {
      let e = sums
        .entry((album.clone(), folder.clone()))
        .or_insert((0.0, 0));
      e.0 += gain;
      e.1 += 1;
    }

    self.conn.execute("UPDATE tracks SET album_gain = NULL", [])?;
    for ((album, folder), (sum, n)) in &sums {
      let avg = sum / *n as f64;
      self.conn.execute(
        "UPDATE tracks SET album_gain = ?1 WHERE album = ?2
         AND COALESCE(watched_folder, '') = ?3 AND track_gain IS NOT NULL",
        rusqlite::params![avg, album, folder],
      )?;
    }
    Ok(())
  }

  /// Watched folder a track row belongs to (None when the row is missing).
  /// Used to preserve folder association across in-place tag edits.
  pub fn watched_folder_of(&self, file_path: &str) -> Option<String> {
    self
      .conn
      .query_row(
        "SELECT watched_folder FROM tracks WHERE file_path = ?1",
        [file_path],
        |r| r.get::<_, Option<String>>(0),
      )
      .unwrap_or(None)
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

#[cfg(test)]
mod tests {
  use super::*;
  use std::path::Path;

  fn mem() -> LibraryDb {
    LibraryDb::new(Path::new(":memory:")).unwrap()
  }

  fn upsert(db: &LibraryDb, path: &str, gain: Option<f64>, peak: Option<f64>, mtime: i64, size: i64) {
    db.conn
      .execute(
        UPSERT_TRACK_SQL,
        rusqlite::params![
          path, "Title", "Artist", "Album", "Rock",
          44100u32, 16u32, 2u8, 180.0f64, 1u32, 1u32,
          "C:\\music", "", "", "MP3",
          gain, peak, 320u32 as i64, mtime, size
        ],
      )
      .unwrap();
  }

  #[test]
  fn schema_migrates_incrementally_and_sets_version() {
    let db = mem();
    let v: i64 = db
      .conn
      .query_row("PRAGMA user_version", [], |r| r.get(0))
      .unwrap();
    assert_eq!(v, SCHEMA_VERSION);
    assert!(column_exists(&db.conn, "tracks", "bitrate").unwrap());
    assert!(column_exists(&db.conn, "tracks", "mtime").unwrap());
    assert!(column_exists(&db.conn, "tracks", "size").unwrap());
  }

  #[test]
  fn upsert_preserves_existing_replaygain_via_coalesce() {
    let db = mem();
    upsert(&db, "a.mp3", Some(5.0), Some(0.9), 1, 2);
    // A later scan without loudness data must NOT blank the stored analysis.
    upsert(&db, "a.mp3", None, None, 1, 2);
    let (g, album, peak) = db.get_replaygain("a.mp3").unwrap();
    assert_eq!(g, Some(5.0));
    assert_eq!(peak, Some(0.9));
    assert!(album.is_none());
  }

  #[test]
  fn upsert_updates_mtime_size_and_bitrate() {
    let db = mem();
    upsert(&db, "b.mp3", None, None, 111, 222);
    upsert(&db, "b.mp3", None, None, 333, 444);
    let states = db.get_scanned_states().unwrap();
    assert!(states.is_empty()); // no loudness data yet
    let row = db.get_track_by_path("b.mp3").unwrap().unwrap();
    assert_eq!(row.15, 0); // play_count
    assert_eq!(row.16, 320); // bitrate
  }

  #[test]
  fn recompute_album_gains_splits_same_title_by_folder() {
    let db = mem();
    // Two different releases sharing a title but living in different
    // folders must NOT share a gain.
    upsert_named(&db, "a1.mp3", "Hits", "Alice", "D:\\A", 0.0);
    upsert_named(&db, "a2.mp3", "Hits", "Alice", "D:\\A", 2.0);
    upsert_named(&db, "b1.mp3", "Hits", "Bob", "D:\\B", 10.0);
    // A various-artists compilation in one folder levels as one release.
    upsert_named(&db, "c1.mp3", "Now!", "Carol", "D:\\C", 4.0);
    upsert_named(&db, "c2.mp3", "Now!", "Dan", "D:\\C", 6.0);
    db.recompute_album_gains().unwrap();
    let g = |p: &str| db.get_replaygain(p).unwrap().1;
    assert_eq!(g("a1.mp3"), Some(1.0));
    assert_eq!(g("a2.mp3"), Some(1.0));
    assert_eq!(g("b1.mp3"), Some(10.0));
    assert_eq!(g("c1.mp3"), Some(5.0));
    assert_eq!(g("c2.mp3"), Some(5.0));
  }

  fn upsert_named(
    db: &LibraryDb,
    path: &str,
    album: &str,
    artist: &str,
    folder: &str,
    gain: f64,
  ) {
    db.conn
      .execute(
        UPSERT_TRACK_SQL,
        rusqlite::params![
          path, "Title", artist, album, "Pop",
          44100u32, 16u32, 2u8, 180.0f64, 1u32, 1u32,
          folder, "", "", "MP3",
          Some(gain), Some(0.9), 320u32 as i64, 1i64, 2i64
        ],
      )
      .unwrap();
  }

  #[test]
  fn scanned_states_only_include_analyzed_tracks() {
    let db = mem();
    upsert(&db, "analyzed.mp3", Some(-6.0), Some(0.5), 10, 20);
    upsert(&db, "not_analyzed.mp3", None, None, 10, 20);
    let states = db.get_scanned_states().unwrap();
    assert_eq!(states, vec![("analyzed.mp3".to_string(), 10, 20)]);
  }

  #[test]
  fn upsert_keeps_coalesce_semantics_for_bitrate() {
    let db = mem();
    db.conn
      .execute(
        "INSERT INTO tracks (file_path,format,bitrate,mtime,size)
         VALUES ('c.mp3','MP3',128,1,1)",
        [],
      )
      .unwrap();
    // A scan that couldn't read a bitrate (NULL) must not blank the stored one.
    db.conn
      .execute(
        UPSERT_TRACK_SQL,
        rusqlite::params![
          "c.mp3", "Title", "Artist", "Album", "Rock",
          44100u32, 16u32, 2u8, 180.0f64, 1u32, 1u32,
          "C:\\music", "", "", "MP3",
          None::<f64>, None::<f64>, None::<i64>, 2i64, 2i64
        ],
      )
      .unwrap();
    let row = db.get_track_by_path("c.mp3").unwrap().unwrap();
    assert_eq!(row.16, 128);
    assert_eq!(db.get_scanned_states().unwrap().len(), 0);
  }
}
