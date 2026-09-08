/**
 * Builds a seekable word/segment timeline for a finished recording.
 *
 * Why this can't come from the live stream
 * ----------------------------------------
 * `stream({ verbose: true })` does return word timestamps, but they are
 * useless for seeking. In the library's streaming path
 * (`common/rnexecutorch/models/speech_to_text/whisper/OnlineASR.cpp`) each
 * inference runs over a *span into a rolling buffer* that is repeatedly
 * erased from the front — silence is trimmed away when VAD finds no speech,
 * and the whole buffer is dropped every time a segment commits. No running
 * sample offset is kept anywhere (`OnlineASR::Memory` has no such counter),
 * so a streamed word's `start` is measured from an origin that has already
 * been discarded. There is no way to map it back onto the WAV on disk.
 *
 * A single `transcribe()` pass over the finished file has one coordinate
 * system — the file itself — so its timestamps are directly seekable. That
 * is what this module does.
 *
 * It is deliberately a *second* pass rather than a replacement for the live
 * transcript: the streaming path already produces the text the user watches
 * appear, and this must not slow it down or put it at risk.
 */

import { OfflineAudioContext } from 'react-native-audio-api';
// `/legacy`: executorch 0.10's new root API has no `verbose` option and
// returns plain strings, so the timestamped types live only here.
import type { SpeechToTextType, TranscriptionSegment } from 'react-native-executorch/legacy';
import { AUDIO_CONFIG } from '../constants/config';
import { TranscriptSegment, TranscriptWord } from '../types';

/**
 * Strips the library's segment shape down to what we persist.
 *
 * Dropping `tokens` matters: it is one integer per token, and left in place
 * it would be the largest field in a stored note by a wide margin.
 */
function toStoredSegment(segment: TranscriptionSegment): TranscriptSegment {
  const words: TranscriptWord[] | undefined = segment.words?.map((word) => ({
    word: word.word,
    start: word.start,
    end: word.end,
  }));

  return {
    start: segment.start,
    end: segment.end,
    text: segment.text,
    ...(words && words.length > 0 ? { words } : {}),
  };
}

/**
 * Guards against a timeline that can't be seeked against.
 *
 * A pass that returns nothing usable is reported as "no timeline" rather
 * than stored as an empty array, so consumers can tell "not computed" from
 * "computed and genuinely empty" — both degrade to the same UI, but only the
 * former is worth retrying.
 */
function isUsable(segments: TranscriptSegment[]): boolean {
  return segments.some((segment) => segment.end > segment.start);
}

/**
 * Decodes a recorded WAV back to the 16 kHz mono PCM the model expects.
 *
 * Uses an OfflineAudioContext rather than an AudioContext on purpose: this
 * runs moments after recording stopped, and an output context would take the
 * audio session (configured `playAndRecord` for the mic) with it.
 */
async function decodeWavToPcm(audioUri: string, durationSeconds: number): Promise<Float32Array> {
  const length = Math.max(1, Math.ceil(durationSeconds * AUDIO_CONFIG.sampleRate));
  const context = new OfflineAudioContext({
    numberOfChannels: AUDIO_CONFIG.numberOfChannels,
    length,
    sampleRate: AUDIO_CONFIG.sampleRate,
  });

  // react-native-audio-api 0.13 merged decodeAudioDataSource into
  // decodeAudioData, which accepts a path or URI (it strips `file://`
  // itself) and resamples to the context's sample rate — 16 kHz here.
  const decoded = await context.decodeAudioData(audioUri);
  return decoded.getChannelData(0);
}

export interface Timeline {
  segments: TranscriptSegment[];
  /**
   * The pass's own transcript, taken from the library's `text` rather than
   * re-joined from segments — it is the model's own concatenation of the
   * word tokens (which carry their own leading spaces), so it preserves
   * spacing and punctuation exactly as decoded.
   */
  text: string;
}

/**
 * Runs one verbose transcription pass over a saved recording.
 *
 * Returns `null` — never throws — when a timeline can't be produced, because
 * every caller treats this as best-effort enrichment of a note that is
 * already saved and already useful without it. Recordings shorter than one
 * second yield nothing: that is the library's minimum chunk length
 * (`kMinChunkSamples`), below which it transcribes no audio at all.
 */
export async function buildTimeline(
  model: Pick<SpeechToTextType, 'transcribe'>,
  audioUri: string,
  durationSeconds: number
): Promise<Timeline | null> {
  try {
    const waveform = await decodeWavToPcm(audioUri, durationSeconds);
    if (waveform.length === 0) {
      return null;
    }

    // `verbose` is what turns on segment/word timestamps. No `language` here:
    // the model in use is whisper_base_en, and the library throws if
    // `language` is passed to a non-multilingual model.
    const result = await model.transcribe(waveform, { verbose: true });

    const segments = (result.segments ?? []).map(toStoredSegment);
    if (!isUsable(segments)) {
      return null;
    }

    return { segments, text: result.text.trim() };
  } catch (error) {
    console.warn('Failed to build transcript timeline:', error);
    return null;
  }
}
