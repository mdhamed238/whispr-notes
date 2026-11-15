/**
 * Whisper through whisper.cpp (whisper.rn): Large-v3 Turbo for the best
 * accuracy, or the multilingual Base model everyone gets. Runs on the saved
 * WAV after recording, in 30-second windows, so recordings of any length
 * work; reports real progress and can be stopped.
 */
import { initWhisper, type WhisperContext } from 'whisper.rn/index';

import { AUTO_LANGUAGE, isUnspacedLanguage } from '../../../constants/languages';
import type { TranscriptSegment } from '../../../types';
import { modelPath } from '../modelManager';
import {
  groupWordsIntoSegments,
  hasBrokenText,
  joinPhrases,
  segmentsFromWhisperPhrases,
  wordsFromWhisperCpp,
} from '../segments';
import { AbortedError, EngineLoadError, type TranscriptionEngine } from './types';

export type WhisperCppModel = 'whisper-large-v3-turbo' | 'whisper-base';

/**
 * 'words': one token per segment with timestamps, stitched back into words,
 * for tap-a-word playback. 'phrases': whisper's own segments, for scripts
 * written without spaces and whenever token-level text comes back damaged.
 */
type Mode = 'words' | 'phrases';

export async function createWhisperRnEngine(id: WhisperCppModel): Promise<TranscriptionEngine> {
  const path = modelPath(id);
  if (!path) throw new EngineLoadError(id, new Error('model not downloaded'));

  let context: WhisperContext;
  try {
    context = await initWhisper({ filePath: path });
  } catch (error) {
    throw new EngineLoadError(id, error);
  }

  return {
    id,
    async transcribeFile(uri, o) {
      if (o.signal.aborted) throw new AbortedError();
      const filePath = decodeURI(uri.replace(/^file:\/\//, ''));

      let stopCurrent: (() => Promise<void>) | null = null;
      const onAbort = () => void stopCurrent?.();
      o.signal.addEventListener('abort', onAbort);

      const run = async (mode: Mode) => {
        const { stop, promise } = context.transcribe(filePath, {
          language: o.language,
          ...(mode === 'words' ? { tokenTimestamps: true, maxLen: 1 } : {}),
          onProgress: (p) => o.onProgress(Math.max(0, Math.min(1, p / 100))),
        });
        stopCurrent = stop;
        const result = await promise;
        if (result.isAborted || o.signal.aborted) throw new AbortedError();
        return result;
      };

      try {
        const expected = o.language !== AUTO_LANGUAGE ? o.language : o.languageHint;
        let mode: Mode = o.safeMode || isUnspacedLanguage(expected) ? 'phrases' : 'words';
        let result = await run(mode);
        if (mode === 'words' && (hasBrokenText(result.segments) || isUnspacedLanguage(result.language))) {
          mode = 'phrases';
          result = await run(mode);
        }

        const language = result.language || (o.language !== AUTO_LANGUAGE ? o.language : null);
        let segments: TranscriptSegment[];
        let text: string;
        if (mode === 'words') {
          const words = wordsFromWhisperCpp(result.segments);
          segments = groupWordsIntoSegments(words);
          text = words.map((w) => w.word).join('').replace(/\s+/g, ' ').trim();
        } else {
          segments = segmentsFromWhisperPhrases(result.segments);
          text = joinPhrases(segments, isUnspacedLanguage(language));
        }
        if (!text) return null;
        return { text, segments, language };
      } finally {
        o.signal.removeEventListener('abort', onAbort);
      }
    },
    async release() {
      await context.release();
    },
  };
}
