import { formatSrtTimestamp, toSrt, toText } from '../../services/export/generators';
import type { Note } from '../../types';

const note: Note = {
  id: '1',
  title: 'Standup',
  transcription: 'Hello team.',
  audioUri: null,
  duration: 65,
  tags: ['work'],
  pinned: false,
  createdAt: new Date('2026-01-02T10:00:00.000Z'),
  updatedAt: new Date('2026-01-02T10:00:00.000Z'),
  summary: null,
  language: null,
  source: 'recording',
  enhancement: 'none',
  enhancementProgress: 0,
  titleIsAuto: false,
  contentHash: null,
};

describe('formatSrtTimestamp', () => {
  test('formats hours, minutes, seconds and truncated milliseconds', () => {
    expect(formatSrtTimestamp(3725.9999)).toBe('01:02:05,999');
  });
  test('clamps negatives and NaN to zero', () => {
    expect(formatSrtTimestamp(-3)).toBe('00:00:00,000');
    expect(formatSrtTimestamp(Number.NaN)).toBe('00:00:00,000');
  });
});

describe('toSrt', () => {
  test('one cue per usable segment, in order', () => {
    const srt = toSrt(note, [
      { start: 2, end: 3, text: ' second ' },
      { start: 0, end: 1.5, text: 'first' },
      { start: 4, end: 4, text: 'zero-length' },
    ]);
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,500\nfirst\n\n2\n00:00:02,000 --> 00:00:03,000\nsecond\n');
  });
  test('falls back to a single cue spanning the note', () => {
    expect(toSrt(note, null)).toBe('1\n00:00:00,000 --> 00:01:05,000\nHello team.\n\n');
  });
});

describe('toText', () => {
  test('full scope includes a metadata header and the transcript', () => {
    const text = toText(note, { scope: 'full' });
    expect(text.startsWith('Standup\n')).toBe(true);
    expect(text).toContain('Tags: work');
    expect(text.trimEnd().endsWith('Hello team.')).toBe(true);
  });
});
