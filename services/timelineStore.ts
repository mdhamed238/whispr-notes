/**
 * Per-note storage for transcript timelines.
 *
 * Why these live in files rather than on the note
 * -----------------------------------------------
 * Every note is stored in a single AsyncStorage key (`transcriptions`), which
 * `getNotes()` reads and parses in full on every screen focus. Word timings
 * are by far the largest thing a note can carry — roughly 40 KB of JSON for a
 * five-minute recording, against a couple of KB for its text — so keeping
 * them inline would put megabytes on that hot path and push the blob toward
 * Android's 6 MB AsyncStorage ceiling (the library's default, which this app
 * does not override) after only a couple of hundred notes.
 *
 * A sidecar file per note keeps the notes blob small and the list screen
 * cheap, and means a timeline is only read when something actually needs it:
 * the detail screen and SRT/JSON export.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { TranscriptSegment } from '../types';

const TIMELINE_DIR_NAME = 'timelines';

/**
 * Note ids are generated from `Date.now()`, but they reach this module as
 * plain strings from stored data — so they are constrained to characters
 * that cannot escape the timelines directory before being used as a path.
 */
function isSafeId(noteId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(noteId);
}

/**
 * The last few timelines read or written, parsed. A note's screen reloads
 * on every write to its note (autosave, pin, a summary landing), and an
 * hour-long recording's timeline is around half a megabyte of JSON; without
 * this each reload read and parsed the file again.
 */
const CACHE_SIZE = 3;
const cache = new Map<string, TranscriptSegment[] | null>();

function remember(noteId: string, segments: TranscriptSegment[] | null): void {
  cache.delete(noteId);
  cache.set(noteId, segments);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

function timelineDirectory(): Directory {
  return new Directory(Paths.document, TIMELINE_DIR_NAME);
}

function timelineFile(noteId: string): File {
  return new File(timelineDirectory(), `${noteId}.json`);
}

/**
 * Writes a note's timeline, replacing any existing one.
 *
 * Best-effort like the pass that produces it: a failure here leaves the note
 * without word timings, which every consumer already handles.
 */
export function saveTimeline(noteId: string, segments: TranscriptSegment[]): void {
  if (!isSafeId(noteId)) return;

  try {
    const directory = timelineDirectory();
    if (!directory.exists) {
      directory.create({ intermediates: true, idempotent: true });
    }

    const file = timelineFile(noteId);
    file.create({ overwrite: true });
    file.write(JSON.stringify(segments));
    remember(noteId, segments.length > 0 ? segments : null);
  } catch (error) {
    cache.delete(noteId);
    console.warn('Failed to save transcript timeline:', error);
  }
}

/**
 * Reads a note's timeline, or `null` when it has none — which is the normal
 * case for notes recorded before timelines existed, notes whose pass failed,
 * and notes whose transcript has since been edited.
 */
export async function loadTimeline(noteId: string): Promise<TranscriptSegment[] | null> {
  if (!isSafeId(noteId)) return null;
  if (cache.has(noteId)) return cache.get(noteId) ?? null;

  try {
    const file = timelineFile(noteId);
    if (!file.exists) {
      remember(noteId, null);
      return null;
    }

    const parsed = JSON.parse(await file.text());
    const segments = Array.isArray(parsed) && parsed.length > 0 ? (parsed as TranscriptSegment[]) : null;
    remember(noteId, segments);
    return segments;
  } catch (error) {
    console.warn('Failed to read transcript timeline:', error);
    return null;
  }
}

/** Removes a note's timeline. Safe to call when there isn't one. */
export function deleteTimeline(noteId: string): void {
  if (!isSafeId(noteId)) return;
  remember(noteId, null);

  try {
    const file = timelineFile(noteId);
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    console.warn('Failed to delete transcript timeline:', error);
  }
}
