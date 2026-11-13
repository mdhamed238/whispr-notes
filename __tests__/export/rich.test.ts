import { slugify, toMarkdown } from '../../services/export/generators';
import { buildPdfHtml } from '../../services/export/pdfTemplate';
import type { Note } from '../../types';

const note: Note = {
  id: '1',
  title: 'Q3 "plan"',
  transcription: 'Opening remarks. <script>alert(1)</script> Then numbers.',
  audioUri: null,
  duration: 125,
  tags: ['work', 'q3'],
  pinned: false,
  createdAt: new Date('2026-01-02T10:00:00.000Z'),
  updatedAt: new Date('2026-01-02T10:00:00.000Z'),
  summary: {
    overview: 'We set the Q3 plan.',
    keyPoints: ['Scope frozen'],
    actionItems: ['Ana: notes'],
    decisions: [],
    model: 'qwen3-1.7b',
    generatedAt: '2026-01-02T10:06:00.000Z',
  },
  language: 'en',
  source: 'recording',
  enhancement: 'done',
  enhancementProgress: 1,
  titleIsAuto: false,
  contentHash: null,
};

const segments = [
  { start: 0, end: 4, text: 'Opening remarks.' },
  { start: 65, end: 70, text: 'Then numbers.' },
];

describe('toMarkdown', () => {
  test('front matter escapes quotes and lists tags', () => {
    const md = toMarkdown(note, { scope: 'full', segments: null, timestamps: false });
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('title: "Q3 \\"plan\\""');
    expect(md).toContain('tags: ["work", "q3"]');
    expect(md).toContain('date: 2026-01-02T10:00:00.000Z');
    expect(md).toContain('# Q3 "plan"');
  });

  test('summary sections render as Markdown and empty ones are skipped', () => {
    const md = toMarkdown(note, { scope: 'summary', segments: null, timestamps: false });
    expect(md).toContain('## Summary\n\nWe set the Q3 plan.');
    expect(md).toContain('## Action items\n\n- [ ] Ana: notes');
    expect(md).not.toContain('## Decisions');
    expect(md).not.toContain('## Transcript');
  });

  test('timestamps stamp each paragraph from the timeline', () => {
    const md = toMarkdown(note, { scope: 'full', segments, timestamps: true });
    expect(md).toContain('[00:00] Opening remarks.');
    expect(md).toContain('[01:05] Then numbers.');
  });
});

describe('buildPdfHtml', () => {
  const html = buildPdfHtml(note, { scope: 'full', segments, timestamps: false });
  test('escapes note text', () => {
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
  test('loads nothing from the network', () => {
    expect(/https?:\/\//.test(html)).toBe(false);
  });
  test('includes the summary and the transcript', () => {
    expect(html).toContain('We set the Q3 plan.');
    expect(html).toContain('Then numbers.');
  });
});

describe('slugify', () => {
  test('makes a safe file name', () => {
    expect(slugify('Q3: Plan / Review!')).toBe('q3-plan-review');
    expect(slugify('Café réunion')).toBe('cafe-reunion');
  });
  test('falls back to "note"', () => {
    expect(slugify('')).toBe('note');
    expect(slugify('***')).toBe('note');
  });
});

describe('front matter safety', () => {
  test('tags are quoted so they cannot break or inject YAML', () => {
    const md = toMarkdown({ ...note, tags: ['a, b]', 'x\ninjected: true'] }, { scope: 'full', segments: null, timestamps: false });
    expect(md).toContain('tags: ["a, b]", "x injected: true"]');
    expect(md).not.toMatch(/^injected: true$/m);
  });
  test('language is quoted too', () => {
    expect(toMarkdown({ ...note, language: 'en\nx: 1' }, { scope: 'full', segments: null, timestamps: false })).toContain('language: "en x: 1"');
  });
});
