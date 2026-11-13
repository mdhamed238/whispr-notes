/**
 * SQLite schema for WhisprNotes.
 *
 * Migrations are append-only: MIGRATIONS[n] upgrades a database from
 * user_version n to n + 1. Never edit a shipped migration; add a new one.
 */

export const MIGRATIONS: string[] = [
  // v0 → v1: notes + full-text index kept in sync by triggers. (Not yet
  // shipped to users when last edited; from the first release on, append only.)
  `
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    transcription TEXT NOT NULL,
    audio_uri TEXT,
    duration REAL NOT NULL DEFAULT 0,
    tags_json TEXT NOT NULL DEFAULT '[]',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    summary_json TEXT,
    language TEXT,
    source TEXT NOT NULL DEFAULT 'recording',
    enhancement TEXT NOT NULL DEFAULT 'none',
    enhancement_progress REAL NOT NULL DEFAULT 0,
    title_is_auto INTEGER NOT NULL DEFAULT 1,
    content_hash TEXT
  );
  CREATE INDEX IF NOT EXISTS notes_created_at ON notes(created_at);
  CREATE INDEX IF NOT EXISTS notes_pinned ON notes(pinned);
  CREATE INDEX IF NOT EXISTS notes_content_hash ON notes(content_hash);

  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    id UNINDEXED, title, transcription, tags, summary, tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(id, title, transcription, tags, summary)
    VALUES (new.id, new.title, new.transcription, new.tags_json, COALESCE(new.summary_json, ''));
  END;
  CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
    DELETE FROM notes_fts WHERE id = old.id;
  END;
  CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE OF title, transcription, tags_json, summary_json ON notes BEGIN
    DELETE FROM notes_fts WHERE id = old.id;
    INSERT INTO notes_fts(id, title, transcription, tags, summary)
    VALUES (new.id, new.title, new.transcription, new.tags_json, COALESCE(new.summary_json, ''));
  END;

  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
  `,
  // v1 → v2: background AI jobs (enhanced transcripts, summaries).
  `
  CREATE TABLE IF NOT EXISTS jobs (
    note_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (note_id, kind)
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;
