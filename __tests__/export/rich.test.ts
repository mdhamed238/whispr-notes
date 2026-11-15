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

describe('exports in other languages', () => {
  const { DEFAULT_EXPORT_LABELS, toText } = require('../../services/export/generators');
  const labels = {
    ...DEFAULT_EXPORT_LABELS,
    summary: 'Résumé',
    keyPoints: 'Points clés',
    actionItems: 'Actions',
    decisions: 'Décisions',
    transcript: 'Transcription',
    tags: 'Étiquettes',
  };

  test('section names are translated in Markdown and text', () => {
    const md = toMarkdown(note, { scope: 'full', segments: null, timestamps: false, labels });
    expect(md).toContain('## Résumé');
    expect(md).toContain('## Actions\n\n- [ ] Ana: notes');
    expect(md).toContain('## Transcription');
    const text = toText(note, { scope: 'full', labels });
    expect(text).toContain('RÉSUMÉ');
    expect(text).toContain('POINTS CLÉS');
  });

  test('file names keep letters of other scripts', () => {
    expect(slugify('会议记录 2026')).toBe('会议记录-2026');
    expect(slugify('Заметки о встрече!')).toBe('заметки-о-встрече');
    expect(slugify('ملاحظات الاجتماع')).toBe('ملاحظات-الاجتماع');
    expect(slugify('회의 메모')).toBe('회의-메모');
    expect(slugify('a/b\\c:d*e?"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i');
    expect(Array.from(slugify('字'.repeat(200)))).toHaveLength(60);
  });

  test('an Arabic note is laid out right to left, a Latin one left to right', () => {
    const arabic = buildPdfHtml(
      { ...note, title: 'مراجعة الخطة', transcription: 'ناقشنا خطة الربع القادم.', language: 'ar', summary: null },
      { scope: 'full', segments: null, timestamps: false }
    );
    expect(arabic).toContain('dir="rtl"');
    expect(arabic).toContain('lang="ar"');
    expect(buildPdfHtml(note, { scope: 'full', segments: null, timestamps: false })).toContain('dir="ltr"');
  });

  test('translated labels are escaped into the PDF', () => {
    const out = buildPdfHtml(note, { scope: 'full', segments: null, timestamps: false, labels: { ...labels, summary: 'R&D <résumé>' } });
    expect(out).toContain('R&amp;D &lt;résumé&gt;');
  });
});
