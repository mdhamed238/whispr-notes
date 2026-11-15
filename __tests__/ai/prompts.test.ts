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

describe('language-aware prompts', () => {
  const { buildSummaryMessages, buildTitleMessages, buildMergeMessages, chunkLimit } = require('../../services/ai/prompts');

  test('a known language is named explicitly; an unknown one is left to the transcript', () => {
    const named = buildSummaryMessages('texte', 'single', { language: 'fr' })[0].content;
    expect(named).toContain('in French (Français)');
    expect(named).not.toContain('same language as the transcript');
    const unknown = buildSummaryMessages('text', 'single')[0].content;
    expect(unknown).toContain('same language as the transcript');
  });

  test('headings are pinned to English and thinking is switched off', () => {
    const system = buildSummaryMessages('text', 'single', { language: 'ar' })[0].content;
    expect(system).toContain('## Key points');
    expect(system).toContain('exactly as written above, in English');
    expect(system.trim().endsWith('/no_think')).toBe(true);
  });

  test('style guidance and user instructions reach the model, instructions are capped', () => {
    const system = buildSummaryMessages('text', 'single', { style: 'lecture', instructions: `Use   British spelling ${'x'.repeat(500)}` })[0].content;
    expect(system).toContain('lecture or class');
    expect(system).toContain('Use British spelling');
    expect(system.length).toBeLessThan(1900);
    expect(buildMergeMessages(['a', 'b'], { style: 'brief' })[0].content).toContain('Be very brief');
  });

  test('titles follow the requested language', () => {
    expect(buildTitleMessages('ملاحظة', 'ar')[0].content).toContain('in Arabic');
    expect(buildTitleMessages('note')[0].content).toContain('Same language as the note');
  });

  test('chunk budgets shrink for scripts that cost more tokens per character', () => {
    expect(chunkLimit('plain english text')).toBe(4000);
    expect(chunkLimit('Мы обсудили план')).toBeLessThan(4000);
    expect(chunkLimit('ناقشنا الخطة')).toBeLessThan(chunkLimit('Мы обсудили план'));
    expect(chunkLimit('हमने योजना पर चर्चा की')).toBeLessThan(chunkLimit('ناقشنا الخطة'));
    expect(chunkLimit('anything', 'ja')).toBe(1500);
  });

  test('Arabic and Hindi transcripts split on their own sentence marks', () => {
    const arabic = 'هل انتهينا من الخطة؟ نعم، سنبدأ يوم الجمعة. '.repeat(120);
    for (const c of chunkTranscript(arabic)) expect(c.length).toBeLessThanOrEqual(2000);
    const hindi = 'हमने योजना पर चर्चा की। अगला कदम शुक्रवार को है। '.repeat(120);
    const chunks = chunkTranscript(hindi);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.endsWith('।')).toBe(true);
  });

  test('fallback titles take a CJK first sentence and a translated placeholder', () => {
    expect(fallbackTitle('今日は会議です。次は金曜日。')).toBe('今日は会議です。');
    expect(fallbackTitle('  ', new Date(), 'Note — 1 mars')).toBe('Note — 1 mars');
  });
});
