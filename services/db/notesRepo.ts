/**
 * Notes repository: the only module that reads or writes notes.
 *
 * Replaces the old AsyncStorage service, whose every write re-serialized the
 * whole notes array with no locking — an autosave and a pin toggle could
 * interleave and silently drop one of them. Here each write is a single
 * statement (or one transaction), and background passes can use
 * compare-and-swap (`expectUpdatedAt`) so they never overwrite a user's edit.
 *
 * Screens subscribe to change events instead of re-reading on focus, so work
 * that finishes in the background (enhancement, summaries, imports) shows up
 * wherever the note is on screen.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import type { Note, NoteListItem, NoteSort } from '../../types';
import { countWords } from '../text';
import { deleteTimeline } from '../timelineStore';
import { getDb } from './database';
import { restoredEnhancement } from '../ai/jobState';
import { orphanedFiles } from './orphans';
import {
  LIST_COLUMNS,
  NOTE_COLUMNS,
  NoteListRow,
  NoteRow,
  buildUpdate,
  normalizeLegacy,
  noteToRow,
  rowToListItem,
  rowToNote,
  toFtsQuery,
} from './mapping';

const LEGACY_KEY = 'transcriptions';
const LEGACY_FLAG = 'legacy_migrated';
const WORD_COUNT_FLAG = 'word_count_backfilled';

type Listener = (changedId: string | null) => void;
const listeners = new Set<Listener>();

function emit(changedId: string | null) {
  for (const listener of listeners) {
    try {
      listener(changedId);
    } catch (error) {
      console.warn('notesRepo listener failed:', error);
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let readyPromise: Promise<void> | null = null;

/** Opens the DB and runs the one-time data migrations. */
function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = migrateLegacy()
      .then(backfillWordCounts)
      .catch((error) => {
        readyPromise = null;
        throw error;
      });
  }
  return readyPromise;
}

/**
 * Notes saved before the word_count column existed have 0 in it. Counted
 * once, a batch at a time so a large library never holds every transcript
 * in memory together.
 */
async function backfillWordCounts(): Promise<void> {
  const db = await getDb();
  const flag = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', WORD_COUNT_FLAG);
  if (flag) return;
  for (;;) {
    const rows = await db.getAllAsync<{ id: string; transcription: string }>(
      "SELECT id, transcription FROM notes WHERE word_count = 0 AND transcription != '' LIMIT 50"
    );
    if (rows.length === 0) break;
    let progressed = false;
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const row of rows) {
        // -1 marks "counted, and there are no words", so the loop can't spin on it.
        const count = countWords(row.transcription) || -1;
        await txn.runAsync('UPDATE notes SET word_count = ? WHERE id = ?', count, row.id);
        progressed = true;
      }
    });
    if (!progressed) break;
  }
  await db.runAsync('UPDATE notes SET word_count = 0 WHERE word_count < 0');
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', WORD_COUNT_FLAG, new Date().toISOString());
}

async function migrateLegacy(): Promise<void> {
  const db = await getDb();
  const flag = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', LEGACY_FLAG);
  if (flag) return;

  const raw = await AsyncStorage.getItem(LEGACY_KEY);
  let items: unknown[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed;
    } catch (error) {
      console.warn('Legacy notes were unreadable; skipping import:', error);
    }
  }

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const item of items) {
      const row = noteToRow(normalizeLegacy(item));
      await txn.runAsync(
        `INSERT OR IGNORE INTO notes (${NOTE_COLUMNS.join(', ')}) VALUES (${NOTE_COLUMNS.map(() => '?').join(', ')})`,
        NOTE_COLUMNS.map((column) => row[column])
      );
    }
    await txn.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', LEGACY_FLAG, new Date().toISOString());
  });

  // Only after the import has committed.
  if (raw) await AsyncStorage.removeItem(LEGACY_KEY);
}

const ORDER_BY: Record<NoteSort, string> = {
  newest: 'notes.pinned DESC, notes.created_at DESC',
  oldest: 'notes.pinned DESC, notes.created_at ASC',
  longest: 'notes.pinned DESC, notes.duration DESC, notes.created_at DESC',
  title: 'notes.pinned DESC, notes.title COLLATE NOCASE ASC',
};

interface ListOptions {
  query?: string;
  tag?: string | null;
  sort?: NoteSort;
}

function listQuery(columns: string, opts: ListOptions): { sql: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];

  const fts = opts.query ? toFtsQuery(opts.query) : null;
  if (fts) {
    where.push('notes.id IN (SELECT id FROM notes_fts WHERE notes_fts MATCH ?)');
    params.push(fts);
  }
  if (opts.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(notes.tags_json) WHERE json_each.value = ?)');
    params.push(opts.tag);
  }

  const sql =
    `SELECT ${columns} FROM notes` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY ${ORDER_BY[opts.sort ?? 'newest']}`;
  return { sql, params };
}

/** Full notes, transcripts included. For backup and export; lists use `listNoteItems`. */
export async function listNotes(opts: ListOptions = {}): Promise<Note[]> {
  await ready();
  const db = await getDb();
  const { sql, params } = listQuery('*', opts);
  const rows = await db.getAllAsync<NoteRow>(sql, params);
  return rows.map(rowToNote);
}

/** What the notes list and statistics need, without loading any full transcript. */
export async function listNoteItems(opts: ListOptions = {}): Promise<NoteListItem[]> {
  await ready();
  const db = await getDb();
  const { sql, params } = listQuery(LIST_COLUMNS, opts);
  const rows = await db.getAllAsync<NoteListRow>(sql, params);
  return rows.map(rowToListItem);
}

export async function countNotes(): Promise<number> {
  await ready();
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM notes');
  return row?.n ?? 0;
}

export async function getNote(id: string): Promise<Note | null> {
  await ready();
  const db = await getDb();
  const row = await db.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE id = ?', id);
  return row ? rowToNote(row) : null;
}

async function insert(note: Note, mode: 'INSERT' | 'INSERT OR REPLACE'): Promise<void> {
  await ready();
  const db = await getDb();
  const row = noteToRow(note);
  await db.runAsync(
    `${mode} INTO notes (${NOTE_COLUMNS.join(', ')}) VALUES (${NOTE_COLUMNS.map(() => '?').join(', ')})`,
    NOTE_COLUMNS.map((column) => row[column])
  );
}

export async function createNote(note: Note): Promise<void> {
  await insert(note, 'INSERT');
  emit(note.id);
}

/** Inserts many notes in one transaction (imports). */
export async function createNotes(notes: Note[]): Promise<void> {
  if (notes.length === 0) return;
  await ready();
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const note of notes) {
      const row = noteToRow(note);
      await txn.runAsync(
        `INSERT INTO notes (${NOTE_COLUMNS.join(', ')}) VALUES (${NOTE_COLUMNS.map(() => '?').join(', ')})`,
        NOTE_COLUMNS.map((column) => row[column])
      );
    }
  });
  emit(null);
}

/**
 * Applies a partial update. Returns false when the note doesn't exist or —
 * with `expectUpdatedAt` — when it has been written since that moment.
 */
export async function updateNote(
  id: string,
  patch: Partial<Note>,
  opts: { expectUpdatedAt?: Date } = {}
): Promise<boolean> {
  await ready();
  const db = await getDb();
  const { sql, params } = buildUpdate(id, patch, new Date(), opts.expectUpdatedAt);
  const result = await db.runAsync(sql, params);
  if (result.changes > 0) emit(id);
  return result.changes > 0;
}

/**
 * Removes the row only; the audio and timeline stay on disk so `restoreNote`
 * can undo. Call `purgeNoteFiles` once the undo window has passed.
 */
export async function deleteNote(id: string): Promise<Note | null> {
  const note = await getNote(id);
  if (!note) return null;
  const db = await getDb();
  await db.runAsync('DELETE FROM notes WHERE id = ?', id);
  emit(id);
  return note;
}

export async function restoreNote(note: Note): Promise<void> {
  // Its background job ran (or was dropped) while it was deleted.
  const enhancement = restoredEnhancement(note.enhancement);
  await insert({ ...note, enhancement, enhancementProgress: enhancement === note.enhancement ? note.enhancementProgress : 0 }, 'INSERT OR REPLACE');
  emit(note.id);
}

/** Deletes a note's files. Safe if they're already gone. */
export function purgeNoteFiles(note: Pick<Note, 'id' | 'audioUri'>): void {
  deleteTimeline(note.id);
  try {
    const peaks = new File(Paths.document, 'timelines', `${note.id}.peaks.json`);
    if (peaks.exists) peaks.delete();
  } catch (error) {
    console.warn('Failed to delete waveform cache:', error);
  }
  if (note.audioUri) {
    try {
      const audio = new File(note.audioUri);
      if (audio.exists) audio.delete();
    } catch (error) {
      console.warn('Failed to delete audio file:', error);
    }
  }
}

export async function allTags(): Promise<{ tag: string; count: number }[]> {
  await ready();
  const db = await getDb();
  return db.getAllAsync<{ tag: string; count: number }>(
    `SELECT json_each.value AS tag, COUNT(*) AS count
     FROM notes, json_each(notes.tags_json)
     GROUP BY json_each.value
     ORDER BY count DESC, tag COLLATE NOCASE ASC`
  );
}

export async function findByContentHash(hash: string): Promise<Note | null> {
  await ready();
  const db = await getDb();
  const row = await db.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE content_hash = ? LIMIT 1', hash);
  return row ? rowToNote(row) : null;
}

/**
 * Erases every note and every file the app created for them. Downloaded
 * models are left alone (they hold no user data and are large to re-fetch).
 */
export async function deleteAllData(): Promise<void> {
  await ready();
  const db = await getDb();
  // secure_delete overwrites freed pages, and the checkpoint + VACUUM make
  // sure no deleted text survives in the WAL or the database's free list.
  // On the main connection (not withExclusiveTransactionAsync, which opens
  // another one where this pragma wouldn't apply).
  await db.execAsync('PRAGMA secure_delete = ON;');
  await db.execAsync('BEGIN IMMEDIATE; DELETE FROM notes; DELETE FROM jobs; COMMIT;');
  // FTS5 keeps old index segments after DELETE; rebuild drops them.
  await db.execAsync("INSERT INTO notes_fts(notes_fts) VALUES('rebuild');");
  // VACUUM rewrites the file without freed pages; the checkpoint after it
  // moves the result out of the WAL so no old page survives anywhere.
  await db.execAsync('VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');

  const dirs = [
    ...['audio', 'timelines', 'exports', 'imports'].map((name) => new Directory(Paths.document, name)),
    ...['exports', 'imports'].map((name) => new Directory(Paths.cache, name)),
  ];
  for (const dir of dirs) {
    try {
      if (dir.exists) dir.delete();
    } catch (error) {
      console.warn(`Failed to delete ${dir.uri}:`, error);
    }
  }
  emit(null);
}

/** Raw access for other services that own their own tables (jobs). */
export { getDb };

/**
 * Deletes recordings, timelines and waveform caches that no note references,
 * e.g. when the app was killed during a delete's undo window. Run at launch;
 * recordings started after `launchedAt` are never touched.
 */
export async function sweepOrphanFiles(launchedAt: number): Promise<void> {
  await ready();
  const db = await getDb();
  const notes = await db.getAllAsync<{ id: string; audioUri: string | null }>('SELECT id, audio_uri AS audioUri FROM notes');
  const names = (dir: Directory) => (dir.exists ? dir.list().filter((e) => e instanceof File).map((e) => e.name) : []);
  const audioDir = new Directory(Paths.document, 'audio');
  const timelineDir = new Directory(Paths.document, 'timelines');
  const orphans = orphanedFiles({ audio: names(audioDir), timelines: names(timelineDir) }, notes, launchedAt);
  for (const name of orphans.audio) {
    try {
      new File(audioDir, name).delete();
    } catch (error) {
      console.warn('Failed to delete orphaned recording:', error);
    }
  }
  for (const name of orphans.timelines) {
    try {
      new File(timelineDir, name).delete();
    } catch (error) {
      console.warn('Failed to delete orphaned timeline:', error);
    }
  }
}
