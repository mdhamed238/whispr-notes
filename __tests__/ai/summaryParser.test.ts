import { parseSummaryResponse } from '../../services/ai/summaryParser';

const now = new Date('2026-03-01T12:00:00.000Z');

const WELL_FORMED = `## Title
Q3 roadmap review

## Summary
The team reviewed the Q3 roadmap and agreed to ship the beta on Friday.

## Key points
- Beta scope is frozen
- Two bugs remain open

## Action items
- Ana: write release notes
- Sam: fix login crash

## Decisions
- Ship the beta on Friday`;

describe('parseSummaryResponse', () => {
  test('reads every section of a well-formed response', () => {
    const { title, summary } = parseSummaryResponse(WELL_FORMED, 'qwen3-1.7b', now);
    expect(title).toBe('Q3 roadmap review');
    expect(summary.overview).toBe('The team reviewed the Q3 roadmap and agreed to ship the beta on Friday.');
    expect(summary.keyPoints).toEqual(['Beta scope is frozen', 'Two bugs remain open']);
    expect(summary.actionItems).toEqual(['Ana: write release notes', 'Sam: fix login crash']);
    expect(summary.decisions).toEqual(['Ship the beta on Friday']);
    expect(summary.model).toBe('qwen3-1.7b');
    expect(summary.generatedAt).toBe(now.toISOString());
  });

  test('ignores a <think> block before the answer', () => {
    const withThinking = `<think>\nLet me consider the structure...\n## Title\nWrong\n</think>\n${WELL_FORMED}`;
    expect(parseSummaryResponse(withThinking, 'm', now)).toEqual(parseSummaryResponse(WELL_FORMED, 'm', now));
  });

  test('plain prose without headings becomes the overview', () => {
    const { title, summary } = parseSummaryResponse('  The team agreed to ship Friday.  ', 'm', now);
    expect(title).toBeNull();
    expect(summary.overview).toBe('The team agreed to ship Friday.');
    expect(summary.keyPoints).toEqual([]);
  });

  test('empty output does not throw', () => {
    const { summary } = parseSummaryResponse('', 'm', now);
    expect(summary.overview).toBe('');
  });

  test('"None" bullets are dropped and headings are case-insensitive', () => {
    const { summary } = parseSummaryResponse('## SUMMARY\nShort.\n## action items\n- None\n## Decisions\n- none.', 'm', now);
    expect(summary.actionItems).toEqual([]);
    expect(summary.decisions).toEqual([]);
  });

  test('titles lose wrapping quotes and trailing punctuation', () => {
    expect(parseSummaryResponse('## Title\n"Q3 Planning."\n## Summary\nx', 'm', now).title).toBe('Q3 Planning');
  });

  test('accepts * bullets and numbered lists', () => {
    const { summary } = parseSummaryResponse('## Key points\n* One\n1. Two\n2) Three', 'm', now);
    expect(summary.keyPoints).toEqual(['One', 'Two', 'Three']);
  });
});
