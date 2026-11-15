/**
 * Turns whisper.cpp output into readable, subtitle-sized segments. Pure.
 */
import type { TranscriptSegment, TranscriptWord } from '../../types';
import { SENTENCE_END_CHARS } from '../text';

const SENTENCE_END = new RegExp(`[${SENTENCE_END_CHARS}]["')\\]」』»”]*$`);

export function groupWordsIntoSegments(
  words: TranscriptWord[],
  o: { maxGapSec?: number; maxChars?: number } = {}
): TranscriptSegment[] {
  const maxGap = o.maxGapSec ?? 0.8;
  const maxChars = o.maxChars ?? 84;
  const segments: TranscriptSegment[] = [];
  let current: TranscriptWord[] = [];
  let text = '';

  const flush = () => {
    if (current.length === 0) return;
    segments.push({ start: current[0].start, end: current[current.length - 1].end, text: text.trim(), words: current });
    current = [];
    text = '';
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    const candidate = (text + word.word).trim();
    if (previous && (word.start - previous.end > maxGap || candidate.length > maxChars)) flush();
    current.push(word);
    text += word.word;
    if (SENTENCE_END.test(word.word.trim())) flush();
  }
  flush();
  return segments;
}

// [_BEG_], [_TT_42], [BLANK_AUDIO]: whisper.cpp's markers, never speech.
const SPECIAL_TOKEN = /^\[_?[A-Z_]+(?:\d+)?_?\]$/;

/**
 * whisper.cpp reports t0/t1 in centiseconds. With one-token segments
 * (maxLen 1) it emits sub-word pieces: a piece that doesn't start with
 * whitespace continues the previous word. Empty pieces and bracketed special
 * tokens are dropped.
 */
export function wordsFromWhisperCpp(segments: { text: string; t0: number; t1: number }[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const s of segments) {
    if (s.text.trim().length === 0 || SPECIAL_TOKEN.test(s.text.trim())) continue;
    const previous = words[words.length - 1];
    if (previous && !/^\s/.test(s.text)) {
      previous.word += s.text;
      previous.end = s.t1 / 100;
    } else {
      words.push({ word: s.text, start: s.t0 / 100, end: s.t1 / 100 });
    }
  }
  return words;
}

/**
 * whisper.cpp's own phrase-level segments, used for scripts where
 * token-level output is unsafe (see `hasBrokenText`) or meaningless (no
 * spaces between words). Each phrase is one seek target; there are no
 * per-word timings.
 */
export function segmentsFromWhisperPhrases(segments: { text: string; t0: number; t1: number }[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const s of segments) {
    const text = s.text.trim();
    if (!text || SPECIAL_TOKEN.test(text)) continue;
    const start = s.t0 / 100;
    out.push({ start, end: Math.max(s.t1 / 100, start), text });
  }
  return out;
}

/** Joins phrase texts, with spaces only where the script uses them. */
export function joinPhrases(segments: TranscriptSegment[], unspaced: boolean): string {
  return segments
    .map((s) => s.text)
    .join(unspaced ? '' : ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whisper tokens are byte sequences, so a one-token segment can end in the
 * middle of a multi-byte character. Decoded on its own, that half shows up
 * as U+FFFD. When any piece carries one, the token-level pass can't be
 * trusted and the caller re-runs at phrase level.
 */
export function hasBrokenText(segments: { text: string }[]): boolean {
  return segments.some((s) => s.text.includes('�'));
}
