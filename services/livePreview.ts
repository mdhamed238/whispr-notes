/**
 * Live preview for languages the streaming model doesn't speak.
 *
 * The streaming model (ExecuTorch Whisper Base EN) only knows English. For
 * every other language the preview comes from the multilingual Whisper model
 * that already writes the final transcript, run over a sliding window of the
 * audio captured so far:
 *
 *  - audio accumulates as it is captured;
 *  - every second and a half of new audio, the whole window is transcribed
 *    and shown as the interim (grey) text;
 *  - when the speaker pauses, or the window gets long, the window's text is
 *    committed and the window starts again.
 *
 * Whisper is not a streaming model, so this trades latency for working in
 * every language: every window costs one full pass of the model, whatever its
 * length, so the preview trails the speaker by about that long (a couple of
 * seconds on a fast phone, several on a slower one). The saved recording is
 * transcribed again afterwards, so anything the preview gets wrong at a
 * window edge is corrected in the note.
 *
 * The preview must never get in the way of the recording. Three rules follow:
 *  - nothing waits for it: after a pause or a stop it finishes the words said
 *    until then in the background, for a limited time, while the recording
 *    may already have resumed;
 *  - what it didn't get to transcribe is left out and marked "…";
 *  - a phone that needs too long for one window stops previewing altogether.
 *
 * Pure apart from the injected `transcribe`: no native imports, so the
 * windowing is unit-tested.
 */
import { type LiveTranscript, joinTranscript } from './liveTranscription';

export interface LivePreviewOptions {
  sampleRate: number;
  /** Transcribes one window of 16 kHz mono audio and resolves with its text. */
  transcribe: (pcm: Float32Array) => Promise<string>;
  onUpdate: (transcript: LiveTranscript) => void;
  /**
   * Asks the transcription in flight to stop early. Whisper only checks
   * between its two stages, so the call may still take seconds to return.
   */
  abort?: () => void;
  /** Called once if transcription fails; the preview stops, capture goes on. */
  onError?: (error: unknown) => void;
  /**
   * Called once if the model can't keep up; the preview stops, capture goes
   * on. `firstWindow` is true when the very first window was already too
   * slow, which says more about the phone than about this moment.
   */
  onTooSlow?: (firstWindow: boolean) => void;
  /** Join committed pieces without spaces (Chinese, Japanese, Thai). */
  unspaced?: boolean;
}

export const LIVE_PREVIEW_TUNING = {
  /** Whisper needs about a second of audio to say anything. */
  minWindowSeconds: 1.5,
  /** New audio required before the window is transcribed again. */
  stepSeconds: 1.5,
  /** A pause this long at the end of the window ends the phrase. */
  commitSilenceSeconds: 0.6,
  /** ...provided the window holds at least this much. */
  minCommitSeconds: 2,
  /**
   * A speaker who never pauses is committed in pieces this long. Longer
   * pieces cost more per pass (the text to decode grows with them) for no
   * better preview: 15 s windows took a sixth longer than 10 s ones.
   */
  maxWindowSeconds: 10,
  /**
   * If the model can't keep up (a slow phone), audio waiting beyond this is
   * skipped rather than queued without end. The preview shows a gap; the
   * saved recording is complete and is transcribed in full afterwards.
   */
  maxBacklogSeconds: 45,
  /** Chunks quieter than this (RMS) count as silence. */
  silenceRms: 0.006,
  /** Silence kept in front of speech, so first syllables aren't clipped. */
  leadInSeconds: 0.2,
  /** On a final flush, a leftover shorter than this is dropped. */
  minFlushSeconds: 0.3,
  /**
   * When the take pauses or stops, the preview may spend this long finishing
   * its last words: enough for the window in flight and one more on any phone
   * that isn't too slow for a preview at all (see maxRunSeconds).
   */
  flushBudgetSeconds: 20,
  /**
   * A window taking longer than this means the phone can't keep up: the
   * text would trail the speaker by more than a preview is worth (about one
   * to two windows' time), at the price of every core running flat out for
   * the whole recording. The preview stops if the first window takes this
   * long, or a second one later on (see `windowTookTooLong`).
   *
   * Ten seconds, not less: a first window (a second and a half of speech) is
   * nearly all encoder and costs about the same whatever is said, but a long
   * or noisy window takes two to three times that. With a limit of six, a
   * phone that managed short windows in three seconds kept losing long ones.
   */
  maxRunSeconds: 10,
} as const;

interface Chunk {
  samples: Float32Array;
  loud: boolean;
}

/**
 * Whisper narrates silence and noise as "[BLANK_AUDIO]", "(music)" or
 * "*sighs*". None of that belongs in a transcript preview.
 */
export function cleanPreviewText(raw: string): string {
  return raw
    .replace(/\[[^\]]{0,40}\]|\([^)]{0,40}\)|（[^）]{0,40}）|【[^】]{0,40}】|\*[^*]{0,40}\*|♪+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class LivePreview {
  private chunks: Chunk[] = [];
  private pendingSamples = 0;
  /** `pendingSamples` when the window was last transcribed. */
  private samplesAtLastRun = 0;
  private running: Promise<void> | null = null;
  /** Bumped when the window in flight is given up on: its result is then ignored. */
  private epoch = 0;
  /** The window in flight that was given up on, so that it is only told once. */
  private abandoned: Promise<void> | null = null;
  /** When the model was handed the window it is working on; null while it is idle. */
  private transcribingSince: number | null = null;
  /** How long the last window took, to judge what still fits before a deadline. */
  private lastRunMs = 0;
  private completedRuns = 0;
  /** Windows, after the first, that took too long and were skipped. */
  private slowWindows = 0;
  /** Pending samples that the interim text already covers. */
  private coveredSamples = 0;
  /** The flush in progress, if any. It decides what runs next. */
  private flushWork: Promise<void> | null = null;
  private flushDeadline = 0;
  /** Pending samples, from the front, that the flush in progress still owes text for. */
  private flushOwed = 0;
  /** Ends the wait of the flush in progress. */
  private cutWaitShort: (() => void) | null = null;
  private committed = '';
  private nonCommitted = '';
  private failed = false;
  private tooSlow = false;
  private disposed = false;

  constructor(private readonly options: LivePreviewOptions) {}

  get transcript(): LiveTranscript {
    return { committed: this.committed, nonCommitted: this.nonCommitted };
  }

  /** False once transcription has failed or proved too slow, or the preview was disposed. */
  get active(): boolean {
    return !this.failed && !this.tooSlow && !this.disposed;
  }

  /** Adds one captured buffer. `rms` is its loudness, which the recorder already computes. */
  push(samples: Float32Array, rms: number): void {
    if (!this.active || samples.length === 0) return;
    // Copied: the recorder reuses its buffer for the next callback.
    this.chunks.push({ samples: new Float32Array(samples), loud: rms >= LIVE_PREVIEW_TUNING.silenceRms });
    this.pendingSamples += samples.length;
    if (
      this.transcribingSince !== null &&
      // A window already given up on is not judged twice.
      this.abandoned !== this.running &&
      Date.now() - this.transcribingSince > LIVE_PREVIEW_TUNING.maxRunSeconds * 1000
    ) {
      this.windowTookTooLong();
      return;
    }
    this.kick();
  }

  /**
   * Finishes the text for what was said so far and commits it. Called when
   * the recording pauses or stops, so the preview ends on a complete sentence
   * rather than an interim guess.
   *
   * Nothing has to wait for it. Audio that arrives meanwhile (the recording
   * resumed) is not part of it, and is transcribed once it has finished. It
   * takes at most `budgetSeconds`: whatever the model hasn't transcribed by
   * then is left out of the preview and marked "…". Calling it again while it
   * is at work adds what was heard since, and returns that same work.
   */
  flush(budgetSeconds: number = LIVE_PREVIEW_TUNING.flushBudgetSeconds): Promise<void> {
    this.flushOwed = this.pendingSamples;
    const deadline = Date.now() + budgetSeconds * 1000;
    if (this.flushWork) {
      this.flushDeadline = Math.max(this.flushDeadline, deadline);
      return this.flushWork;
    }
    this.flushDeadline = deadline;
    const work = this.finish().finally(() => {
      this.flushWork = null;
      // What was said after the flush began is next.
      this.kick();
    });
    this.flushWork = work;
    return work;
  }

  private async finish(): Promise<void> {
    // After this turn, so that `flushWork` is set before anything runs.
    await Promise.resolve();
    while (this.active && this.owedChunks() > 0) {
      if (this.running) {
        // A window in flight, or one given up on that still holds the model.
        if (!(await this.finishesInTime(this.running))) break;
        continue;
      }
      if (!this.speechAfterInterim(this.owedChunks())) {
        // Nothing was said since the last guess: it is the final text.
        this.commit(this.nonCommitted, this.owedChunks());
        this.emit();
        continue;
      }
      // No point starting a window that cannot make it.
      if (Date.now() + this.lastRunMs >= this.flushDeadline) break;
      this.running = this.run(true).finally(() => {
        this.running = null;
      });
    }
    if (this.active && this.owedChunks() > 0) {
      this.abandonRun();
      this.truncate(this.owedChunks());
    }
    this.flushOwed = 0;
  }

  /** Resolves when no transcription is in flight. */
  async settled(): Promise<void> {
    while (this.running) await this.running;
  }

  /** Stops the preview and frees the buffered audio. In-flight results are ignored. */
  dispose(): void {
    if (this.disposed) return;
    // Nobody is waiting for the window in flight any more.
    this.abandonRun();
    this.disposed = true;
    this.cutWaitShort?.();
    this.chunks = [];
    this.pendingSamples = 0;
    this.flushOwed = 0;
  }

  private seconds(samples: number): number {
    return samples / this.options.sampleRate;
  }

  /**
   * Waits for the window in flight, but not past the flush's deadline. False
   * if it didn't finish in time, or if its usual duration says that it won't.
   */
  private async finishesInTime(work: Promise<void>): Promise<boolean> {
    let finished = false;
    const done = work.then(() => {
      finished = true;
    });
    for (;;) {
      const left = this.flushDeadline - Date.now();
      const stillNeeds =
        this.lastRunMs > 0 && this.transcribingSince !== null ? this.lastRunMs - (Date.now() - this.transcribingSince) : 0;
      if (!this.active || left <= 0 || stillNeeds > left) return false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const interrupted = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, left);
        this.cutWaitShort = resolve;
      });
      try {
        await Promise.race([done, interrupted]);
      } finally {
        clearTimeout(timer);
        this.cutWaitShort = null;
      }
      if (finished) return true;
      // Otherwise the deadline came, or moved: look again.
    }
  }

  /** How many chunks, from the front, the flush in progress still owes text for. */
  private owedChunks(): number {
    let count = 0;
    let total = 0;
    while (count < this.chunks.length && total + this.chunks[count].samples.length <= this.flushOwed) {
      total += this.chunks[count].samples.length;
      count++;
    }
    return count;
  }

  /** True if, within the first `count` chunks, something was said after the audio the interim text covers. */
  private speechAfterInterim(count: number = this.chunks.length): boolean {
    let offset = 0;
    for (let i = 0; i < count; i++) {
      if (offset >= this.coveredSamples && this.chunks[i].loud) return true;
      offset += this.chunks[i].samples.length;
    }
    return false;
  }

  /** Gives up on the window in flight. Its result is ignored when it does arrive. */
  private abandonRun(): void {
    if (!this.running || this.abandoned === this.running) return;
    this.abandoned = this.running;
    this.epoch++;
    try {
      this.options.abort?.();
    } catch (error) {
      console.warn('Could not abort the live preview window:', error);
    }
  }

  /** Gives up on the first `count` chunks waiting: keeps the last guess, and marks what was left out. */
  private truncate(count: number = this.chunks.length): void {
    const unheard = this.speechAfterInterim(count);
    this.commit(this.nonCommitted, count);
    if (unheard) this.markGap();
    this.emit();
  }

  /**
   * Marks that speech is missing from the preview at this point. Not at the
   * very start: an empty preview says as much, and a lone "…" would become
   * the saved note's first text.
   */
  private markGap(): void {
    if (!this.committed || this.committed.endsWith('…')) return;
    this.committed = joinTranscript(this.committed, '…', this.options.unspaced);
  }

  /**
   * The window in flight has been with the model for longer than a preview is
   * worth. On the very first window that is the phone. Later it can be the
   * audio (whisper runs on over noise it can't make out), so one such window
   * is skipped, and only a second one ends the preview.
   */
  private windowTookTooLong(): void {
    if (this.completedRuns === 0 || this.slowWindows > 0) {
      this.stopAsTooSlow();
      return;
    }
    this.slowWindows++;
    this.abandonRun();
    this.truncate();
  }

  private stopAsTooSlow(): void {
    if (!this.active) return;
    this.abandonRun();
    this.truncate();
    this.tooSlow = true;
    this.cutWaitShort?.();
    this.options.onTooSlow?.(this.completedRuns === 0);
  }

  /** Adds `text` to the committed transcript and removes the `count` chunks it was heard in. */
  private commit(text: string, count: number): void {
    this.committed = joinTranscript(this.committed, text, this.options.unspaced);
    this.nonCommitted = '';
    this.drop(count);
  }

  private kick(): void {
    if (this.running || this.flushWork || !this.active) return;
    const pending = this.seconds(this.pendingSamples);
    const fresh = this.seconds(this.pendingSamples - this.samplesAtLastRun);
    if (pending < LIVE_PREVIEW_TUNING.minWindowSeconds || fresh < LIVE_PREVIEW_TUNING.stepSeconds) return;
    this.running = this.run(false).finally(() => {
      this.running = null;
      // Audio kept arriving while the model worked.
      this.kick();
    });
  }

  /** Removes the first `count` chunks (the window just handled). */
  private drop(count: number): void {
    const removed = this.chunks.splice(0, count);
    const removedSamples = removed.reduce((n, c) => n + c.samples.length, 0);
    this.pendingSamples -= removedSamples;
    this.flushOwed = Math.max(0, this.flushOwed - removedSamples);
    this.samplesAtLastRun = 0;
    this.coveredSamples = 0;
  }

  /** Silence before the first word only wastes the window (and invites hallucination). */
  private trimLeadingSilence(): void {
    const firstLoud = this.chunks.findIndex((chunk) => chunk.loud);
    if (firstLoud <= 0) return;
    let keep = 0;
    let index = firstLoud;
    while (index > 0 && this.seconds(keep + this.chunks[index - 1].samples.length) <= LIVE_PREVIEW_TUNING.leadInSeconds) {
      index--;
      keep += this.chunks[index].samples.length;
    }
    const removed = this.chunks.splice(0, index);
    const removedSamples = removed.reduce((n, c) => n + c.samples.length, 0);
    this.pendingSamples -= removedSamples;
    this.flushOwed = Math.max(0, this.flushOwed - removedSamples);
    this.samplesAtLastRun = Math.max(0, this.samplesAtLastRun - removedSamples);
    this.coveredSamples = Math.max(0, this.coveredSamples - removedSamples);
  }

  private setInterim(text: string): void {
    if (this.nonCommitted === text) return;
    this.nonCommitted = text;
    this.emit();
  }

  private emit(): void {
    if (!this.disposed) this.options.onUpdate(this.transcript);
  }

  /** Drops the oldest audio when the model has fallen hopelessly behind. */
  private skipBacklog(): void {
    if (this.seconds(this.pendingSamples) <= LIVE_PREVIEW_TUNING.maxBacklogSeconds) return;
    let count = 0;
    let remaining = this.pendingSamples;
    while (count < this.chunks.length && this.seconds(remaining) > LIVE_PREVIEW_TUNING.maxWindowSeconds) {
      remaining -= this.chunks[count].samples.length;
      count++;
    }
    // The last guess was heard in the audio being dropped: keep it as text.
    this.commit(this.nonCommitted, count);
    this.markGap();
  }

  private async run(final: boolean): Promise<void> {
    this.skipBacklog();
    this.trimLeadingSilence();
    // A flush only owes what was heard before it began; later audio waits.
    const available = final ? this.owedChunks() : this.chunks.length;
    // At most one full window per run; the rest waits for the next one.
    let count = 0;
    let total = 0;
    while (count < available) {
      const next = total + this.chunks[count].samples.length;
      if (count > 0 && this.seconds(next) > LIVE_PREVIEW_TUNING.maxWindowSeconds) break;
      total = next;
      count++;
    }
    const more = count < available;
    const window = this.chunks.slice(0, count);

    // Nothing but silence: there is no speech to preview.
    if (!window.some((chunk) => chunk.loud) || (final && this.seconds(total) < LIVE_PREVIEW_TUNING.minFlushSeconds)) {
      this.drop(count);
      this.setInterim('');
      return;
    }

    const pcm = new Float32Array(total);
    let offset = 0;
    for (const chunk of window) {
      pcm.set(chunk.samples, offset);
      offset += chunk.samples.length;
    }
    this.samplesAtLastRun = this.pendingSamples;
    const epoch = this.epoch;
    const started = Date.now();
    this.transcribingSince = started;

    let text: string;
    try {
      text = cleanPreviewText(await this.options.transcribe(pcm));
    } catch (error) {
      // A window that was given up on may well fail (its model released, say).
      if (epoch === this.epoch && this.active) {
        this.failed = true;
        this.options.onError?.(error);
      }
      return;
    } finally {
      this.transcribingSince = null;
    }
    // Given up on while the model worked: the audio it heard is gone.
    if (epoch !== this.epoch || !this.active) return;
    this.lastRunMs = Date.now() - started;
    this.completedRuns++;

    let trailingSilence = 0;
    for (let i = window.length - 1; i >= 0 && !window[i].loud; i--) trailingSilence += window[i].samples.length;
    const phraseEnded =
      this.seconds(trailingSilence) >= LIVE_PREVIEW_TUNING.commitSilenceSeconds &&
      this.seconds(total) >= LIVE_PREVIEW_TUNING.minCommitSeconds;

    if (final || more || phraseEnded || this.seconds(total) >= LIVE_PREVIEW_TUNING.maxWindowSeconds) {
      this.commit(text, count);
    } else {
      this.nonCommitted = text;
      this.coveredSamples = total;
    }
    this.emit();
  }
}
