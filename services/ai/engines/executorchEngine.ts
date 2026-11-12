/**
 * Whisper Small (multilingual) or Base (English) through ExecuTorch, as a
 * one-shot verbose pass over the saved WAV. Uses the class API rather than
 * the hook so it can run outside any screen.
 */
import { SpeechToTextModule, models } from 'react-native-executorch/legacy';

import { decodeToPcm } from '../../transcriptionTimeline';
import { resolveExecutorchLanguage } from '../language';
import type { TranscriptSegment } from '../../../types';
import { AbortedError, EngineLoadError, type TranscriptionEngine } from './types';

export async function createExecutorchEngine(kind: 'small' | 'base'): Promise<TranscriptionEngine> {
  const id = kind === 'small' ? 'whisper-small' : 'whisper-base-en';
  let module: SpeechToTextModule;
  try {
    module = await SpeechToTextModule.fromModelName(
      kind === 'small' ? models.speech_to_text.whisper_small() : models.speech_to_text.whisper_base_en()
    );
  } catch (error) {
    throw new EngineLoadError(id, error);
  }

  return {
    id,
    async transcribeFile(uri, o) {
      if (o.signal.aborted) throw new AbortedError();
      o.onProgress(-1);
      const waveform = await decodeToPcm(uri);
      if (waveform.length === 0) return null;
      const language =
        kind === 'small'
          ? resolveExecutorchLanguage(o.language, Intl.DateTimeFormat().resolvedOptions().locale ?? 'en')
          : null;
      const result = await module.transcribe(waveform, {
        verbose: true,
        ...(language ? { language: language as never } : {}),
      });
      if (o.signal.aborted) throw new AbortedError();
      const segments: TranscriptSegment[] = (result.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        ...(s.words && s.words.length > 0
          ? { words: s.words.map((w) => ({ word: w.word, start: w.start, end: w.end })) }
          : {}),
      }));
      const text = result.text.trim();
      if (!text) return null;
      return { text, segments, language: language ?? 'en' };
    },
    async release() {
      module.delete();
    },
  };
}
