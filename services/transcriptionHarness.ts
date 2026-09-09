/**
 * Reproducible transcription test over fixed audio.
 *
 * Why this exists
 * ---------------
 * Judging transcription quality from live speech compares two things at
 * once: what the microphone captured and what the model did with it. Neither
 * is repeatable — the room, the phrasing and the timing all change between
 * attempts — so a regression can't be attributed, and a fix can't be shown
 * to have worked.
 *
 * This runs the same audio every time, through the same decode path the
 * post-save timeline pass uses (`decodeToPcm`), and reports both routes the
 * app has into the model:
 *
 *   - **one-shot** — `transcribe()` over the whole waveform, the route
 *     `buildTimeline` takes after Save.
 *   - **streamed** — the waveform replayed through `streamInsert()` in
 *     `CAPTURE_BUFFER_SECONDS` chunks at real-time pace, the route the
 *     record screen takes while the microphone is running.
 *
 * Both see byte-identical audio, so a difference between the two columns is
 * the streaming path (VAD gating, rolling-buffer commits), while both being
 * wrong together points at the model or the decode instead. On the bundled
 * fixture, which has a known transcript, that reads directly as a word error
 * rate rather than as an impression.
 *
 * Replay is paced in real time on purpose. Streaming behaviour is
 * time-dependent — `INFERENCE_TIMEOUT_MS` sets how often inference runs and
 * `VAD_DETECTION_MARGIN_MS` how much silence commits a segment — so audio
 * pushed in as fast as the loop allows would exercise a path the microphone
 * never produces.
 */

import type { SpeechToTextType } from 'react-native-executorch/legacy';
import { Directory, File, Paths } from 'expo-file-system';
import { AUDIO_CONFIG, CAPTURE_BUFFER_SECONDS, STREAMING_CONFIG } from '../constants/config';
import { decodeToPcm } from './transcriptionTimeline';

/** The slice of the model hook the harness needs. */
type HarnessModel = Pick<
  SpeechToTextType,
  'transcribe' | 'stream' | 'streamInsert' | 'streamStop' | 'isReady'
>;

export interface HarnessFixture {
  name: string;
  /** A `require()`d asset, or a resolver for audio found on the device. */
  source: number | (() => Promise<string | null>);
  /** Ground truth, when known. Drives the word error rate. */
  reference?: string;
  /** What this fixture is here to prove or disprove. */
  hypothesis: string;
}

const HI_EVERYONE = 'Hi everyone';

/**
 * Every fixture is 16 kHz mono PCM — the app's own recording format — so it
 * reaches the model without resampling, exactly as a fresh recording would.
 *
 * The set is deliberately split between recorded speech, which says whether
 * the model is any good, and synthesised speech, which is the only way to
 * hold one variable still and change another. A hypothesis that only ever
 * meets real recordings can't be falsified: every run differs in speaker,
 * phrasing, level and room at once.
 */
export const FIXTURES: HarnessFixture[] = [
  // ── Recorded speech, known transcripts ────────────────────────────────
  {
    // Public domain (JFK inaugural). The sample whisper.cpp ships, so its
    // expected output is widely published and comparable against other
    // Whisper builds.
    name: 'jfk',
    source: require('../assets/audio/jfk.wav'),
    reference:
      'And so my fellow Americans, ask not what your country can do for you, ' +
      'ask what you can do for your country.',
    hypothesis: 'Baseline: clean oratory, 11s. Anchors every other number.',
  },
  {
    // LibriSpeech test-clean (CC BY 4.0), read speech, studio conditions.
    // Three lengths, so length-dependent effects show up as a trend rather
    // than a single suspicious result.
    name: 'libri-short',
    source: require('../assets/audio/libri1.wav'),
    reference: "NOR IS MISTER QUILTER'S MANNER LESS INTERESTING THAN HIS MATTER",
    hypothesis: 'Read speech, 4.8s. Short but comfortably over the 1s floor.',
  },
  {
    name: 'libri-medium',
    source: require('../assets/audio/libri0.wav'),
    reference:
      'MISTER QUILTER IS THE APOSTLE OF THE MIDDLE CLASSES AND WE ARE GLAD TO WELCOME HIS GOSPEL',
    hypothesis: 'Read speech, 5.9s. Pairs with quiet-speech, same audio.',
  },
  {
    name: 'libri-long',
    source: require('../assets/audio/libri3.wav'),
    reference:
      "HE HAS GRAVE DOUBTS WHETHER SIR FREDERICK LEIGHTON'S WORK IS REALLY GREEK AFTER ALL " +
      'AND CAN DISCOVER IN IT BUT LITTLE OF ROCKY ITHACA',
    hypothesis: 'Read speech, 9.9s, proper nouns. Does error grow with length?',
  },

  // ── Synthesised, one variable at a time ───────────────────────────────
  {
    name: 'greeting-clean',
    source: require('../assets/audio/greeting-clean.wav'),
    reference: HI_EVERYONE,
    hypothesis:
      'Does base.en simply mishear "Hi" as "Bye"? If this is clean, the ' +
      'model is exonerated and the fault is in the audio.',
  },
  {
    name: 'greeting-padded',
    source: require('../assets/audio/greeting-padded.wav'),
    reference: HI_EVERYONE,
    hypothesis:
      'Same speech, padded with silence to 10.4s — the shape of the real ' +
      'recording. Isolates whether trailing silence alone provokes ' +
      'hallucinated filler ("Pause", sound tags).',
  },
  {
    name: 'greeting-buzz',
    source: require('../assets/audio/greeting-buzz.wav'),
    reference: HI_EVERYONE,
    hypothesis:
      'greeting-padded plus a ~120ms mechanical burst at t=0, where the ' +
      'start haptic fired. THE decisive test: if this alone turns "Hi" into ' +
      '"Bye" and emits (buzzer), the haptic diagnosis holds. If it does not, ' +
      'that diagnosis is wrong and the real cause is still open.',
  },
  {
    name: 'tiny-utterance',
    source: require('../assets/audio/tiny-utterance.wav'),
    reference: 'Okay',
    hypothesis:
      'Under 1s, below the library\'s kMinChunkSamples. Expected to return ' +
      'nothing at all — if it returns words, that documented floor is wrong.',
  },
  {
    name: 'paused-speech',
    source: require('../assets/audio/paused-speech.wav'),
    reference:
      'The first sentence is short. Here is a second one with more words in it. ' +
      'And finally a third sentence to close.',
    hypothesis:
      'Three sentences split by 1.2s gaps — well past the 300ms VAD margin, ' +
      'so the stream must commit three times. Streamed-vs-one-shot here is ' +
      'the cost of a commit boundary, measured directly.',
  },
  {
    name: 'quiet-speech',
    source: require('../assets/audio/quiet-speech.wav'),
    reference:
      'MISTER QUILTER IS THE APOSTLE OF THE MIDDLE CLASSES AND WE ARE GLAD TO WELCOME HIS GOSPEL',
    hypothesis:
      'libri-medium at -20dB. Compare the two: any gap is pure level ' +
      'sensitivity, which matters because mic gain varies by device.',
  },

  // ── The device's own audio ────────────────────────────────────────────
  {
    // No reference text, so no error rate — but it is the one fixture that
    // reproduces a failure heard in real use, and it needs no adb. Record
    // something, run again, and it picks up the new file.
    name: 'latest-recording',
    source: findLatestRecording,
    hypothesis: 'Whatever was last recorded on this device.',
  },
];

/** Newest WAV under the recordings directory, or null if there are none. */
async function findLatestRecording(): Promise<string | null> {
  const directory = new Directory(Paths.document, 'audio');
  if (!directory.exists) {
    return null;
  }

  const wavs = directory
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.wav'));
  if (wavs.length === 0) {
    return null;
  }

  // Names are `note-<epoch ms>.wav` (see services/wavEncoder), so sorting by
  // name is sorting by recording time without stat-ing every file.
  wavs.sort((a, b) => a.name.localeCompare(b.name));
  return wavs[wavs.length - 1].uri;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Written forms that are the same spoken word, expanded on both sides.
 *
 * Without this the scorer invents errors. LibriSpeech references spell out
 * "MISTER"; Whisper writes "Mr." — identical audio, identical speech, scored
 * as a substitution. That single mismatch was reading as WER 0.10 on a
 * 10-word reference the model had in fact transcribed perfectly, which
 * inflated the apparent error floor of every clean fixture.
 */
const SPOKEN_FORMS: Record<string, string> = {
  mr: 'mister',
  mrs: 'missus',
  ms: 'miss',
  dr: 'doctor',
  st: 'saint',
  jr: 'junior',
  sr: 'senior',
  '&': 'and',
};

/**
 * Reduces a transcript to comparable words: lowercase, no punctuation,
 * abbreviations expanded.
 *
 * Whisper's punctuation and capitalisation are stylistic and vary between
 * runs on identical audio, so counting them as errors would bury the ones
 * that matter — a wrong or missing word.
 */
function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'&]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => SPOKEN_FORMS[word] ?? word);
}

/**
 * Word error rate: edit distance over words, divided by reference length.
 *
 * 0 is a perfect match. Values above 1 are possible (a hallucination longer
 * than the reference), which is exactly the case worth spotting.
 */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalize(reference);
  const hyp = normalize(hypothesis);
  if (ref.length === 0) {
    return hyp.length === 0 ? 0 : 1;
  }

  // Two rows of the Levenshtein matrix — the full table is never needed
  // since only the final distance is reported.
  let previous = Array.from({ length: hyp.length + 1 }, (_, i) => i);
  for (let i = 1; i <= ref.length; i++) {
    const current = [i];
    for (let j = 1; j <= hyp.length; j++) {
      const substitution = previous[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, previous[j] + 1, current[j - 1] + 1);
    }
    previous = current;
  }

  return previous[hyp.length] / ref.length;
}

/** `transcribe()` over the whole waveform — the post-save timeline route. */
async function runOneShot(model: HarnessModel, waveform: Float32Array): Promise<string> {
  const result = await model.transcribe(waveform);
  return result.text.trim();
}

/**
 * Replays the waveform through the streaming route the microphone drives.
 *
 * The generator is consumed on its own promise while chunks are inserted,
 * mirroring the record screen: there, `onAudioReady` inserts audio while a
 * `for await` loop over `stream()` drains committed text. Draining only
 * after the last insert would let the rolling buffer grow past what live
 * streaming ever holds.
 */
async function runStreamed(model: HarnessModel, waveform: Float32Array): Promise<string> {
  const chunkSize = Math.round(AUDIO_CONFIG.sampleRate * CAPTURE_BUFFER_SECONDS);
  let committed = '';

  const consumer = (async () => {
    const iterator = model.stream({
      useVAD: true,
      timeout: STREAMING_CONFIG.INFERENCE_TIMEOUT_MS,
      vadDetectionMargin: STREAMING_CONFIG.VAD_DETECTION_MARGIN_MS,
    });
    for await (const { committed: chunk } of iterator) {
      if (chunk.text) {
        committed += chunk.text;
      }
    }
  })();

  for (let offset = 0; offset < waveform.length; offset += chunkSize) {
    // `slice`, not `subarray`: this crosses into native, and a view over a
    // larger buffer would hand the model the whole waveform's memory.
    model.streamInsert(waveform.slice(offset, Math.min(offset + chunkSize, waveform.length)));
    await sleep(CAPTURE_BUFFER_SECONDS * 1000);
  }

  model.streamStop();
  await consumer;
  return committed.trim();
}

export interface HarnessResult {
  fixture: string;
  durationSeconds: number;
  oneShot: string;
  /** Last streamed transcript; see `streamedAll` for the rest. */
  streamed: string;
  streamedAll: string[];
  /** Undefined when the fixture has no reference text. */
  oneShotWer?: number;
  streamedWer?: number;
  streamedWerAll?: number[];
}

export interface HarnessOptions {
  /** Substring match on fixture name. Omit to run all of them. */
  only?: string;
  /**
   * How many times to repeat the streamed pass per fixture.
   *
   * Worth raising above 1. The streamed route is not deterministic: chunks
   * are fed on a real-time timer while inference runs concurrently, so how
   * much audio has accumulated when each inference fires depends on
   * scheduling. Identical audio has produced WER 0.23 and 0.14 on separate
   * runs of the same build. One streamed number is an anecdote; the median
   * of several is a measurement. The one-shot pass has no such variance and
   * runs once.
   */
  streamRepeats?: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Runs one fixture through both routes.
 *
 * The two routes run in sequence, never overlapped: `transcribe()` and
 * `stream()` contend for the same model instance, and starting one while the
 * other is in flight is the same conflict the record screen avoids by
 * holding `timelinePassRef`.
 *
 * Returns null when the fixture has no audio to run (no recordings on the
 * device yet), which is a skip rather than a failure.
 */
export async function runFixture(
  model: HarnessModel,
  fixture: HarnessFixture,
  streamRepeats = 1
): Promise<HarnessResult | null> {
  const source = typeof fixture.source === 'number' ? fixture.source : await fixture.source();
  if (source === null) {
    console.log(`[harness] ${fixture.name}: no audio available, skipped`);
    return null;
  }

  const waveform = await decodeToPcm(source);
  const durationSeconds = waveform.length / AUDIO_CONFIG.sampleRate;
  console.log(
    `[harness] ${fixture.name}: ${durationSeconds.toFixed(2)}s — ${fixture.hypothesis}`
  );

  const oneShot = await runOneShot(model, waveform);
  const streamedAll: string[] = [];
  for (let run = 0; run < Math.max(1, streamRepeats); run++) {
    streamedAll.push(await runStreamed(model, waveform));
  }

  const streamedWerAll = fixture.reference
    ? streamedAll.map((text) => wordErrorRate(fixture.reference!, text))
    : undefined;

  const result: HarnessResult = {
    fixture: fixture.name,
    durationSeconds,
    oneShot,
    streamed: streamedAll[streamedAll.length - 1],
    streamedAll,
    ...(fixture.reference
      ? {
          oneShotWer: wordErrorRate(fixture.reference, oneShot),
          // Median, not last: see HarnessOptions.streamRepeats for why a
          // single streamed number can't be trusted.
          streamedWer: median(streamedWerAll!),
          streamedWerAll,
        }
      : {}),
  };

  const wer = (value?: number) => (value === undefined ? '' : ` [WER ${value.toFixed(2)}]`);
  if (fixture.reference) {
    console.log(`[harness]   reference : ${fixture.reference}`);
  }
  console.log(`[harness]   one-shot  :${wer(result.oneShotWer)} ${oneShot || '(empty)'}`);
  streamedAll.forEach((text, run) => {
    const label = streamedAll.length > 1 ? `streamed#${run + 1}` : 'streamed  ';
    console.log(`[harness]   ${label}:${wer(streamedWerAll?.[run])} ${text || '(empty)'}`);
  });
  if (streamedAll.length > 1 && result.streamedWer !== undefined) {
    console.log(`[harness]   streamed median WER ${result.streamedWer.toFixed(2)}`);
  }

  return result;
}

/** Runs the selected fixtures in order, skipping any with no audio. */
export async function runHarness(
  model: HarnessModel,
  options: HarnessOptions = {}
): Promise<HarnessResult[]> {
  const { only, streamRepeats = 1 } = options;
  const selected = only
    ? FIXTURES.filter((fixture) => fixture.name.includes(only))
    : FIXTURES;

  const results: HarnessResult[] = [];
  for (const fixture of selected) {
    try {
      const result = await runFixture(model, fixture, streamRepeats);
      if (result) {
        results.push(result);
      }
    } catch (error) {
      console.error(`[harness] ${fixture.name} failed:`, error);
    }
  }

  const scored = results.filter((result) => result.oneShotWer !== undefined);
  if (scored.length > 0) {
    console.log('[harness] ── summary (WER, lower is better) ──');
    console.log('[harness] fixture              one-shot  streamed');
    for (const result of scored) {
      console.log(
        `[harness] ${result.fixture.padEnd(20)} ${result.oneShotWer!.toFixed(2).padStart(8)}  ${result.streamedWer!.toFixed(2).padStart(8)}`
      );
    }
  }

  return results;
}
