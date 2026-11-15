import { LIVE_PREVIEW_TUNING, LivePreview, cleanPreviewText } from '../services/livePreview';

const RATE = 16000;
const CHUNK = 1600; // 100 ms, as the recorder delivers it
const LOUD = 0.05;
const QUIET = 0.001;

function chunk(value: number): Float32Array {
  return new Float32Array(CHUNK).fill(value);
}

/** A fake model: reports how many seconds of audio it was given. */
function setup(options: { unspaced?: boolean; fail?: boolean } = {}) {
  const windows: number[] = [];
  const updates: { committed: string; nonCommitted: string }[] = [];
  const errors: unknown[] = [];
  const preview = new LivePreview({
    sampleRate: RATE,
    unspaced: options.unspaced,
    transcribe: async (pcm) => {
      windows.push(pcm.length / RATE);
      if (options.fail) throw new Error('model crashed');
      return `<${(pcm.length / RATE).toFixed(1)}s>`;
    },
    onUpdate: (transcript) => updates.push(transcript),
    onError: (error) => errors.push(error),
  });
  const speak = async (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 10); i++) preview.push(chunk(LOUD), LOUD);
    await preview.settled();
  };
  const silence = async (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 10); i++) preview.push(chunk(QUIET), QUIET);
    await preview.settled();
  };
  return { preview, windows, updates, errors, speak, silence };
}

describe('LivePreview', () => {
  test('waits for enough audio before the first guess', async () => {
    const { preview, windows, speak } = setup();
    await speak(1);
    expect(windows).toEqual([]);
    expect(preview.transcript).toEqual({ committed: '', nonCommitted: '' });
  });

  test('shows an interim guess while the speaker is still talking', async () => {
    const { preview, updates, speak } = setup();
    await speak(3);
    expect(preview.transcript.committed).toBe('');
    expect(preview.transcript.nonCommitted).not.toBe('');
    expect(updates.length).toBeGreaterThan(0);
  });

  test('commits the phrase when the speaker pauses, and starts a fresh window', async () => {
    const { preview, windows, speak, silence } = setup();
    await speak(3);
    await silence(2);
    expect(preview.transcript.nonCommitted).toBe('');
    expect(preview.transcript.committed).not.toBe('');
    const committedOnce = preview.transcript.committed;

    await speak(3);
    // The new window holds only the new speech, not the committed phrase again.
    expect(windows[windows.length - 1]).toBeLessThanOrEqual(3.5);
    expect(preview.transcript.committed).toBe(committedOnce);
    expect(preview.transcript.nonCommitted).not.toBe('');
  });

  test('a speaker who never pauses is committed in bounded windows', async () => {
    const { preview, windows, speak } = setup();
    // Audio arrives in real time: the model answers between buffers.
    for (let i = 0; i < 40; i++) await speak(1);
    expect(Math.max(...windows)).toBeLessThanOrEqual(LIVE_PREVIEW_TUNING.maxWindowSeconds);
    expect(preview.transcript.committed.split(' ').length).toBeGreaterThanOrEqual(2);
  });

  test('a model that falls behind works through the backlog one window at a time', async () => {
    const { preview, windows, speak } = setup();
    await speak(40); // all 40 s arrive before the first answer
    await preview.flush();
    expect(Math.max(...windows)).toBeLessThanOrEqual(LIVE_PREVIEW_TUNING.maxWindowSeconds);
    // Every second of audio was transcribed exactly once (1.5 s first guess aside).
    const committedSeconds = preview.transcript.committed
      .split(' ')
      .reduce((sum, piece) => sum + Number(piece.replace(/[<>s]/g, '')), 0);
    expect(committedSeconds).toBeCloseTo(40, 1);
  });

  test('a hopeless backlog is skipped instead of growing without end', async () => {
    const { preview, windows, speak } = setup();
    await speak(120);
    await preview.flush();
    expect(preview.transcript.committed).toContain('…');
    const transcribed = windows.reduce((a, b) => a + b, 0);
    expect(transcribed).toBeLessThan(60);
  });

  test('silence is never sent to the model', async () => {
    const { preview, windows, updates, silence } = setup();
    await silence(10);
    expect(windows).toEqual([]);
    expect(updates).toEqual([]);
    expect(preview.transcript).toEqual({ committed: '', nonCommitted: '' });
  });

  test('silence before speech is trimmed from the window', async () => {
    const { windows, speak, silence } = setup();
    await silence(8);
    await speak(2);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]).toBeLessThanOrEqual(2 + LIVE_PREVIEW_TUNING.leadInSeconds + 0.11);
  });

  test('flush commits what is pending, so a pause or stop ends on finished text', async () => {
    const { preview, speak } = setup();
    await speak(2.5);
    expect(preview.transcript.nonCommitted).not.toBe('');
    await preview.flush();
    expect(preview.transcript.nonCommitted).toBe('');
    expect(preview.transcript.committed).toBe('<2.5s>');
    // Nothing left: a second flush changes nothing.
    await preview.flush();
    expect(preview.transcript.committed).toBe('<2.5s>');
  });

  test('flush drops a leftover too short to be speech', async () => {
    const { preview, windows } = setup();
    preview.push(chunk(LOUD), LOUD);
    await preview.flush();
    expect(windows).toEqual([]);
    expect(preview.transcript).toEqual({ committed: '', nonCommitted: '' });
  });

  test('recording continues across a pause: later speech is appended', async () => {
    const { preview, speak } = setup();
    await speak(2);
    await preview.flush();
    await speak(2);
    await preview.flush();
    expect(preview.transcript.committed).toBe('<2.0s> <2.0s>');
  });

  test('unspaced languages are joined without spaces', async () => {
    const { preview, speak } = setup({ unspaced: true });
    await speak(2);
    await preview.flush();
    await speak(2);
    await preview.flush();
    expect(preview.transcript.committed).toBe('<2.0s><2.0s>');
  });

  test('a model failure stops the preview once and keeps what was committed', async () => {
    const { preview, errors, windows, speak } = setup({ fail: true });
    await speak(4);
    expect(errors).toHaveLength(1);
    expect(preview.active).toBe(false);
    const calls = windows.length;
    await speak(4);
    await preview.flush();
    expect(windows).toHaveLength(calls);
    expect(errors).toHaveLength(1);
  });

  test('audio pushed while the model is busy is kept for the next window', async () => {
    let release!: (text: string) => void;
    const seen: number[] = [];
    const preview = new LivePreview({
      sampleRate: RATE,
      transcribe: (pcm) => {
        seen.push(pcm.length / RATE);
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
      onUpdate: () => {},
    });
    for (let i = 0; i < 20; i++) preview.push(chunk(LOUD), LOUD); // 2 s: first run starts
    expect(seen).toEqual([1.5]);
    for (let i = 0; i < 20; i++) preview.push(chunk(LOUD), LOUD); // 2 s more while busy
    release('first');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // The second run sees everything captured so far: nothing was lost.
    expect(seen[1]).toBeCloseTo(4, 5);
    release('second');
    await preview.settled();
  });

  test('a disposed preview ignores late results and new audio', async () => {
    let release!: (text: string) => void;
    const updates: unknown[] = [];
    const preview = new LivePreview({
      sampleRate: RATE,
      transcribe: () => new Promise<string>((resolve) => { release = resolve; }),
      onUpdate: (transcript) => updates.push(transcript),
    });
    for (let i = 0; i < 20; i++) preview.push(chunk(LOUD), LOUD);
    preview.dispose();
    release('late');
    await preview.settled();
    preview.push(chunk(LOUD), LOUD);
    expect(updates).toEqual([]);
    expect(preview.transcript).toEqual({ committed: '', nonCommitted: '' });
  });
});

/**
 * Whisper needs a full pass per window: a second or two on a fast phone, many
 * on a slow one. These tests run on a fake clock with a model that answers
 * only when told to, so "slow" costs nothing.
 */
describe('LivePreview on a slow model', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function setupManual() {
    const asked: { seconds: number; answer: (text: string) => void; fail: (error: unknown) => void }[] = [];
    const updates: { committed: string; nonCommitted: string }[] = [];
    const tooSlow: boolean[] = [];
    const errors: unknown[] = [];
    const abort = jest.fn();
    const preview = new LivePreview({
      sampleRate: RATE,
      transcribe: (pcm) =>
        new Promise<string>((resolve, reject) => {
          asked.push({ seconds: pcm.length / RATE, answer: resolve, fail: reject });
        }),
      abort,
      onUpdate: (transcript) => updates.push(transcript),
      onTooSlow: (firstWindow) => tooSlow.push(firstWindow),
      onError: (error) => errors.push(error),
    });
    /** Audio arriving in real time: the clock moves with it. */
    const hear = async (seconds: number, level = LOUD) => {
      for (let i = 0; i < Math.round(seconds * 10); i++) {
        await jest.advanceTimersByTimeAsync(100);
        preview.push(chunk(level), level);
      }
    };
    /** The model answers the window it was asked `index` windows ago (default: the latest). */
    const answer = async (text: string, index = asked.length - 1) => {
      asked[index].answer(text);
      await jest.advanceTimersByTimeAsync(0);
    };
    const wait = (seconds: number) => jest.advanceTimersByTimeAsync(seconds * 1000);
    const windows = () => asked.map((window) => Number(window.seconds.toFixed(1)));
    return { preview, asked, updates, tooSlow, errors, abort, hear, answer, wait, windows };
  }

  /** Resolves to true once `work` has settled. */
  function watch(work: Promise<void>) {
    const state = { done: false };
    void work.then(() => {
      state.done = true;
    });
    return state;
  }

  describe('finishing after a pause or a stop', () => {
    test('nothing was said since the last guess: it becomes the text, without another pass', async () => {
      const { preview, hear, answer, windows } = setupManual();
      await hear(1.5);
      await hear(0.5, QUIET);
      await answer('Bonjour');
      expect(preview.transcript).toEqual({ committed: '', nonCommitted: 'Bonjour' });

      await preview.flush();
      expect(preview.transcript).toEqual({ committed: 'Bonjour', nonCommitted: '' });
      expect(windows()).toEqual([1.5]);
    });

    test('waits for the window in flight, then transcribes the words said after it', async () => {
      const { preview, hear, answer, wait, windows } = setupManual();
      await hear(2);
      const flush = watch(preview.flush());
      await wait(1);
      expect(flush.done).toBe(false);
      await answer('Bonjour');
      // The half second said after that window was cut is still owed.
      expect(windows()).toEqual([1.5, 2]);
      await answer('Bonjour à tous');
      expect(flush.done).toBe(true);
      expect(preview.transcript).toEqual({ committed: 'Bonjour à tous', nonCommitted: '' });
    });

    test('gives up when its time is over, marking what was left out', async () => {
      const { preview, abort, hear, answer, wait } = setupManual();
      await hear(1.5);
      await answer('Bonjour');
      await hear(1.5); // a second window starts, and never answers
      const flush = watch(preview.flush());
      await wait(LIVE_PREVIEW_TUNING.flushBudgetSeconds - 0.1);
      expect(flush.done).toBe(false);
      await wait(0.2);
      expect(flush.done).toBe(true);
      // The last guess is kept; the words after it were not transcribed.
      expect(preview.transcript).toEqual({ committed: 'Bonjour …', nonCommitted: '' });
      expect(abort).toHaveBeenCalledTimes(1);

      // The window given up on answers at last: too late to count.
      await answer('Bonjour à tous');
      expect(preview.transcript).toEqual({ committed: 'Bonjour …', nonCommitted: '' });
    });

    test('does not start a window that cannot finish in time', async () => {
      const { preview, abort, hear, answer, wait, windows } = setupManual();
      await hear(1.5);
      await wait(5); // this phone needs five seconds a window
      await answer('Bonjour');
      await hear(0.5);

      const before = Date.now();
      await preview.flush(4);
      expect(Date.now() - before).toBe(0);
      expect(windows()).toEqual([1.5]);
      expect(abort).not.toHaveBeenCalled();
      expect(preview.transcript).toEqual({ committed: 'Bonjour …', nonCommitted: '' });
    });

    test('does not wait for a window in flight that cannot finish in time', async () => {
      const { preview, abort, hear, answer, wait } = setupManual();
      await hear(1.5);
      await wait(5);
      await answer('Bonjour');
      await hear(1.5); // the second window has just started

      const before = Date.now();
      await preview.flush(4);
      expect(Date.now() - before).toBe(0);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(preview.transcript).toEqual({ committed: 'Bonjour …', nonCommitted: '' });
    });

    test('speech that arrives while it is at work is not part of it: the pause stays a phrase boundary', async () => {
      const { preview, hear, answer, windows } = setupManual();
      await hear(2);
      const flush = watch(preview.flush());
      // Resumed at once: the model is still on the window from before the pause.
      await hear(2);
      expect(windows()).toEqual([1.5]);
      await answer('Avant');
      // The words before the pause first, on their own...
      expect(windows()).toEqual([1.5, 2]);
      await answer('Avant la pause');
      expect(flush.done).toBe(true);
      expect(preview.transcript.committed).toBe('Avant la pause');
      // ...then what was said since, as a new phrase.
      expect(windows()).toEqual([1.5, 2, 2]);
      await answer('et après');
      await preview.flush();
      expect(preview.transcript.committed).toBe('Avant la pause et après');
    });

    test('what it gives up on is only what was said before it began', async () => {
      const { preview, abort, hear, answer, wait, windows } = setupManual();
      await hear(2);
      const flush = watch(preview.flush(4));
      await hear(3.9); // resumed; the model never answers the first window
      expect(flush.done).toBe(false);
      await hear(0.2);
      expect(flush.done).toBe(true);
      expect(abort).toHaveBeenCalledTimes(1);

      // The model lets go of the window that was given up on: what was said since Resume is next, whole.
      await answer('trop tard', 0);
      expect(windows()).toEqual([1.5, 4.1]);
      await answer('La suite');
      await wait(0);
      expect(preview.transcript.nonCommitted).toBe('La suite');
    });

    test('asking twice while it is at work is one piece of work', async () => {
      const { preview, hear, answer, windows } = setupManual();
      await hear(2);
      const first = preview.flush();
      const second = preview.flush();
      expect(second).toBe(first);
      await answer('Bonjour');
      await answer('Bonjour à tous');
      await first;
      expect(windows()).toEqual([1.5, 2]);
      expect(preview.transcript.committed).toBe('Bonjour à tous');
    });

    test('asking again while it is at work adds what was heard since', async () => {
      const { preview, hear, answer, windows } = setupManual();
      await hear(2);
      const paused = preview.flush();
      await hear(1); // resumed, then stopped: the second flush covers this too
      const stopped = preview.flush();
      expect(stopped).toBe(paused);
      await answer('un');
      expect(windows()).toEqual([1.5, 3]);
      await answer('un deux trois');
      await stopped;
      expect(preview.transcript).toEqual({ committed: 'un deux trois', nonCommitted: '' });
    });

    test('a window given up on that then fails is not a preview failure', async () => {
      const { preview, asked, errors, hear, wait } = setupManual();
      await hear(2);
      await preview.flush(0);
      asked[0].fail(new Error('The live preview model was released'));
      await wait(0);
      expect(errors).toEqual([]);
      expect(preview.active).toBe(true);
    });
  });

  describe('a phone that cannot keep up', () => {
    test('stops previewing when the first window takes too long, and says the phone is the reason', async () => {
      const { preview, tooSlow, abort, hear, answer, windows } = setupManual();
      await hear(1.5);
      await hear(LIVE_PREVIEW_TUNING.maxRunSeconds);
      expect(tooSlow).toEqual([]);
      await hear(0.2);
      expect(tooSlow).toEqual([true]);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(preview.active).toBe(false);
      expect(preview.transcript).toEqual({ committed: '', nonCommitted: '' });

      // No more work for the model, whatever is said or answered afterwards.
      await answer('Bonjour');
      await hear(5);
      await preview.flush();
      expect(windows()).toEqual([1.5]);
      expect(tooSlow).toEqual([true]);
      expect(preview.transcript).toEqual({ committed: '', nonCommitted: '' });
    });

    test('one later window taking too long is skipped, since it may be the audio rather than the phone', async () => {
      const { preview, tooSlow, abort, hear, answer, windows } = setupManual();
      await hear(1.5);
      await answer('Bonjour');
      await hear(1.5); // the second window starts here, and runs on
      await hear(LIVE_PREVIEW_TUNING.maxRunSeconds + 0.2);
      expect(tooSlow).toEqual([]);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(preview.active).toBe(true);
      expect(preview.transcript).toEqual({ committed: 'Bonjour …', nonCommitted: '' });

      // Still held by that window, the model gets nothing new, and is not judged for it again.
      await hear(2);
      expect(tooSlow).toEqual([]);
      expect(windows()).toHaveLength(2);
      // It lets go: the preview carries on with what was said since.
      await answer('trop tard');
      expect(windows()).toHaveLength(3);
      await answer('la suite');
      await preview.flush();
      expect(preview.transcript.committed).toBe('Bonjour … la suite');
    });

    test('a second window taking too long ends the preview, keeping its text and not blaming the phone', async () => {
      const { preview, tooSlow, hear, answer } = setupManual();
      await hear(1.5);
      await answer('Bonjour');
      await hear(1.5);
      await hear(LIVE_PREVIEW_TUNING.maxRunSeconds + 0.2); // the first slow window: skipped
      await answer('trop tard');
      await hear(1.5);
      await answer('la suite'); // the window that followed is fine
      await hear(1.5); // and the next one runs on as well
      await hear(LIVE_PREVIEW_TUNING.maxRunSeconds + 0.2);
      expect(tooSlow).toEqual([false]);
      expect(preview.active).toBe(false);
      expect(preview.transcript).toEqual({ committed: 'Bonjour … la suite …', nonCommitted: '' });
    });

    test('a window that takes long but under the limit is fine', async () => {
      const { preview, tooSlow, hear, answer } = setupManual();
      await hear(1.5);
      await hear(LIVE_PREVIEW_TUNING.maxRunSeconds - 0.5);
      await answer('Bonjour');
      expect(tooSlow).toEqual([]);
      expect(preview.active).toBe(true);
      expect(preview.transcript.nonCommitted).toBe('Bonjour');
    });
  });

  test('disposing asks the model to stop the window in flight', async () => {
    const { preview, abort, hear } = setupManual();
    await hear(2);
    preview.dispose();
    expect(abort).toHaveBeenCalledTimes(1);
    // With nothing in flight there is nothing to stop.
    const idle = setupManual();
    idle.preview.dispose();
    expect(idle.abort).not.toHaveBeenCalled();
  });

  test('a window is told to stop once, however often it is given up on', async () => {
    const { preview, abort, hear } = setupManual();
    await hear(2);
    await preview.flush(0);
    await preview.flush(0);
    preview.dispose();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  test('disposing ends a flush that is waiting', async () => {
    const { preview, hear, wait } = setupManual();
    await hear(2);
    const flush = watch(preview.flush());
    preview.dispose();
    await wait(0);
    expect(flush.done).toBe(true);
  });

  test('a throwing abort does not break the preview', async () => {
    const { preview, abort, hear } = setupManual();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    abort.mockImplementation(() => {
      throw new Error('native module gone');
    });
    await hear(2);
    await preview.flush(0);
    warn.mockRestore();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(preview.active).toBe(true);
  });

  test('skipping a hopeless backlog keeps the last guess as text', async () => {
    const { preview, hear, answer } = setupManual();
    await hear(1.5);
    await answer('un');
    // A burst far beyond what one window holds, while the second window is busy.
    for (let i = 0; i < 500; i++) preview.push(chunk(LOUD), LOUD);
    await answer('un deux');
    // The third window starts by skipping ahead: "un deux" was heard in the audio dropped.
    await answer('trois');
    expect(preview.transcript.committed).toBe('un deux … trois');
  });
});

describe('cleanPreviewText', () => {
  test('removes the model\'s narration of silence and noise', () => {
    expect(cleanPreviewText(' [BLANK_AUDIO] ')).toBe('');
    expect(cleanPreviewText('(music) Bonjour à tous [applaudissements]')).toBe('Bonjour à tous');
    expect(cleanPreviewText('*sighs* これは会議です（笑）')).toBe('これは会議です');
    expect(cleanPreviewText('♪♪ Hola')).toBe('Hola');
  });
  test('leaves ordinary text alone', () => {
    expect(cleanPreviewText('  We meet  at 3 pm.  ')).toBe('We meet at 3 pm.');
  });
});
