/**
 * Parses the summarizer's Markdown into a NoteSummary. Small on-device
 * models drift from the format, so this is forgiving: thinking blocks are
 * stripped, headings are matched loosely, bullets may be -, * or numbered,
 * and prose with no headings becomes the overview.
 */
import type { NoteSummary } from '../../types';

type Section = 'title' | 'summary' | 'keyPoints' | 'actionItems' | 'decisions';

const HEADINGS: [RegExp, Section][] = [
  [/^title$/, 'title'],
  [/^(summary|overview)$/, 'summary'],
  [/^key\s*points?$/, 'keyPoints'],
  [/^(action\s*items?|next\s*steps?|to-?dos?)$/, 'actionItems'],
  [/^decisions?(\s*made)?$/, 'decisions'],
];

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
const NONE = /^(none|n\/a|no\b.*)\.?$/i;

export function stripThinking(raw: string): string {
  // Closed blocks first, then an unterminated one (model cut off mid-thought).
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
}

export function cleanTitle(raw: string): string | null {
  const t = raw
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/^["'“”‘’*_]+|["'“”‘’*_]+$/g, '')
    .replace(/[.!?:;,]+$/, '')
    .trim();
  if (!t) return null;
  return t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t;
}

export function parseSummaryResponse(
  raw: string,
  model: string,
  now: Date
): { title: string | null; summary: NoteSummary } {
  const text = stripThinking(raw);
  const buckets: Record<Section, string[]> = { title: [], summary: [], keyPoints: [], actionItems: [], decisions: [] };
  let section: Section | null = null;
  let sawHeading = false;

  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\s*#{1,6}\s*(.+?)\s*:?\s*$/) ?? line.match(/^\s*\*\*(.+?):?\*\*\s*:?\s*$/);
    if (heading) {
      const name = heading[1].toLowerCase().replace(/[^a-z\s-]/g, '').trim();
      const match = HEADINGS.find(([re]) => re.test(name));
      if (match) {
        section = match[1];
        sawHeading = true;
        continue;
      }
    }
    if (section && line.trim()) buckets[section].push(line);
  }

  const list = (lines: string[]) =>
    lines
      .map((l) => l.replace(BULLET, '').trim())
      .filter((l) => l.length > 0 && !NONE.test(l));

  if (!sawHeading) {
    return {
      title: null,
      summary: { overview: text.trim(), keyPoints: [], actionItems: [], decisions: [], model, generatedAt: now.toISOString() },
    };
  }

  return {
    title: buckets.title.length > 0 ? cleanTitle(buckets.title[0]) : null,
    summary: {
      overview: buckets.summary.map((l) => l.replace(BULLET, '').trim()).join(' ').trim(),
      keyPoints: list(buckets.keyPoints),
      actionItems: list(buckets.actionItems),
      decisions: list(buckets.decisions),
      model,
      generatedAt: now.toISOString(),
    },
  };
}
