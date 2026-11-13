/**
 * Personal insights computed entirely on the phone from the notes table.
 * Pure: days are local calendar days, derived from the `now` passed in.
 */
import type { Note } from '../../types';

export interface Insights {
  totalNotes: number;
  recordedNotes: number;
  totalMinutes: number;
  totalWords: number;
  avgWordsPerMinute: number | null;
  currentStreak: number;
  longestStreak: number;
  last14Days: { date: string; minutes: number; notes: number }[];
  /** Recordings per hour of day, 0-23. */
  byHour: number[];
  topTags: { tag: string; count: number }[];
  summariesGenerated: number;
  /** Typing the same words at 40 wpm, minus the time spent recording. */
  minutesSaved: number;
}

const TYPING_WPM = 40;
const MIN_SECONDS_FOR_WPM = 5;

export function localDayKey(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function fromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function words(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function computeInsights(notes: Note[], now: Date): Insights {
  const recorded = notes.filter((n) => n.source === 'recording' && n.duration > 0);
  const totalSeconds = recorded.reduce((s, n) => s + n.duration, 0);
  const totalWords = notes.reduce((s, n) => s + words(n.transcription), 0);

  const wpmNotes = recorded.filter((n) => n.duration >= MIN_SECONDS_FOR_WPM);
  const wpmSeconds = wpmNotes.reduce((s, n) => s + n.duration, 0);
  const wpmWords = wpmNotes.reduce((s, n) => s + words(n.transcription), 0);
  const recordedWords = recorded.reduce((s, n) => s + words(n.transcription), 0);

  // Streaks over local days with at least one recording.
  const days = new Set(recorded.map((n) => localDayKey(n.createdAt)));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let cursor = days.has(localDayKey(today)) ? today : addDays(today, -1);
  let currentStreak = 0;
  while (days.has(localDayKey(cursor))) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }
  let longestStreak = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of [...days].sort()) {
    run = previous && localDayKey(addDays(fromDayKey(previous), 1)) === key ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = key;
  }

  const last14Days = Array.from({ length: 14 }, (_, i) => {
    const date = localDayKey(addDays(today, i - 13));
    return { date, minutes: 0, notes: 0 };
  });
  const index = new Map(last14Days.map((d, i) => [d.date, i]));
  const byHour = new Array<number>(24).fill(0);
  for (const n of recorded) {
    const i = index.get(localDayKey(n.createdAt));
    if (i !== undefined) {
      last14Days[i].minutes += n.duration / 60;
      last14Days[i].notes += 1;
    }
    byHour[n.createdAt.getHours()] += 1;
  }
  for (const d of last14Days) d.minutes = Math.round(d.minutes * 10) / 10;

  const tagCounts = new Map<string, number>();
  for (const n of notes) for (const t of n.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const topTags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 5);

  return {
    totalNotes: notes.length,
    recordedNotes: recorded.length,
    totalMinutes: Math.round((totalSeconds / 60) * 10) / 10,
    totalWords,
    avgWordsPerMinute: wpmSeconds > 0 ? Math.round(wpmWords / (wpmSeconds / 60)) : null,
    currentStreak,
    longestStreak,
    last14Days,
    byHour,
    topTags,
    summariesGenerated: notes.filter((n) => n.summary).length,
    minutesSaved: Math.max(0, Math.round(recordedWords / TYPING_WPM - totalSeconds / 60)),
  };
}
