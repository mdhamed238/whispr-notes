/**
 * "Ask this note": picks the parts of a transcript that bear on a question
 * and builds the prompt for the on-device model. Pure.
 *
 * The models have a small context, so a long meeting can't be handed over
 * whole. The transcript is cut into passages, each scored by how many of the
 * question's rarer words it contains, and the best ones (in their original
 * order) fill the budget. Short notes are passed in full.
 */
import type { Message } from 'react-native-executorch/legacy';

import { isUnspacedLanguage } from '../../constants/languages';
import type { NoteSummary } from '../../types';
import { dominantScript } from '../text';
import { chunkLimit, chunkTranscript } from './prompts';

export interface QaTurn {
  question: string;
  answer: string;
}

const PASSAGES_PER_BUDGET = 6;
const MAX_SUMMARY_CHARS = 600;
const MAX_HISTORY_TURNS = 2;
const MAX_HISTORY_CHARS = 300;
export const MAX_QUESTION_CHARS = 300;

const SEPARATORS = /[\s.,;:!?()[\]{}"'«»“”‘’¿¡،؛؟。、！？：；「」『』…\-–—/\\]+/;
const ALL_SEPARATORS = new RegExp(SEPARATORS.source, 'g');

/**
 * Search terms from a question. Spaced scripts: words of three letters or
 * more, cut to a stem-like prefix so inflected forms still match
 * ("deadlines" finds "deadline"). Unspaced scripts: character pairs.
 */
export function queryTerms(question: string, language?: string | null): string[] {
  const text = question.toLowerCase();
  const script = dominantScript(text);
  const unspaced = isUnspacedLanguage(language) || script === 'thai' || (script === 'cjk' && !/[가-힯]/.test(text));
  const terms = new Set<string>();
  if (unspaced) {
    const chars = Array.from(text.replace(ALL_SEPARATORS, ''));
    for (let i = 0; i + 1 < chars.length; i++) terms.add(chars[i] + chars[i + 1]);
  } else {
    for (const word of text.split(SEPARATORS)) {
      if (word.length < 3) continue;
      terms.add(word.length > 5 ? word.slice(0, Math.max(4, Math.ceil(word.length * 0.7))) : word);
    }
  }
  return [...terms];
}

/** The passages most relevant to the question, in transcript order, within the budget. */
export function selectPassages(
  transcript: string,
  question: string,
  language?: string | null,
  budgetChars?: number
): string[] {
  const clean = transcript.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const budget = budgetChars ?? chunkLimit(clean, language);
  if (clean.length <= budget) return [clean];

  const passages = chunkTranscript(clean, Math.max(120, Math.floor(budget / PASSAGES_PER_BUDGET)), language);
  const lowered = passages.map((p) => p.toLowerCase());
  const terms = queryTerms(question, language);

  // Rarer terms say more about which passage is meant.
  const weights = terms.map((term) => {
    const found = lowered.filter((p) => p.includes(term)).length;
    return found === 0 ? 0 : Math.log(1 + passages.length / found);
  });
  const scored = lowered.map((p, index) => ({
    index,
    score: terms.reduce((sum, term, t) => (weights[t] > 0 && p.includes(term) ? sum + weights[t] : sum), 0),
  }));

  // Best first; when nothing matches (e.g. "what is this about?"), keep the
  // transcript's own order so the answer is based on its opening.
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen: number[] = [];
  let used = 0;
  for (const { index } of ranked) {
    const length = passages[index].length + 1;
    if (used + length > budget) continue;
    chosen.push(index);
    used += length;
  }
  return chosen.sort((a, b) => a - b).map((index) => passages[index]);
}

function summaryBlock(summary: NoteSummary | null): string {
  if (!summary) return '';
  const parts = [summary.overview, ...summary.keyPoints.map((p) => `- ${p}`)].filter(Boolean).join('\n');
  return parts ? `Summary of the whole note:\n${parts.slice(0, MAX_SUMMARY_CHARS)}\n\n` : '';
}

export function buildAskMessages(input: {
  transcript: string;
  summary: NoteSummary | null;
  question: string;
  history?: QaTurn[];
  language?: string | null;
}): Message[] {
  const question = input.question.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_CHARS);
  const passages = selectPassages(input.transcript, question, input.language);
  const partial = passages.length !== 1 || passages[0].length < input.transcript.replace(/\s+/g, ' ').trim().length;
  const history = (input.history ?? [])
    .slice(-MAX_HISTORY_TURNS)
    .map(
      (turn) =>
        `Earlier question: ${turn.question.slice(0, MAX_HISTORY_CHARS)}\nEarlier answer: ${turn.answer.slice(0, MAX_HISTORY_CHARS)}`
    )
    .join('\n');

  return [
    {
      role: 'system',
      content:
        'You answer questions about one transcript. Use only the transcript and summary you are given. ' +
        'If they do not contain the answer, say that the note does not mention it. Never invent names, numbers or decisions. ' +
        'Be concise: a few sentences or a short list. Answer in the language of the question.\n/no_think',
    },
    {
      role: 'user',
      content:
        summaryBlock(input.summary) +
        `${partial ? 'Relevant parts of the transcript' : 'Transcript'}:\n"""\n${passages.join('\n…\n')}\n"""\n\n` +
        (history ? `${history}\n\n` : '') +
        `Question: ${question}`,
    },
  ];
}
