/**
 * Pure conversions between the `Note` model and SQLite rows.
 *
 * Kept free of native imports so Jest can exercise them directly; the repo
 * (services/db/notesRepo.ts) is the only thing that talks to the database.
 */

import type { EnhancementState, Note, NoteSummary } from '../../types';

export interface NoteRow {
  id: string;
  title: string;
  transcription: string;
  audio_uri: string | null;
  duration: number;
  tags_json: string;
  pinned: number;
  created_at: string;
  updated_at: string;
  summary_json: string | null;
  language: string | null;
  source: string;
  enhancement: string;
  enhancement_progress: number;
  title_is_auto: number;
  content_hash: string | null;
}

/** Column order shared by INSERT statements. */
export const NOTE_COLUMNS: (keyof NoteRow)[] = [
  'id',
  'title',
  'transcription',
  'audio_uri',
  'duration',
  'tags_json',
  'pinned',
  'created_at',
  'updated_at',
  'summary_json',
  'language',
  'source',
  'enhancement',
  'enhancement_progress',
  'title_is_auto',
  'content_hash',
];

const ENHANCEMENT_STATES: EnhancementState[] = ['none', 'pending', 'running', 'done', 'failed'];

function parseJson<T>(text: string | null, fallback: T): T {
  if (text == null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function validDate(value: unknown, fallback: Date): Date {
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function parseSummary(text: string | null): NoteSummary | null {
  const raw = parseJson<Record<string, unknown> | null>(text, null);
  if (!raw || typeof raw !== 'object') return null;
  return {
    overview: typeof raw.overview === 'string' ? raw.overview : '',
    keyPoints: stringArray(raw.keyPoints),
    actionItems: stringArray(raw.actionItems),
    decisions: stringArray(raw.decisions),
    model: typeof raw.model === 'string' ? raw.model : '',
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
  };
}

export function rowToNote(row: NoteRow): Note {
  const createdAt = validDate(row.created_at, new Date());
  return {
    id: row.id,
    title: row.title,
    transcription: row.transcription,
    audioUri: row.audio_uri,
    duration: row.duration,
    tags: stringArray(parseJson<unknown>(row.tags_json, [])),
    pinned: row.pinned === 1,
    createdAt,
    updatedAt: validDate(row.updated_at, createdAt),
    summary: parseSummary(row.summary_json),
    language: row.language,
    source: row.source === 'import' ? 'import' : 'recording',
    enhancement: ENHANCEMENT_STATES.includes(row.enhancement as EnhancementState)
      ? (row.enhancement as EnhancementState)
      : 'none',
    enhancementProgress: row.enhancement_progress,
    titleIsAuto: row.title_is_auto === 1,
    contentHash: row.content_hash,
  };
}

/** Maps a single `Note` field to its column(s) and SQL value. */
function fieldToColumn(key: keyof Note, value: unknown): [keyof NoteRow, unknown] | null {
  switch (key) {
    case 'title':
      return ['title', value];
    case 'transcription':
      return ['transcription', value];
    case 'audioUri':
      return ['audio_uri', value ?? null];
    case 'duration':
      return ['duration', value];
    case 'tags':
      return ['tags_json', JSON.stringify(value ?? [])];
    case 'pinned':
      return ['pinned', value ? 1 : 0];
    case 'summary':
      return ['summary_json', value ? JSON.stringify(value) : null];
    case 'language':
      return ['language', value ?? null];
    case 'source':
      return ['source', value];
    case 'enhancement':
      return ['enhancement', value];
    case 'enhancementProgress':
      return ['enhancement_progress', value];
    case 'titleIsAuto':
      return ['title_is_auto', value ? 1 : 0];
    case 'contentHash':
      return ['content_hash', value ?? null];
    // id/createdAt are immutable; updatedAt is always set by the writer.
    default:
      return null;
  }
}

export function noteToRow(note: Note): NoteRow {
  return {
    id: note.id,
    title: note.title,
    transcription: note.transcription,
    audio_uri: note.audioUri,
    duration: note.duration,
    tags_json: JSON.stringify(note.tags),
    pinned: note.pinned ? 1 : 0,
    created_at: note.createdAt.toISOString(),
    updated_at: note.updatedAt.toISOString(),
    summary_json: note.summary ? JSON.stringify(note.summary) : null,
    language: note.language,
    source: note.source,
    enhancement: note.enhancement,
    enhancement_progress: note.enhancementProgress,
    title_is_auto: note.titleIsAuto ? 1 : 0,
    content_hash: note.contentHash,
  };
}

/**
 * Builds an UPDATE for a partial note. With `expectUpdatedAt` the write only
 * lands if nobody else has written the row since that moment
 * (compare-and-swap), which is how background passes avoid clobbering edits.
 */
export function buildUpdate(
  id: string,
  patch: Partial<Note>,
  now: Date,
  expectUpdatedAt?: Date
): { sql: string; params: (string | number | null)[] } {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  for (const key of Object.keys(patch) as (keyof Note)[]) {
    const mapped = fieldToColumn(key, patch[key]);
    if (!mapped) continue;
    sets.push(`${mapped[0]} = ?`);
    params.push(mapped[1] as string | number | null);
  }

  sets.push('updated_at = ?');
  params.push(now.toISOString());
  params.push(id);

  let sql = `UPDATE notes SET ${sets.join(', ')} WHERE id = ?`;
  if (expectUpdatedAt) {
    sql += ' AND updated_at = ?';
    params.push(expectUpdatedAt.toISOString());
  }
  return { sql, params };
}

/**
 * Turns free text into an FTS5 MATCH expression: every term becomes a quoted
 * prefix match, so "meet not" finds "meeting notes" and user-typed FTS
 * syntax can never produce a query error.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    .map((term) => term.replace(/"/g, ''))
    .filter((term) => term.length > 0);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"*`).join(' ');
}

/**
 * Normalizes a note stored by the old AsyncStorage service, including the
 * pre-notes `TranscriptionItem` shape (no title/tags/pinned/updatedAt, fake
 * 'streaming_recording' audioUri).
 */
export function normalizeLegacy(input: unknown): Note {
  const item = (input ?? {}) as Record<string, unknown>;
  const createdAt = validDate(item.createdAt, new Date());
  const transcription = typeof item.transcription === 'string' ? item.transcription : '';
  const title =
    typeof item.title === 'string' && item.title.length > 0
      ? item.title
      : transcription
        ? transcription.slice(0, 40)
        : 'Untitled note';
  const audioUri =
    typeof item.audioUri === 'string' && item.audioUri !== 'streaming_recording'
      ? item.audioUri
      : null;

  return {
    id: String(item.id ?? createdAt.getTime()),
    title,
    transcription,
    audioUri,
    duration: typeof item.duration === 'number' ? item.duration : 0,
    tags: stringArray(item.tags),
    pinned: item.pinned === true,
    createdAt,
    updatedAt: validDate(item.updatedAt, createdAt),
    summary: null,
    language: null,
    source: 'recording',
    enhancement: 'none',
    enhancementProgress: 0,
    titleIsAuto: true,
    contentHash: null,
  };
}
