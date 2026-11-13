/**
 * Turns per-word timings into readable, subtitle-sized segments. Pure.
 */
import type { TranscriptSegment, TranscriptWord } from '../../types';

const SENTENCE_END = /[.!?…]["')\]]*$/;

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

/**
 * whisper.cpp reports t0/t1 in centiseconds. With one-token segments
 * (maxLen 1) it emits sub-word pieces: a piece that doesn't start with
 * whitespace continues the previous word. Empty pieces and bracketed special
 * tokens are dropped.
 */
export function wordsFromWhisperCpp(segments: { text: string; t0: number; t1: number }[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const s of segments) {
    if (s.text.trim().length === 0 || /^\[_?[A-Z_]+_?\]$/.test(s.text.trim())) continue;
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
