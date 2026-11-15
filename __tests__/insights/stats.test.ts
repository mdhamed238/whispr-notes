import { computeInsights, localDayKey } from '../../services/insights/stats';
import type { Note } from '../../types';

const now = new Date(2026, 2, 10, 15, 0); // Mar 10 2026, 15:00 local

let seq = 0;
function note(at: Date, over: Partial<Note> = {}): Note {
  return {
    id: String(++seq),
    title: 't',
    transcription: 'one two three four five six seven eight nine ten',
    audioUri: 'file:///a.wav',
    duration: 60,
    tags: [],
    pinned: false,
    createdAt: at,
    updatedAt: at,
    summary: null,
    language: null,
    source: 'recording',
    enhancement: 'done',
    enhancementProgress: 1,
    titleIsAuto: true,
    contentHash: null,
    ...over,
  };
}
const day = (offset: number, h = 10, m = 0) => new Date(2026, 2, 10 + offset, h, m);

describe('computeInsights', () => {
  test('no notes gives zeros', () => {
    const i = computeInsights([], now);
    expect(i.totalNotes).toBe(0);
    expect(i.totalMinutes).toBe(0);
    expect(i.avgWordsPerMinute).toBeNull();
    expect(i.currentStreak).toBe(0);
    expect(i.last14Days).toHaveLength(14);
  });

  test('three consecutive days ending today is a streak of 3', () => {
    const i = computeInsights([note(day(0)), note(day(-1)), note(day(-2))], now);
    expect(i.currentStreak).toBe(3);
    expect(i.longestStreak).toBe(3);
  });

  test('a gap breaks the streak', () => {
    const i = computeInsights([note(day(0)), note(day(-3))], now);
    expect(i.currentStreak).toBe(1);
    expect(i.longestStreak).toBe(1);
  });

  test('a streak is still alive if the last recording was yesterday', () => {
    expect(computeInsights([note(day(-1)), note(day(-2))], now).currentStreak).toBe(2);
  });

  test('imported notes count as notes but not as recording time or speed', () => {
    const i = computeInsights([note(day(0)), note(day(0), { source: 'import', duration: 0 })], now);
    expect(i.totalNotes).toBe(2);
    expect(i.recordedNotes).toBe(1);
    expect(i.totalMinutes).toBe(1);
    expect(i.avgWordsPerMinute).toBe(10);
  });

  test('a late-evening note counts for its own local day', () => {
    const i = computeInsights([note(day(-1, 23, 30))], now);
    const yesterday = i.last14Days[i.last14Days.length - 2];
    expect(yesterday.date).toBe(localDayKey(day(-1)));
    expect(yesterday.notes).toBe(1);
    expect(i.byHour[23]).toBe(1);
  });

  test('last 14 days ends today', () => {
    const i = computeInsights([], now);
    expect(i.last14Days[13].date).toBe(localDayKey(now));
  });

  test('top tags are counted and capped at five', () => {
    const tags = ['a', 'b', 'c', 'd', 'e', 'f'];
    const notes = [note(day(0), { tags }), note(day(0), { tags: ['a'] })];
    const i = computeInsights(notes, now);
    expect(i.topTags[0]).toEqual({ tag: 'a', count: 2 });
    expect(i.topTags).toHaveLength(5);
  });

  test('time saved compares typing speed with recording time', () => {
    // 200 words typed at 40 wpm = 5 min; recorded in 1 min → 4 min saved.
    const words = Array.from({ length: 200 }, () => 'w').join(' ');
    expect(computeInsights([note(day(0), { transcription: words })], now).minutesSaved).toBe(4);
  });
});

describe('stored word counts and weekday habits', () => {
  test('list rows are counted from their stored word count, without a transcript', () => {
    const rows = [
      { source: 'recording' as const, duration: 120, createdAt: day(0), tags: ['a'], wordCount: 300, hasSummary: true },
      { source: 'import' as const, duration: 0, createdAt: day(0), tags: [], wordCount: 50, hasSummary: false },
    ];
    const i = computeInsights(rows, now);
    expect(i.totalWords).toBe(350);
    expect(i.avgWordsPerMinute).toBe(150);
    expect(i.summariesGenerated).toBe(1);
    expect(i.avgMinutesPerRecording).toBe(2);
  });

  test('recordings are grouped by weekday and the busiest hour is reported', () => {
    // 10 Mar 2026 is a Tuesday.
    const i = computeInsights([note(day(0, 9)), note(day(0, 9)), note(day(-1, 14))], now);
    expect(i.byWeekday[2]).toBe(2);
    expect(i.byWeekday[1]).toBe(1);
    expect(i.peakHour).toBe(9);
    expect(computeInsights([], now).peakHour).toBeNull();
    expect(computeInsights([], now).avgMinutesPerRecording).toBeNull();
  });
});
