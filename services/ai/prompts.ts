/**
 * Prompts for on-device summaries and titles, plus transcript chunking so
 * long meetings fit the small models' context. Pure.
 */
import type { Message } from 'react-native-executorch/legacy';

/** ~1000 tokens: leaves room for instructions and output in a 4k context. */
export const LLM_CHUNK_CHARS = 4000;

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

const SYSTEM = `You are a precise meeting and note assistant. Summarize only what the transcript says. Never invent names, numbers or decisions. Write in the same language as the transcript. ${FORMAT}
/no_think`;

export function buildSummaryMessages(chunk: string, mode: 'single' | 'partial'): Message[] {
  const intro =
    mode === 'single'
      ? 'Summarize this transcript.'
      : 'This is one part of a longer transcript. Summarize this part only.';
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${intro}\n\nTranscript:\n"""\n${chunk}\n"""` },
  ];
}

export function buildMergeMessages(partials: string[]): Message[] {
  const joined = partials.map((p, i) => `### Part ${i + 1}\n${p}`).join('\n\n');
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `These are summaries of consecutive parts of one transcript. Merge them into one summary of the whole, removing duplicates.\n\n${joined}`,
    },
  ];
}

export function buildTitleMessages(text: string): Message[] {
  return [
    {
      role: 'system',
      content:
        'Write a short, specific title (at most 8 words) for this note. Same language as the note. Reply with the title only, no quotes.\n/no_think',
    },
    { role: 'user', content: text.slice(0, LLM_CHUNK_CHARS) },
  ];
}

/** Splits on sentence boundaries; a sentence longer than the limit is split by words. */
export function chunkTranscript(text: string, maxChars = LLM_CHUNK_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [clean];
  const pieces: string[] = [];
  for (const s of sentences) {
    const sentence = s.trim();
    if (sentence.length <= maxChars) {
      pieces.push(sentence);
      continue;
    }
    let buffer = '';
    for (const word of sentence.split(' ')) {
      if (buffer && buffer.length + 1 + word.length > maxChars) {
        pieces.push(buffer);
        buffer = word;
      } else {
        buffer = buffer ? `${buffer} ${word}` : word;
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

/** Title without the LLM: first sentence, or a trimmed opening, or the date. */
export function fallbackTitle(text: string, now: Date = new Date()): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `Note — ${MONTHS[now.getMonth()]} ${now.getDate()}, ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  const first = clean.match(/^.+?[.!?…](?=\s|$)/)?.[0];
  if (first && first.length <= 60) return first;
  return clean.length <= 60 ? clean : `${clean.slice(0, 57)}…`;
}
