/**
 * Summary styles: what the summary model is asked to pull out of a
 * transcript. Every style fills the same four sections (overview, key
 * points, action items, decisions), so notes stay comparable and exports
 * keep one shape; the style changes the emphasis. Pure data.
 */
export const SUMMARY_STYLES = ['meeting', 'lecture', 'interview', 'memo', 'brief'] as const;
export type SummaryStyle = (typeof SUMMARY_STYLES)[number];

export const DEFAULT_SUMMARY_STYLE: SummaryStyle = 'meeting';

/** Styles other than the default are part of Pro. */
export function isProStyle(style: SummaryStyle): boolean {
  return style !== DEFAULT_SUMMARY_STYLE;
}

export function isSummaryStyle(value: unknown): value is SummaryStyle {
  return typeof value === 'string' && (SUMMARY_STYLES as readonly string[]).includes(value);
}

/** Guidance appended to the system prompt. English: the model follows it best. */
export const STYLE_GUIDANCE: Record<SummaryStyle, string> = {
  meeting:
    'Treat it as a meeting. Key points: what was discussed. Action items: who does what next. Decisions: what was agreed.',
  lecture:
    'Treat it as a lecture or class. Key points: the main concepts, each explained in one line, with definitions and examples the speaker gave. Action items: assignments, readings and deadlines. Decisions: leave as "None" unless something was announced.',
  interview:
    'Treat it as an interview or conversation between people. Key points: the most important answers and facts, attributed to the speaker when names are given. Action items: agreed follow-ups. Decisions: outcomes that were agreed.',
  memo:
    'Treat it as a personal voice memo. Key points: the main ideas and thoughts. Action items: things the speaker wants to do or remember, as a to-do list. Decisions: choices the speaker made.',
  brief:
    'Be very brief. Summary: one or two sentences. Key points: at most three. Include action items and decisions only if they are explicit.',
};

/** How long a user's own instructions may be (they share the model's context). */
export const MAX_INSTRUCTIONS_CHARS = 280;
