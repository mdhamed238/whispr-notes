/**
 * The whisper.cpp model behind the live preview in languages other than
 * English (see services/livePreview.ts). It is the multilingual Base model
 * the app already downloads for final transcripts, loaded here for the
 * length of a recording and released shortly after.
 */
import { initWhisper, type WhisperContext } from 'whisper.rn/index';

import { AUDIO_CONFIG } from '../constants/config';
import { modelPath, subscribeModels } from './ai/modelManager';

/** How long the model stays loaded after a recording, in case another follows. */
const IDLE_RELEASE_MS = 20_000;
/** whisper.cpp returns nothing for less than a second of audio; shorter windows are padded. */
const MIN_SAMPLES = Math.ceil(AUDIO_CONFIG.sampleRate * 1.1);

let context: WhisperContext | null = null;
let loading: Promise<WhisperContext | null> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let users = 0;

/** Recordings, this session, whose very first preview window took too long. */
let slowTakes = 0;
/** One could be a bad moment (the phone was busy); two is the phone. */
const SLOW_TAKES_TO_GIVE_UP = 2;

/**
 * True once this phone has shown that it can't run the preview fast enough to
 * be useful. Later recordings in this session skip the preview instead of
 * finding out again, with every core busy. Not stored: the next launch gets
 * another try.
 */
export function isLiveWhisperTooSlow(): boolean {
  return slowTakes >= SLOW_TAKES_TO_GIVE_UP;
}

/** Call when a recording's first preview window took too long. */
export function markLiveWhisperTooSlow(): void {
  slowTakes++;
}

/** True when the multilingual model is installed, so a preview is possible. */
export function isLiveWhisperAvailable(): boolean {
  return modelPath('whisper-base') !== null;
}

/** Reports whenever the multilingual model is installed or removed. Returns the unsubscribe. */
export function subscribeLiveWhisperAvailability(listener: (available: boolean) => void): () => void {
  return subscribeModels((id) => {
    if (id === 'whisper-base') listener(isLiveWhisperAvailable());
  });
}

/** 16 kHz float samples as the little-endian 16-bit PCM whisper.rn's data API decodes. */
export function toPcm16(samples: Float32Array, minSamples = 0): ArrayBuffer {
  const out = new Int16Array(Math.max(samples.length, minSamples));
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out.buffer;
}

async function load(): Promise<WhisperContext | null> {
  if (context) return context;
  const path = modelPath('whisper-base');
  if (!path) return null;
  loading ??= initWhisper({ filePath: path })
    .then((created) => {
      context = created;
      return created;
    })
    .catch((error) => {
      console.warn('Could not load the live preview model:', error);
      return null;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/**
 * How whisper is asked to transcribe a preview window.
 *
 * `temperatureInc: 0` turns off whisper's retries: by default, a decode it
 * distrusts is run again at rising temperatures, up to five more times. On
 * noisy speech that made windows about a fifth slower for the same text
 * (measured with the real model), and it leaves the time a window takes
 * unbounded. A preview needs the bound; the saved recording is transcribed
 * again with the retries on.
 */
const previewOptions = (language: string) => ({ language, temperatureInc: 0 });

export interface LiveTranscriber {
  /** Transcribes one window of 16 kHz mono audio. */
  (pcm: Float32Array): Promise<string>;
  /**
   * Asks whisper to stop the window it is working on. It only checks between
   * encoding and decoding, so the window may still take seconds to return
   * (as an empty string).
   */
  abort(): void;
}

/**
 * The windows being transcribed, one after the other. whisper.rn refuses a
 * second transcription on a context that is still busy ("Context is already
 * transcribing"), and a window that was aborted or given up on can keep the
 * context busy for seconds, into the next take.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Loads the model (if needed) and returns a function that transcribes one
 * window in `language`. Null when the model isn't installed or won't load;
 * the recording carries on without a preview. Pair with `releaseLiveWhisper`.
 */
export async function acquireLiveWhisper(language: string): Promise<LiveTranscriber | null> {
  users++;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const loaded = await load();
  if (!loaded) {
    releaseLiveWhisper();
    return null;
  }

  let abortCurrent: (() => void) | null = null;
  const transcribe = (pcm: Float32Array): Promise<string> => {
    let aborted = false;
    let stop: (() => Promise<void>) | null = null;
    const abort = () => {
      aborted = true;
      void stop?.().catch((error) => console.warn('Could not stop the live preview window:', error));
    };
    abortCurrent = abort;
    const previous = queue;
    const job = (async () => {
      await previous;
      if (aborted) return '';
      const active = context;
      if (!active) throw new Error('The live preview model was released');
      const task = active.transcribeData(toPcm16(pcm, MIN_SAMPLES), previewOptions(language));
      stop = task.stop;
      const result = await task.promise;
      return result.isAborted ? '' : result.result;
    })();
    queue = job.then(
      () => undefined,
      () => undefined
    );
    void queue.then(() => {
      if (abortCurrent === abort) abortCurrent = null;
    });
    return job;
  };
  return Object.assign(transcribe, { abort: () => abortCurrent?.() });
}

async function unload(): Promise<void> {
  const current = context;
  context = null;
  if (current) await current.release().catch((error) => console.warn('Could not release the live preview model:', error));
}

/** Call when a recording ends. The model is freed once nothing has used it for a while. */
export function releaseLiveWhisper(): void {
  users = Math.max(0, users - 1);
  if (users > 0 || idleTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (users === 0) void unload();
  }, IDLE_RELEASE_MS);
}

/**
 * Frees the model right away if no recording is using it. The transcription
 * queue calls this before loading its own (larger) model, so the two are
 * never in memory together.
 */
export async function releaseLiveWhisperNow(): Promise<void> {
  if (users > 0) return;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (loading) await loading;
  if (users === 0) await unload();
}
