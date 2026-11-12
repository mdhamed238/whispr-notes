import { tokenizeMarkdown } from '../services/markdown';

describe('tokenizeMarkdown', () => {
  test('headings, paragraphs and lists', () => {
    expect(tokenizeMarkdown('# A\n\npara **b**\n- x\n- y')).toEqual([
      { type: 'h1', spans: [{ text: 'A' }] },
      { type: 'p', spans: [{ text: 'para ' }, { text: 'b', bold: true }] },
      { type: 'list', items: [[{ text: 'x' }], [{ text: 'y' }]] },
    ]);
  });

  test('links and italics', () => {
    expect(tokenizeMarkdown('see [site](https://x.dev) and *this*')).toEqual([
      {
        type: 'p',
        spans: [{ text: 'see ' }, { text: 'site', href: 'https://x.dev' }, { text: ' and ' }, { text: 'this', italic: true }],
      },
    ]);
  });

  test('consecutive lines join into one paragraph; h2 and h3', () => {
    expect(tokenizeMarkdown('## Two\n### Three\nline one\nline two')).toEqual([
      { type: 'h2', spans: [{ text: 'Two' }] },
      { type: 'h3', spans: [{ text: 'Three' }] },
      { type: 'p', spans: [{ text: 'line one line two' }] },
    ]);
  });

  test('simple tables become rows of cells', () => {
    expect(tokenizeMarkdown('| A | B |\n|---|---|\n| 1 | 2 |')).toEqual([
      { type: 'table', rows: [['A', 'B'], ['1', '2']] },
    ]);
  });
});
