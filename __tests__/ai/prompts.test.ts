import { chunkTranscript, fallbackTitle } from '../../services/ai/prompts';

describe('chunkTranscript', () => {
  test('no chunk exceeds the limit and nothing is lost', () => {
    const sentence = 'We discussed the launch plan in detail today. ';
    const text = sentence.repeat(220); // ~10 000 chars
    const chunks = chunkTranscript(text, 4000);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
    expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
  });

  test('short text is one chunk', () => {
    expect(chunkTranscript('Hello there.', 4000)).toEqual(['Hello there.']);
  });

  test('a single sentence longer than the limit is split by words', () => {
    const text = 'word '.repeat(2000).trim();
    for (const c of chunkTranscript(text, 4000)) expect(c.length).toBeLessThanOrEqual(4000);
  });
});

describe('fallbackTitle', () => {
  const now = new Date(2026, 2, 1, 9, 5);
  test('first sentence when short', () => {
    expect(fallbackTitle('Ship it. Then rest.', now)).toBe('Ship it.');
  });
  test('long text is cut with an ellipsis', () => {
    const t = fallbackTitle('a'.repeat(100), now);
    expect(t.length).toBe(58);
    expect(t.endsWith('…')).toBe(true);
  });
  test('empty text gets a dated title', () => {
    expect(fallbackTitle('   ', now)).toBe('Note — Mar 1, 09:05');
  });
});

describe('CJK handling', () => {
  const { countWords, chunkTranscript: chunk } = require('../../services/ai/prompts');
  test('counts CJK characters as words', () => {
    expect(countWords('我们今天讨论了第三季度的路线图')).toBeGreaterThanOrEqual(10);
    expect(countWords('two words')).toBe(2);
  });
  test('CJK chunks stay within the token budget', () => {
    const text = '我们讨论了路线图。'.repeat(600);
    for (const c of chunk(text)) expect(c.length).toBeLessThanOrEqual(1500);
  });
});
