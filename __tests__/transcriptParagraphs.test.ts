import { buildParagraphs, paragraphAt } from '../services/transcriptParagraphs';
import type { TranscriptSegment } from '../types';

function sentence(start: number, words: number, wordLength = 5): TranscriptSegment {
  const list = Array.from({ length: words }, (_, i) => ({
    word: ` ${'w'.repeat(wordLength)}`,
    start: start + i * 0.4,
    end: start + i * 0.4 + 0.35,
  }));
  return { start, end: list[list.length - 1].end, text: list.map((w) => w.word).join('').trim(), words: list };
}

describe('buildParagraphs', () => {
  test('keeps every word, in order', () => {
    const segments = [sentence(0, 10), sentence(5, 10), sentence(10, 10)];
    const paragraphs = buildParagraphs(segments);
    const words = paragraphs.flatMap((p) => p.words);
    expect(words).toHaveLength(30);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].start);
  });

  test('a long transcript becomes several paragraphs, each bounded', () => {
    const segments = Array.from({ length: 60 }, (_, i) => sentence(i * 5, 12));
    const paragraphs = buildParagraphs(segments);
    expect(paragraphs.length).toBeGreaterThan(5);
    for (const p of paragraphs) {
      // One sentence may run past the limit, never two.
      expect(p.words.reduce((n, w) => n + w.word.length, 0)).toBeLessThanOrEqual(420 + 12 * 6);
    }
  });

  test('breaks at a pause once there is enough text', () => {
    const paragraphs = buildParagraphs([sentence(0, 25), sentence(30, 5)]);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1].start).toBe(30);
  });

  test('a segment without word timings is one seek target', () => {
    const paragraphs = buildParagraphs([{ start: 2, end: 6, text: ' 今日は会議です ' }]);
    expect(paragraphs[0].words).toEqual([{ word: '今日は会議です', start: 2, end: 6 }]);
  });

  test('empty input gives no paragraphs', () => {
    expect(buildParagraphs([])).toEqual([]);
    expect(buildParagraphs([{ start: 0, end: 1, text: '  ' }])).toEqual([]);
  });
});

describe('paragraphAt', () => {
  const paragraphs = buildParagraphs([sentence(0, 25), sentence(30, 25), sentence(60, 25)]);
  test('finds the paragraph being spoken', () => {
    expect(paragraphAt(paragraphs, 0)).toBe(0);
    expect(paragraphAt(paragraphs, 31)).toBe(1);
    expect(paragraphAt(paragraphs, 65)).toBe(2);
  });
  test('silence between paragraphs and out-of-range times match nothing', () => {
    expect(paragraphAt(paragraphs, 20)).toBe(-1);
    expect(paragraphAt(paragraphs, 500)).toBe(-1);
    expect(paragraphAt([], 1)).toBe(-1);
  });
});
