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

describe('review fixes', () => {
  test('real bullets starting with "No" are kept', () => {
    const { summary } = parseSummaryResponse('## Decisions\n- No new hires until Q3.\n- None', 'm', now);
    expect(summary.decisions).toEqual(['No new hires until Q3.']);
  });
});

describe('summaries written in other languages', () => {
  test('French headings and "Aucune" placeholders', () => {
    const raw = `## Titre
Revue du trimestre
## Résumé
L'équipe a validé le plan.
## Points clés
- Le périmètre est figé
## Actions à mener
- Ana : rédiger les notes de version
## Décisions
- Aucune`;
    const { title, summary } = parseSummaryResponse(raw, 'm', now);
    expect(title).toBe('Revue du trimestre');
    expect(summary.overview).toBe("L'équipe a validé le plan.");
    expect(summary.keyPoints).toEqual(['Le périmètre est figé']);
    expect(summary.actionItems).toEqual(['Ana : rédiger les notes de version']);
    expect(summary.decisions).toEqual([]);
  });

  test('bold German headings with a colon', () => {
    const raw = '**Zusammenfassung:**\nDas Team hat den Plan bestätigt.\n**Kernpunkte:**\n- Umfang steht\n**Aufgaben:**\n- Keine\n**Entscheidungen:**\n- Start am Freitag';
    const { summary } = parseSummaryResponse(raw, 'm', now);
    expect(summary.overview).toBe('Das Team hat den Plan bestätigt.');
    expect(summary.keyPoints).toEqual(['Umfang steht']);
    expect(summary.actionItems).toEqual([]);
    expect(summary.decisions).toEqual(['Start am Freitag']);
  });

  test('Arabic headings and placeholder', () => {
    const raw = '## العنوان\nمراجعة الخطة\n## الملخص\nراجع الفريق الخطة.\n## النقاط الرئيسية\n- النطاق ثابت\n## المهام\n- لا يوجد\n## القرارات\n- الإطلاق يوم الجمعة';
    const { title, summary } = parseSummaryResponse(raw, 'm', now);
    expect(title).toBe('مراجعة الخطة');
    expect(summary.overview).toBe('راجع الفريق الخطة.');
    expect(summary.keyPoints).toEqual(['النطاق ثابت']);
    expect(summary.actionItems).toEqual([]);
    expect(summary.decisions).toEqual(['الإطلاق يوم الجمعة']);
  });

  test('Chinese headings with a full-width colon and Japanese with numbered bullets', () => {
    const zh = parseSummaryResponse('## 标题：\n第三季度路线图\n## 摘要\n团队审查了路线图。\n## 要点\n- 范围已冻结\n## 待办事项\n- 无\n## 决定\n- 周五发布', 'm', now);
    expect(zh.title).toBe('第三季度路线图');
    expect(zh.summary.keyPoints).toEqual(['范围已冻结']);
    expect(zh.summary.actionItems).toEqual([]);
    expect(zh.summary.decisions).toEqual(['周五发布']);

    const ja = parseSummaryResponse('## 要約\nチームは計画を確認しました。\n## 要点\n1. 範囲は確定\n## 決定事項\n- なし', 'm', now);
    expect(ja.summary.overview).toBe('チームは計画を確認しました。');
    expect(ja.summary.keyPoints).toEqual(['範囲は確定']);
    expect(ja.summary.decisions).toEqual([]);
  });

  test('English headings with content in another language (what the prompt asks for)', () => {
    const { summary } = parseSummaryResponse('## Summary\nКоманда утвердила план.\n## Key points\n- Объём зафиксирован\n## Decisions\n- Нет', 'm', now);
    expect(summary.overview).toBe('Команда утвердила план.');
    expect(summary.keyPoints).toEqual(['Объём зафиксирован']);
    expect(summary.decisions).toEqual([]);
  });

  test('a bold line that is not a section stays as content', () => {
    const { summary } = parseSummaryResponse('## Summary\n**Note:**\nShipping Friday.', 'm', now);
    expect(summary.overview).toContain('Shipping Friday.');
  });

  test('titles lose guillemets, corner brackets and full-width punctuation', () => {
    const { cleanTitle } = require('../../services/ai/summaryParser');
    expect(cleanTitle('« Revue du plan »')).toBe('Revue du plan');
    expect(cleanTitle('「第三季度路线图」。')).toBe('第三季度路线图');
  });
});
