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
