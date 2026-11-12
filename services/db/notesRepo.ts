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
import type { Note, NoteSort } from '../../types';
import { deleteTimeline } from '../timelineStore';
import { getDb } from './database';
import { NOTE_COLUMNS, NoteRow, buildUpdate, normalizeLegacy, noteToRow, rowToNote, toFtsQuery } from './mapping';

const LEGACY_KEY = 'transcriptions';
const LEGACY_FLAG = 'legacy_migrated';

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

/** Opens the DB and runs the one-time AsyncStorage import. */
function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = migrateLegacy().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
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

export async function listNotes(
  opts: { query?: string; tag?: string | null; sort?: NoteSort } = {}
): Promise<Note[]> {
  await ready();
  const db = await getDb();
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
    'SELECT * FROM notes' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY ${ORDER_BY[opts.sort ?? 'newest']}`;

  const rows = await db.getAllAsync<NoteRow>(sql, params);
  return rows.map(rowToNote);
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
  await insert(note, 'INSERT OR REPLACE');
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
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync('DELETE FROM notes;');
  });
  for (const name of ['audio', 'timelines', 'exports', 'imports']) {
    try {
      const dir = new Directory(Paths.document, name);
      if (dir.exists) dir.delete();
    } catch (error) {
      console.warn(`Failed to delete ${name} directory:`, error);
    }
  }
  emit(null);
}

/** Raw access for other services that own their own tables (jobs). */
export { getDb };
