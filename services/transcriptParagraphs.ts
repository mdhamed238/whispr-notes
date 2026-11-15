/**
 * Groups a transcript timeline into paragraphs for the tappable transcript.
 *
 * The whole transcript used to be one text block that re-rendered on every
 * playback tick: thousands of word elements, several times a second, for an
 * hour-long meeting. As paragraphs, only the one being spoken re-renders.
 * Breaks fall on segment (sentence) boundaries, at a pause or once a
 * paragraph is long enough. Pure.
 */
import type { TranscriptSegment, TranscriptWord } from '../types';

export interface TranscriptParagraph {
  start: number;
  end: number;
  words: TranscriptWord[];
}

const MAX_CHARS = 420;
const MIN_CHARS_BEFORE_PAUSE_BREAK = 120;
const PAUSE_SECONDS = 1.5;

export function buildParagraphs(segments: TranscriptSegment[]): TranscriptParagraph[] {
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  const paragraphs: TranscriptParagraph[] = [];
  let words: TranscriptWord[] = [];
  let chars = 0;

  const flush = () => {
    if (words.length === 0) return;
    paragraphs.push({ start: words[0].start, end: words[words.length - 1].end, words });
    words = [];
    chars = 0;
  };

  for (const segment of ordered) {
    // A segment without word timings still contributes itself: a coarser
    // seek target beats a gap.
    const pieces: TranscriptWord[] =
      segment.words && segment.words.length > 0
        ? segment.words
        : segment.text.trim().length > 0
          ? [{ word: segment.text.trim(), start: segment.start, end: segment.end }]
          : [];
    if (pieces.length === 0) continue;

    const pause = words.length > 0 ? pieces[0].start - words[words.length - 1].end : 0;
    if (chars >= MAX_CHARS || (chars >= MIN_CHARS_BEFORE_PAUSE_BREAK && pause > PAUSE_SECONDS)) flush();

    for (const piece of pieces) {
      words.push(piece);
      chars += piece.word.length;
    }
  }
  flush();
  return paragraphs;
}

/** Index of the paragraph being spoken at `time`, or -1 between paragraphs. */
export function paragraphAt(paragraphs: TranscriptParagraph[], time: number): number {
  let low = 0;
  let high = paragraphs.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const p = paragraphs[mid];
    if (time < p.start) high = mid - 1;
    else if (time >= p.end) low = mid + 1;
    else return mid;
  }
  return -1;
}
