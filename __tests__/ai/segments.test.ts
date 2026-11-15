import { groupWordsIntoSegments, wordsFromWhisperCpp } from '../../services/ai/segments';

describe('groupWordsIntoSegments', () => {
  test('splits on sentence end and on long gaps', () => {
    const segments = groupWordsIntoSegments([
      { word: 'Hello', start: 0, end: 0.4 },
      { word: ' world.', start: 0.5, end: 0.9 },
      { word: ' Next', start: 2.0, end: 2.3 },
    ]);
    expect(segments).toEqual([
      { start: 0, end: 0.9, text: 'Hello world.', words: [
        { word: 'Hello', start: 0, end: 0.4 },
        { word: ' world.', start: 0.5, end: 0.9 },
      ] },
      { start: 2.0, end: 2.3, text: 'Next', words: [{ word: ' Next', start: 2.0, end: 2.3 }] },
    ]);
  });

  test('a long unbroken run is capped at maxChars per segment', () => {
    const words = Array.from({ length: 30 }, (_, i) => ({ word: ' alpha', start: i * 0.3, end: i * 0.3 + 0.25 }));
    const segments = groupWordsIntoSegments(words);
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) expect(s.text.length).toBeLessThanOrEqual(84);
  });

  test('empty input gives no segments', () => {
    expect(groupWordsIntoSegments([])).toEqual([]);
  });
});

describe('wordsFromWhisperCpp', () => {
  test('converts centisecond t0/t1 to seconds and drops empty or special tokens', () => {
    expect(
      wordsFromWhisperCpp([
        { text: ' Hi', t0: 10, t1: 42 },
        { text: '', t0: 42, t1: 50 },
        { text: '[_BEG_]', t0: 0, t1: 0 },
        { text: ' there', t0: 50, t1: 90 },
      ])
    ).toEqual([
      { word: ' Hi', start: 0.1, end: 0.42 },
      { word: ' there', start: 0.5, end: 0.9 },
    ]);
  });

  test('merges sub-word token pieces into whole words', () => {
    expect(
      wordsFromWhisperCpp([
        { text: ' Hel', t0: 0, t1: 20 },
        { text: 'lo', t0: 20, t1: 35 },
        { text: ',', t0: 35, t1: 36 },
        { text: ' world', t0: 40, t1: 80 },
      ])
    ).toEqual([
      { word: ' Hello,', start: 0, end: 0.36 },
      { word: ' world', start: 0.4, end: 0.8 },
    ]);
  });
});

describe('phrase-level output', () => {
  const { hasBrokenText, joinPhrases, segmentsFromWhisperPhrases } = require('../../services/ai/segments');

  test('phrases become seek targets without word timings', () => {
    expect(
      segmentsFromWhisperPhrases([
        { text: ' 今日は会議です。', t0: 0, t1: 250 },
        { text: '', t0: 250, t1: 260 },
        { text: '[_TT_42]', t0: 260, t1: 260 },
        { text: ' 次は金曜日。', t0: 300, t1: 520 },
      ])
    ).toEqual([
      { start: 0, end: 2.5, text: '今日は会議です。' },
      { start: 3, end: 5.2, text: '次は金曜日。' },
    ]);
  });

  test('phrases are joined with spaces only where the script uses them', () => {
    const segments = [
      { start: 0, end: 1, text: '今日は会議です。' },
      { start: 1, end: 2, text: '次は金曜日。' },
    ];
    expect(joinPhrases(segments, true)).toBe('今日は会議です。次は金曜日。');
    expect(joinPhrases([{ start: 0, end: 1, text: 'Bonjour à tous.' }, { start: 1, end: 2, text: 'On commence.' }], false)).toBe(
      'Bonjour à tous. On commence.'
    );
  });

  test('a character split across tokens is detected', () => {
    expect(hasBrokenText([{ text: ' Привет' }, { text: ' ми\uFFFD' }])).toBe(true);
    expect(hasBrokenText([{ text: ' Привет' }, { text: ' мир' }])).toBe(false);
  });

  test('sentence ends in other scripts close a segment', () => {
    const segments = groupWordsIntoSegments([
      { word: ' هل', start: 0, end: 0.3 },
      { word: ' انتهينا؟', start: 0.3, end: 0.8 },
      { word: ' نعم', start: 0.9, end: 1.2 },
    ]);
    expect(segments.map((s) => s.text)).toEqual(['هل انتهينا؟', 'نعم']);
  });
});
