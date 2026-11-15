/**
 * Prompts for on-device summaries and titles, plus transcript chunking so
 * long meetings fit the small models' context. Pure.
 */
import type { Message } from 'react-native-executorch/legacy';

import { languageInfo, type Script } from '../../constants/languages';
import { SENTENCE_END_CHARS, countWords, scriptFor } from '../text';
import { DEFAULT_SUMMARY_STYLE, MAX_INSTRUCTIONS_CHARS, STYLE_GUIDANCE, type SummaryStyle } from './summaryStyles';

export { countWords };

/** ~1000 tokens of English: leaves room for instructions and output in a 4k context. */
export const LLM_CHUNK_CHARS = 4000;
/** Scripts without spaces run about one token per character. */
export const LLM_CHUNK_CHARS_CJK = 1500;

/**
 * Characters that come to roughly 1000 Qwen tokens in each script. Latin
 * text averages four characters per token; other scripts are split much
 * finer, so the same character budget would overflow the context.
 */
const CHUNK_CHARS: Record<Script, number> = {
  latin: LLM_CHUNK_CHARS,
  cyrillic: 2400,
  greek: 2000,
  arabic: 2000,
  hebrew: 2000,
  thai: 1600,
  cjk: LLM_CHUNK_CHARS_CJK,
  indic: 1400,
};

export function chunkLimit(text: string, language?: string | null): number {
  return CHUNK_CHARS[scriptFor(text, language)];
}

export interface SummaryOptions {
  style?: SummaryStyle;
  /** ISO code of the language to write in; null means "same as the transcript". */
  language?: string | null;
  /** The user's own extra instructions (Pro). */
  instructions?: string;
}

const FORMAT = `Reply in Markdown with exactly these sections:
## Title
(at most 8 words, no quotes)
## Summary
(2-4 sentences)
## Key points
- (bullets)
## Action items
- (bullets, "Owner: task" when an owner is named, or "None")
## Decisions
- (bullets, or "None")`;

/** Small models follow a named language far better than "the same language". */
function languageInstruction(language: string | null | undefined): string {
  const info = languageInfo(language);
  return info
    ? `Write the title, the summary and every bullet in ${info.name} (${info.endonym}).`
    : 'Write in the same language as the transcript.';
}

function systemPrompt(o: SummaryOptions): string {
  const instructions = o.instructions?.replace(/\s+/g, ' ').trim().slice(0, MAX_INSTRUCTIONS_CHARS);
  return [
    'You are a precise meeting and note assistant. Summarize only what the transcript says. Never invent names, numbers or decisions.',
    STYLE_GUIDANCE[o.style ?? DEFAULT_SUMMARY_STYLE],
    languageInstruction(o.language),
    FORMAT,
    'Keep the five section headings exactly as written above, in English.',
    instructions ? `Also follow this request from the user: ${instructions}` : null,
    '/no_think',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildSummaryMessages(chunk: string, mode: 'single' | 'partial', options: SummaryOptions = {}): Message[] {
  const intro =
    mode === 'single'
      ? 'Summarize this transcript.'
      : 'This is one part of a longer transcript. Summarize this part only.';
  return [
    { role: 'system', content: systemPrompt(options) },
    { role: 'user', content: `${intro}\n\nTranscript:\n"""\n${chunk}\n"""` },
  ];
}

export function buildMergeMessages(partials: string[], options: SummaryOptions = {}): Message[] {
  const joined = partials.map((p, i) => `### Part ${i + 1}\n${p}`).join('\n\n');
  return [
    { role: 'system', content: systemPrompt(options) },
    {
      role: 'user',
      content: `These are summaries of consecutive parts of one transcript. Merge them into one summary of the whole, removing duplicates.\n\n${joined}`,
    },
  ];
}

export function buildTitleMessages(text: string, language?: string | null): Message[] {
  const info = languageInfo(language);
  const inLanguage = info ? `Write it in ${info.name} (${info.endonym}).` : 'Same language as the note.';
  return [
    {
      role: 'system',
      content: `Write a short, specific title (at most 8 words) for this note. ${inLanguage} Reply with the title only, no quotes.\n/no_think`,
    },
    { role: 'user', content: text.slice(0, chunkLimit(text, language)) },
  ];
}

const SENTENCES = new RegExp(
  `[^${SENTENCE_END_CHARS}]+[${SENTENCE_END_CHARS}]+["')\\]」』»”]*\\s*|[^${SENTENCE_END_CHARS}]+$`,
  'g'
);

/** Splits on sentence boundaries; a sentence longer than the limit is split by words. */
export function chunkTranscript(text: string, maxCharsArg?: number, language?: string | null): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const maxChars = maxCharsArg ?? chunkLimit(clean, language);
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.match(SENTENCES) ?? [clean];
  const pieces: string[] = [];
  for (const s of sentences) {
    const sentence = s.trim();
    if (!sentence) continue;
    if (sentence.length <= maxChars) {
      pieces.push(sentence);
      continue;
    }
    let buffer = '';
    // Unspaced scripts split by character, everything else by word.
    const units = sentence.includes(' ') ? sentence.split(' ') : Array.from(sentence);
    const sep = sentence.includes(' ') ? ' ' : '';
    for (const word of units) {
      if (buffer && buffer.length + sep.length + word.length > maxChars) {
        pieces.push(buffer);
        buffer = word;
      } else {
        buffer = buffer ? `${buffer}${sep}${word}` : word;
      }
    }
    if (buffer) pieces.push(buffer);
  }

  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + 1 + piece.length > maxChars) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Title without the LLM: first sentence, or a trimmed opening, or a dated
 * placeholder (`emptyTitle` lets the caller supply a translated one).
 */
export function fallbackTitle(text: string, now: Date = new Date(), emptyTitle?: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) {
    if (emptyTitle) return emptyTitle;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `Note — ${MONTHS[now.getMonth()]} ${now.getDate()}, ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  // Western and Arabic/Indic stops need a following space; CJK stops don't.
  const first = clean.match(/^.+?(?:[.!?…؟۔।](?=\s|$)|[。！？])/)?.[0];
  if (first && first.length <= 60) return first;
  return clean.length <= 60 ? clean : `${clean.slice(0, 57)}…`;
}
