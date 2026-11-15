/**
 * The whisper.cpp model behind the live preview in languages other than
 * English: what it is fed, and when it is loaded and freed.
 */
const mockReleaseContext = jest.fn(async () => {});
const mockTranscribeData = jest.fn((_data: ArrayBuffer, _options: { language: string }) => ({
  stop: async () => {},
  promise: Promise.resolve({ result: ' Bonjour', isAborted: false, segments: [] }),
}));
const mockInit = jest.fn(async (_options: { filePath: string }) => ({
  transcribeData: mockTranscribeData,
  release: mockReleaseContext,
}));
let mockPath: string | null = '/models/ggml-base-q5_1.bin';

jest.mock('whisper.rn/index', () => ({ initWhisper: (options: { filePath: string }) => mockInit(options) }));
jest.mock('../services/ai/modelManager', () => ({
  modelPath: (id: string) => (id === 'whisper-base' ? mockPath : null),
  subscribeModels: () => () => {},
}));

type LiveWhisper = typeof import('../services/liveWhisper');
/** A fresh module each time: it keeps the loaded model and its users in module state. */
function load(): LiveWhisper {
  jest.resetModules();
  return require('../services/liveWhisper');
}

beforeEach(() => {
  // The model is freed on a 20-second idle timer; no test should leave a real one running.
  jest.useFakeTimers();
  mockPath = '/models/ggml-base-q5_1.bin';
  mockInit.mockClear();
  mockTranscribeData.mockClear();
  mockReleaseContext.mockClear();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('toPcm16', () => {
  const { toPcm16 } = load();

  test('scales floats to signed 16-bit and clamps what is out of range', () => {
    const pcm = new Int16Array(toPcm16(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2])));
    expect([...pcm]).toEqual([0, 32767, -32768, 16383, -16384, 32767, -32768]);
  });

  test('is little-endian, two bytes a sample, as whisper.rn decodes it', () => {
    const bytes = new Uint8Array(toPcm16(new Float32Array([1, -1])));
    expect([...bytes]).toEqual([0xff, 0x7f, 0x00, 0x80]);
  });

  test('pads a short window with silence up to the minimum', () => {
    const pcm = new Int16Array(toPcm16(new Float32Array([1, 1]), 5));
    expect([...pcm]).toEqual([32767, 32767, 0, 0, 0]);
    // Never shortens a window that is already long enough.
    expect(new Int16Array(toPcm16(new Float32Array(8), 5))).toHaveLength(8);
  });
});

test('transcribes a window in the requested language, padded to what whisper.cpp needs', async () => {
  const live = load();
  const transcribe = await live.acquireLiveWhisper('fr');
  expect(mockInit).toHaveBeenCalledWith({ filePath: '/models/ggml-base-q5_1.bin' });

  // Half a second of audio: whisper.cpp returns nothing for under a second.
  expect(await transcribe!(new Float32Array(8000).fill(0.25))).toBe(' Bonjour');
  const [data, options] = mockTranscribeData.mock.calls[0];
  // No retries at higher temperatures: a preview window must take a bounded time.
  expect(options).toEqual({ language: 'fr', temperatureInc: 0 });
  expect(data.byteLength).toBe(Math.ceil(16000 * 1.1) * 2);
  const pcm = new Int16Array(data);
  expect(pcm[0]).toBe(8191);
  expect(pcm[7999]).toBe(8191);
  expect(pcm[8000]).toBe(0);
});

test('an aborted transcription yields no text', async () => {
  const live = load();
  const transcribe = await live.acquireLiveWhisper('de');
  mockTranscribeData.mockReturnValueOnce({
    stop: async () => {},
    promise: Promise.resolve({ result: 'half a sent', isAborted: true, segments: [] }),
  });
  expect(await transcribe!(new Float32Array(16000))).toBe('');
});

test('without the model installed there is no preview and nothing is loaded', async () => {
  mockPath = null;
  const live = load();
  expect(live.isLiveWhisperAvailable()).toBe(false);
  expect(await live.acquireLiveWhisper('fr')).toBeNull();
  expect(mockInit).not.toHaveBeenCalled();
});

test('a model that fails to load gives no preview instead of an error', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockInit.mockRejectedValueOnce(new Error('out of memory'));
  const live = load();
  expect(await live.acquireLiveWhisper('fr')).toBeNull();
  warn.mockRestore();
  // The next recording tries again.
  expect(await live.acquireLiveWhisper('fr')).not.toBeNull();
  expect(mockInit).toHaveBeenCalledTimes(2);
});

test('the model is loaded once however many times it is asked for', async () => {
  const live = load();
  const [first, second] = await Promise.all([live.acquireLiveWhisper('fr'), live.acquireLiveWhisper('es')]);
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(mockInit).toHaveBeenCalledTimes(1);
});

describe('one window at a time', () => {
  type Result = { result: string; isAborted: boolean; segments: never[] };
  /** The next native transcription stays busy until `finish` is called. */
  function holdNext() {
    let finish!: (result: Result) => void;
    const stop = jest.fn(async () => {});
    mockTranscribeData.mockReturnValueOnce({ stop, promise: new Promise<Result>((resolve) => { finish = resolve; }) });
    return { stop, finish: (result = ' un', isAborted = false) => finish({ result, isAborted, segments: [] }) };
  }
  const settle = () => jest.advanceTimersByTimeAsync(0);

  test('a second window waits for the first: whisper.rn refuses two on one model', async () => {
    const live = load();
    const transcribe = (await live.acquireLiveWhisper('fr'))!;
    const busy = holdNext();
    const first = transcribe(new Float32Array(16000));
    const second = transcribe(new Float32Array(16000));
    await settle();
    expect(mockTranscribeData).toHaveBeenCalledTimes(1);

    busy.finish();
    expect(await first).toBe(' un');
    expect(await second).toBe(' Bonjour');
    expect(mockTranscribeData).toHaveBeenCalledTimes(2);
  });

  test('the next recording waits for a window the last one left running', async () => {
    const live = load();
    const lastTake = (await live.acquireLiveWhisper('fr'))!;
    const busy = holdNext();
    const left = lastTake(new Float32Array(16000));
    live.releaseLiveWhisper();

    const nextTake = (await live.acquireLiveWhisper('es'))!;
    const window = nextTake(new Float32Array(16000));
    await settle();
    expect(mockTranscribeData).toHaveBeenCalledTimes(1);
    busy.finish();
    await left;
    expect(await window).toBe(' Bonjour');
    expect(mockTranscribeData.mock.calls[1][1]).toMatchObject({ language: 'es' });
  });

  test('a window that fails does not hold up the next', async () => {
    const live = load();
    const transcribe = (await live.acquireLiveWhisper('fr'))!;
    mockTranscribeData.mockReturnValueOnce({ stop: async () => {}, promise: Promise.reject(new Error('out of memory')) });
    await expect(transcribe(new Float32Array(16000))).rejects.toThrow('out of memory');
    expect(await transcribe(new Float32Array(16000))).toBe(' Bonjour');
  });

  test('abort stops the window the model is working on', async () => {
    const live = load();
    const transcribe = (await live.acquireLiveWhisper('fr'))!;
    const busy = holdNext();
    const window = transcribe(new Float32Array(16000));
    await settle();

    transcribe.abort();
    expect(busy.stop).toHaveBeenCalledTimes(1);
    // whisper returns what it had; an aborted window counts for nothing.
    busy.finish(' Bonj', true);
    expect(await window).toBe('');
  });

  test('abort skips a window that has not reached the model yet', async () => {
    const live = load();
    const transcribe = (await live.acquireLiveWhisper('fr'))!;
    const busy = holdNext();
    const first = transcribe(new Float32Array(16000));
    const second = transcribe(new Float32Array(16000));
    await settle();

    transcribe.abort();
    // The window in the model is not the one that was aborted.
    expect(busy.stop).not.toHaveBeenCalled();
    busy.finish();
    expect(await first).toBe(' un');
    expect(await second).toBe('');
    expect(mockTranscribeData).toHaveBeenCalledTimes(1);
  });

  test('abort with nothing running does nothing, and a failing stop is survived', async () => {
    const live = load();
    const transcribe = (await live.acquireLiveWhisper('fr'))!;
    transcribe.abort();
    expect(await transcribe(new Float32Array(16000))).toBe(' Bonjour');
    transcribe.abort();

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const busy = holdNext();
    busy.stop.mockRejectedValueOnce(new Error('Context not found'));
    const window = transcribe(new Float32Array(16000));
    await settle();
    transcribe.abort();
    await settle();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    busy.finish();
    expect(await window).toBe(' un');
  });
});

test('a phone found too slow for the preview, twice, is remembered until the app restarts', () => {
  const live = load();
  expect(live.isLiveWhisperTooSlow()).toBe(false);
  // Once could be a bad moment.
  live.markLiveWhisperTooSlow();
  expect(live.isLiveWhisperTooSlow()).toBe(false);
  live.markLiveWhisperTooSlow();
  expect(live.isLiveWhisperTooSlow()).toBe(true);
  // A fresh module, as after a restart.
  expect(load().isLiveWhisperTooSlow()).toBe(false);
});

describe('freeing the model', () => {
  test('the transcription queue cannot free it during a recording, and frees it at once afterwards', async () => {
    const live = load();
    const transcribe = await live.acquireLiveWhisper('fr');
    await live.releaseLiveWhisperNow();
    expect(mockReleaseContext).not.toHaveBeenCalled();
    expect(await transcribe!(new Float32Array(16000))).toBe(' Bonjour');

    live.releaseLiveWhisper();
    await live.releaseLiveWhisperNow();
    expect(mockReleaseContext).toHaveBeenCalledTimes(1);

    // The next recording loads it again.
    await live.acquireLiveWhisper('fr');
    expect(mockInit).toHaveBeenCalledTimes(2);
  });

  test('it stays loaded briefly after a recording, then is freed', async () => {
    const live = load();
    await live.acquireLiveWhisper('fr');
    live.releaseLiveWhisper();
    jest.advanceTimersByTime(19_000);
    expect(mockReleaseContext).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2_000);
    expect(mockReleaseContext).toHaveBeenCalledTimes(1);
  });

  test('a recording started within that time keeps the model and reuses it', async () => {
    const live = load();
    await live.acquireLiveWhisper('fr');
    live.releaseLiveWhisper();
    jest.advanceTimersByTime(10_000);
    await live.acquireLiveWhisper('fr');
    jest.advanceTimersByTime(60_000);
    expect(mockReleaseContext).not.toHaveBeenCalled();
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  test('releasing more often than acquiring never goes negative', async () => {
    const live = load();
    live.releaseLiveWhisper();
    live.releaseLiveWhisper();
    const transcribe = await live.acquireLiveWhisper('fr');
    // Still counted as in use: one stray release earlier must not let the queue free it now.
    await live.releaseLiveWhisperNow();
    expect(mockReleaseContext).not.toHaveBeenCalled();
    expect(transcribe).not.toBeNull();
  });

  test('a transcriber kept after its model was freed reports it instead of crashing', async () => {
    const live = load();
    const transcribe = await live.acquireLiveWhisper('fr');
    live.releaseLiveWhisper();
    await live.releaseLiveWhisperNow();
    await expect(transcribe!(new Float32Array(16000))).rejects.toThrow('released');
  });
});
