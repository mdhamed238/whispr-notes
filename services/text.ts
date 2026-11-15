/**
 * Script-aware text helpers shared by the summarizer, statistics and
 * exports. Pure, and written with explicit Unicode ranges rather than
 * `\p{…}` classes so they behave identically on Hermes and in Jest.
 */
import { languageInfo, type Script } from '../constants/languages';

// Han, kana and hangul: counted per character.
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;
const THAI = /[฀-๿]/g;
/** Thai has no spaces; a word averages about four characters. */
const THAI_CHARS_PER_WORD = 4;

/** Words for spaced scripts; each CJK character counts as one. */
export function countWords(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const thai = text.match(THAI)?.length ?? 0;
  const rest = text.replace(CJK, ' ').replace(THAI, ' ').trim();
  return cjk + Math.round(thai / THAI_CHARS_PER_WORD) + (rest ? rest.split(/\s+/).length : 0);
}

const SCRIPT_RANGES: [Script, RegExp][] = [
  ['cjk', CJK],
  ['thai', THAI],
  ['cyrillic', /[Ѐ-ԯ]/g],
  ['greek', /[Ͱ-Ͽἀ-῿]/g],
  ['arabic', /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g],
  ['hebrew', /[֐-׿]/g],
  ['indic', /[ऀ-෿]/g],
];

/** The writing system most of the text is in. Latin unless another clearly dominates. */
export function dominantScript(text: string): Script {
  const letters = text.replace(/[\s\d.,;:!?'"()\-–—]/g, '').length;
  if (letters === 0) return 'latin';
  let best: Script = 'latin';
  let bestCount = 0;
  for (const [script, range] of SCRIPT_RANGES) {
    const count = text.match(range)?.length ?? 0;
    if (count > bestCount) {
      best = script;
      bestCount = count;
    }
  }
  return bestCount / letters > 0.3 ? best : 'latin';
}

/** The script to assume for a text: its language's when known, else detected. */
export function scriptFor(text: string, language?: string | null): Script {
  return languageInfo(language)?.script ?? dominantScript(text);
}

/** True for text that reads right to left (Arabic, Hebrew, Persian, Urdu). */
export function isRtlText(text: string, language?: string | null): boolean {
  const info = languageInfo(language);
  if (info) return info.rtl === true;
  const script = dominantScript(text.slice(0, 400));
  return script === 'arabic' || script === 'hebrew';
}

/** Sentence-ending punctuation across the supported scripts. */
export const SENTENCE_END_CHARS = '.!?…。！？؟۔।';
