import {
  buildUpdate,
  normalizeLegacy,
  noteToRow,
  rowToNote,
  toFtsQuery,
} from '../../services/db/mapping';
import type { Note } from '../../types';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: '1700000000000',
    title: 'Q3 planning',
    transcription: 'We agreed to ship on Friday.',
    audioUri: 'file:///audio/1700000000000.wav',
    duration: 63.5,
    tags: ['work', 'planning'],
    pinned: true,
    createdAt: new Date('2026-01-02T10:00:00.000Z'),
    updatedAt: new Date('2026-01-02T10:05:00.000Z'),
    summary: {
      overview: 'Ship Friday.',
      keyPoints: ['Scope frozen'],
      actionItems: ['Ana: release notes'],
      decisions: ['Ship Friday'],
      model: 'qwen3-1.7b',
      generatedAt: '2026-01-02T10:06:00.000Z',
    },
    language: 'en',
    source: 'recording',
    enhancement: 'done',
    enhancementProgress: 1,
    titleIsAuto: true,
    contentHash: null,
    ...overrides,
  };
}

describe('rowToNote / noteToRow', () => {
  test('round-trips a fully populated note', () => {
    const note = makeNote();
    const back = rowToNote(noteToRow(note));
    expect(back).toEqual(note);
    expect(back.createdAt.getTime()).toBe(note.createdAt.getTime());
  });

  test('null summary and empty tags', () => {
    const row = { ...noteToRow(makeNote()), summary_json: null, tags_json: '[]' };
    const note = rowToNote(row);
    expect(note.summary).toBeNull();
    expect(note.tags).toEqual([]);
  });

  test('malformed tags json yields empty tags instead of throwing', () => {
    const row = { ...noteToRow(makeNote()), tags_json: 'not json' };
    expect(rowToNote(row).tags).toEqual([]);
  });
});

describe('toFtsQuery', () => {
  test('quotes each term as a prefix match', () => {
    expect(toFtsQuery('  meeting  notes ')).toBe('"meeting"* "notes"*');
  });

  test('strips quotes from terms', () => {
    expect(toFtsQuery('a"b')).toBe('"ab"*');
  });

  test('blank input gives null', () => {
    expect(toFtsQuery('   ')).toBeNull();
  });
});

describe('normalizeLegacy', () => {
  test('fills defaults and repairs a bad date', () => {
    const note = normalizeLegacy({ id: '1', transcription: 'hi', createdAt: 'bad' });
    expect(Number.isNaN(note.createdAt.getTime())).toBe(false);
    expect(note.source).toBe('recording');
    expect(note.enhancement).toBe('none');
    expect(note.titleIsAuto).toBe(true);
    expect(note.title).toBe('hi');
    expect(note.summary).toBeNull();
  });

  test('drops the old fake streaming audio uri', () => {
    expect(normalizeLegacy({ id: '2', audioUri: 'streaming_recording' }).audioUri).toBeNull();
  });
});

describe('buildUpdate', () => {
  test('compare-and-swap adds an updated_at guard', () => {
    const expect_ = new Date('2026-01-02T10:05:00.000Z');
    const { sql, params } = buildUpdate('42', { title: 'New' }, new Date('2026-02-01T00:00:00.000Z'), expect_);
    expect(sql).toContain('updated_at = ?');
    expect(sql).toMatch(/WHERE id = \? AND updated_at = \?$/);
    expect(params[params.length - 1]).toBe(expect_.toISOString());
    expect(params[params.length - 2]).toBe('42');
  });

  test('without a guard only matches on id', () => {
    const { sql, params } = buildUpdate('42', { pinned: true }, new Date('2026-02-01T00:00:00.000Z'));
    expect(sql).toMatch(/WHERE id = \?$/);
    expect(params).toContain(1);
  });

  test('never lets a patch change id or createdAt', () => {
    const { sql } = buildUpdate(
      '42',
      { id: 'x', createdAt: new Date() } as Partial<Note>,
      new Date('2026-02-01T00:00:00.000Z')
    );
    expect(sql).not.toContain('created_at');
    const setClause = sql.slice(sql.indexOf('SET'), sql.indexOf('WHERE'));
    expect(setClause).not.toMatch(/\bid = /);
  });
});
