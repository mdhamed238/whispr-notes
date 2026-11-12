/**
 * Whisper Large-v3 Turbo through whisper.cpp (whisper.rn). Runs on the
 * saved WAV after recording; reports real progress and can be stopped.
 */
import { initWhisper, type WhisperContext } from 'whisper.rn/index';

import { modelPath } from '../modelManager';
import { groupWordsIntoSegments, wordsFromWhisperCpp } from '../segments';
import { AbortedError, EngineLoadError, type TranscriptionEngine } from './types';

export async function createWhisperRnEngine(): Promise<TranscriptionEngine> {
  const path = modelPath('whisper-large-v3-turbo');
  if (!path) throw new EngineLoadError('whisper-large-v3-turbo', new Error('model not downloaded'));

  let context: WhisperContext;
  try {
    context = await initWhisper({ filePath: path });
  } catch (error) {
    throw new EngineLoadError('whisper-large-v3-turbo', error);
  }

  return {
    id: 'whisper-large-v3-turbo',
    async transcribeFile(uri, o) {
      if (o.signal.aborted) throw new AbortedError();
      const filePath = decodeURI(uri.replace(/^file:\/\//, ''));
      const { stop, promise } = context.transcribe(filePath, {
        language: o.language,
        // One token per segment with timestamps gives word-level timings;
        // wordsFromWhisperCpp stitches sub-word pieces back into words.
        tokenTimestamps: true,
        maxLen: 1,
        onProgress: (p) => o.onProgress(Math.max(0, Math.min(1, p / 100))),
      });
      const onAbort = () => void stop();
      o.signal.addEventListener('abort', onAbort);
      try {
        const result = await promise;
        if (result.isAborted || o.signal.aborted) throw new AbortedError();
        const words = wordsFromWhisperCpp(result.segments);
        const segments = groupWordsIntoSegments(words);
        const text = words.map((w) => w.word).join('').replace(/\s+/g, ' ').trim();
        if (!text) return null;
        return { text, segments, language: result.language || (o.language !== 'auto' ? o.language : null) };
      } finally {
        o.signal.removeEventListener('abort', onAbort);
      }
    },
    async release() {
      await context.release();
    },
  };
}
