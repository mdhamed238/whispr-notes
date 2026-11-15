import React from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import type { Note } from '../types';

const { act, create } = require('react-test-renderer');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let mockStop: ReturnType<typeof deferred<{ status: string }>>;
let mockFinalUpdate: ReturnType<typeof deferred<string | null>>;
let mockStreamEnd: ReturnType<typeof deferred<void>>;
let mockAudioReady: (event: { buffer: object }) => void;
const mockStart = jest.fn();
const mockNativeStop = jest.fn();
let mockPaused = false;
const mockPause = jest.fn(() => { mockPaused = true; });
const mockResume = jest.fn(() => { mockPaused = false; });
const mockAbortWindow = jest.fn();
const mockTranscribeWindow = Object.assign(jest.fn(async (_pcm: Float32Array) => ''), { abort: mockAbortWindow });
const mockAcquire = jest.fn(async (_language: string) => mockTranscribeWindow);
const mockRelease = jest.fn();
let mockSlowTakes = 0;
let mockModelInstalled: (installed: boolean) => void = () => {};
const mockPush = jest.fn();
const mockSavedNotes: Note[] = [];

async function* mockStream() {
  const text = await mockFinalUpdate.promise;
  if (text !== null) yield { committed: { text }, nonCommitted: { text: '' } };
  await mockStreamEnd.promise;
}

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
require('react-native-gesture-handler/jestSetup');
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../services/haptics', () => ({ haptic: async () => {} }));
jest.mock('../services/db/notesRepo', () => ({
  createNote: async (note: Note) => { mockSavedNotes.push(note); },
}));
jest.mock('../services/ai/enhanceQueue', () => ({
  setRecordingActive: () => {}, enqueue: async () => {},
}));
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: async () => {} }));
// The multilingual preview model is native (whisper.cpp); its windowing is real (services/livePreview).
jest.mock('../services/liveWhisper', () => ({
  isLiveWhisperAvailable: () => true,
  subscribeLiveWhisperAvailability: (listener: (installed: boolean) => void) => {
    mockModelInstalled = listener;
    return () => {};
  },
  acquireLiveWhisper: (language: string) => mockAcquire(language),
  releaseLiveWhisper: () => mockRelease(),
  isLiveWhisperTooSlow: () => mockSlowTakes >= 2,
  markLiveWhisperTooSlow: () => { mockSlowTakes++; },
}));
// A short limit, so a test can reach it with a few seconds of audio.
jest.mock('../constants/config', () => {
  const actual = jest.requireActual('../constants/config');
  return { ...actual, UI_CONFIG: { ...actual.UI_CONFIG, MAX_RECORDING_DURATION_SECONDS: 5 } };
});
// Keep WavFileWriter real; only its native file handle is replaced.
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' },
  Directory: class {
    uri = 'file:///documents/audio';
    exists = true;
  },
  File: class {
    uri: string;
    constructor(directory: { uri: string }, name: string) { this.uri = `${directory.uri}/${name}`; }
    create() {}
    delete() {}
    write() {}
    open() { return { offset: 0, writeBytes() {}, close() {} }; }
  },
}));
jest.mock('react-native-audio-api', () => ({
  AudioManager: {
    setAudioSessionOptions: () => {},
    observeAudioInterruptions: () => {},
    addSystemEventListener: () => ({ remove() {} }),
    requestRecordingPermissions: async () => 'Granted',
  },
  AudioRecorder: class {
    start = mockStart;
    stop = mockNativeStop;
    pause = mockPause;
    resume = mockResume;
    isPaused = () => mockPaused;
    isRecording = () => true;
    clearOnAudioReady() {}
    onAudioReady(_options: unknown, callback: typeof mockAudioReady) {
      mockAudioReady = callback;
      return { status: 'success' };
    }
  },
}));
jest.mock('react-native-executorch/legacy', () => ({
  models: { speech_to_text: { whisper_base_en: () => ({}) } },
  useSpeechToText: () => ({
    isReady: true,
    downloadProgress: 1,
    streamInsert() {},
    streamStop() {},
    stream: mockStream,
  }),
}));

const RecordScreen = require('../app/(tabs)/index').default;
const AnimatedPressable = require('../components/ui/AnimatedPressable').default;
const Button = require('../components/ui/Button').default;

let screen: ReturnType<typeof create>;

// The header's language chip is also a labelled pressable, so match the record button by its states.
const RECORD_LABELS = ['Start recording', 'Stop recording', 'Processing recording'];

function recordButton() {
  return screen.root
    .findAllByType(AnimatedPressable)
    .find((node: any) => RECORD_LABELS.includes(node.props.accessibilityLabel));
}

async function startRecording() {
  await act(async () => { recordButton().props.onPress(); });
  expect(recordButton().props.accessibilityLabel).toBe('Stop recording');
}

const button = (label: string) => screen.root.findAllByType(Button).find((node: any) => node.props.label === label);
const shows = (text: string) => screen.root.findAllByType(Text).some((node: any) => node.props.children === text);

/** One captured buffer of `seconds` at 16 kHz; `level` 0 is silence. */
function audio(seconds: number, level = 0) {
  const samples = new Float32Array(Math.round(seconds * 16000)).fill(level);
  return { buffer: { sampleRate: 16000, numberOfChannels: 1, length: samples.length, getChannelData: () => samples } };
}

/** Ends the stream in progress, as the engine does once it has flushed after streamStop. */
async function finishStream(finalText: string | null) {
  await act(async () => {
    mockFinalUpdate.resolve(finalText);
    mockStreamEnd.resolve();
  });
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mockStop = deferred();
  mockFinalUpdate = deferred();
  mockStreamEnd = deferred();
  mockSavedNotes.length = 0;
  mockPush.mockClear();
  mockPaused = false;
  mockPause.mockClear();
  mockResume.mockClear();
  mockAcquire.mockClear();
  mockRelease.mockClear();
  mockTranscribeWindow.mockReset().mockResolvedValue('');
  mockAbortWindow.mockClear();
  mockSlowTakes = 0;
  mockStart.mockReset().mockResolvedValue({ status: 'success' });
  mockNativeStop.mockReset().mockImplementationOnce(() => mockStop.promise).mockResolvedValue({ status: 'success' });
  await act(async () => { screen = create(React.createElement(RecordScreen)); });
});

afterEach(async () => {
  await act(async () => {
    screen.unmount();
    mockStop.resolve({ status: 'success' });
    mockFinalUpdate.resolve(null);
    mockStreamEnd.resolve();
  });
});

test('Stop immediately becomes busy, disabled and dim until native stop and the final transcript drain finish', async () => {
  await startRecording();
  await act(async () => { recordButton().props.onPress(); });
  const stopping = recordButton();
  expect(stopping.props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(stopping.props.disabled).toBe(true);
  expect(StyleSheet.flatten(stopping.props.style).opacity).toBe(0.45);
  expect(stopping.findAllByType(ActivityIndicator)).toHaveLength(1);

  await act(async () => { mockStop.resolve({ status: 'success' }); });
  expect(recordButton().props.accessibilityState.busy).toBe(true);
  expect(recordButton().findAllByType(ActivityIndicator)).toHaveLength(1);

  await act(async () => { mockFinalUpdate.resolve('Final words'); });
  expect(screen.root.findAllByType(Text).some((node: any) => node.props.children === 'Final words')).toBe(true);
  expect(recordButton().props.accessibilityState.busy).toBe(true);
  expect(recordButton().findAllByType(ActivityIndicator)).toHaveLength(1);

  const finishingSave = screen.root.findAllByType(Button).find((node: any) => node.props.label === 'Finishing recording…');
  expect(finishingSave.props.disabled).toBe(true);

  await act(async () => { mockStreamEnd.resolve(); });
  expect(recordButton().props.accessibilityLabel).toBe('Start recording');
  expect(recordButton().props.accessibilityState).toEqual({ disabled: false, busy: false });
  expect(recordButton().findAllByType(ActivityIndicator)).toHaveLength(0);
});

test('two rapid Record taps start only one native recording', async () => {
  await act(async () => {
    const press = recordButton().props.onPress;
    press();
    press();
  });
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect(recordButton().props.accessibilityLabel).toBe('Stop recording');
});

test('captured audio can be saved when the live transcript is empty', async () => {
  await startRecording();
  await act(async () => {
    mockAudioReady({ buffer: {
      sampleRate: 16000, numberOfChannels: 1, length: 1600,
      getChannelData: () => new Float32Array(1600),
    } });
    recordButton().props.onPress();
    mockStop.resolve({ status: 'success' });
    mockFinalUpdate.resolve(null);
    mockStreamEnd.resolve();
  });
  const save = screen.root.findAllByType(Button).find((node: any) => node.props.label === 'Save');
  expect(save).toBeDefined();
  expect(save.props.disabled).toBe(false);
  await act(async () => { save.props.onPress(); });
  expect(mockSavedNotes).toHaveLength(1);
  expect(mockSavedNotes[0]).toMatchObject({ transcription: '', duration: 0.1, source: 'recording' });
  expect(mockSavedNotes[0].audioUri).toMatch(/^file:\/\/\/documents\/audio\/note-\d+\.wav$/);
  expect(mockPush).toHaveBeenCalledWith(`/note/${mockSavedNotes[0].id}`);
});

describe('pause and resume', () => {
  test('Pause holds the take: the button offers Resume, Stop stays available and late audio is not recorded', async () => {
    await startRecording();
    await act(async () => { mockAudioReady(audio(0.1)); });
    expect(button('Resume')).toBeUndefined();

    await act(async () => { button('Pause').props.onPress(); });
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(button('Pause')).toBeUndefined();
    expect(button('Resume')).toBeDefined();
    expect(shows('Paused')).toBe(true);
    expect(recordButton().props.accessibilityLabel).toBe('Stop recording');
    expect(recordButton().props.disabled).toBe(false);
    // Save and Reset belong to a finished take, not a paused one.
    expect(button('Save')).toBeUndefined();

    // A buffer the system delivers after the pause is dropped, not written.
    await act(async () => { mockAudioReady(audio(0.1)); });
    await finishStream(null);

    mockFinalUpdate = deferred();
    mockStreamEnd = deferred();
    await act(async () => { button('Resume').props.onPress(); });
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(button('Pause')).toBeDefined();
    await act(async () => { mockAudioReady(audio(0.1)); });

    await act(async () => {
      recordButton().props.onPress();
      mockStop.resolve({ status: 'success' });
    });
    await finishStream(null);
    await act(async () => { button('Save').props.onPress(); });
    // 0.1 s before the pause + 0.1 s after it. The paused buffer is not in the file.
    expect(mockSavedNotes[0].duration).toBeCloseTo(0.2, 5);
  });

  test('the preview continues after what was said before the pause', async () => {
    await startRecording();
    await act(async () => { button('Pause').props.onPress(); });
    await finishStream('We arrived early.');
    expect(shows('We arrived early.')).toBe(true);

    mockFinalUpdate = deferred();
    mockStreamEnd = deferred();
    await act(async () => { button('Resume').props.onPress(); });
    // Ending the first stream to pause must not have ended the take.
    expect(recordButton().props.accessibilityLabel).toBe('Stop recording');
    expect(mockNativeStop).not.toHaveBeenCalled();

    await act(async () => {
      recordButton().props.onPress();
      mockStop.resolve({ status: 'success' });
    });
    await finishStream('Then we left.');
    expect(shows('We arrived early. Then we left.')).toBe(true);
    await act(async () => { button('Save').props.onPress(); });
    expect(mockSavedNotes[0].transcription).toBe('We arrived early. Then we left.');
  });

  test('Resume waits for the preview to finish the words said before the pause', async () => {
    await startRecording();
    await act(async () => { button('Pause').props.onPress(); });
    await act(async () => { button('Resume').props.onPress(); });
    // The first stream is still flushing: the microphone stays paused.
    expect(mockResume).not.toHaveBeenCalled();
    expect(button('Resume')).toBeDefined();

    const firstEnd = mockStreamEnd;
    await act(async () => { mockFinalUpdate.resolve('First part.'); });
    mockFinalUpdate = deferred();
    mockStreamEnd = deferred();
    await act(async () => { firstEnd.resolve(); });
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(button('Pause')).toBeDefined();
  });

  test('a paused take can be stopped and saved', async () => {
    await startRecording();
    await act(async () => { mockAudioReady(audio(0.1)); });
    await act(async () => { button('Pause').props.onPress(); });
    await finishStream('Only part.');
    await act(async () => {
      recordButton().props.onPress();
      mockStop.resolve({ status: 'success' });
    });
    expect(mockNativeStop).toHaveBeenCalledTimes(1);
    expect(recordButton().props.accessibilityLabel).toBe('Start recording');
    await act(async () => { button('Save').props.onPress(); });
    expect(mockSavedNotes[0]).toMatchObject({ transcription: 'Only part.', duration: 0.1 });
  });

  test('a microphone that will not pause leaves the take recording', async () => {
    await startRecording();
    mockPause.mockImplementationOnce(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { button('Pause').props.onPress(); });
    error.mockRestore();
    expect(button('Pause')).toBeDefined();
    expect(button('Resume')).toBeUndefined();
    // Audio keeps being written.
    await act(async () => {
      mockAudioReady(audio(0.1));
      recordButton().props.onPress();
      mockStop.resolve({ status: 'success' });
    });
    await finishStream(null);
    await act(async () => { button('Save').props.onPress(); });
    expect(mockSavedNotes[0].duration).toBeCloseTo(0.1, 5);
  });
});

test('the recording limit counts recorded time and stops the take when it is reached', async () => {
  await startRecording();
  await act(async () => { mockAudioReady(audio(4)); });
  expect(mockNativeStop).not.toHaveBeenCalled();
  // Time spent paused is not recorded, so it cannot reach the limit.
  await act(async () => { button('Pause').props.onPress(); });
  await act(async () => { mockAudioReady(audio(4)); });
  expect(mockNativeStop).not.toHaveBeenCalled();
  await finishStream(null);
  mockFinalUpdate = deferred();
  mockStreamEnd = deferred();
  await act(async () => { button('Resume').props.onPress(); });

  await act(async () => { mockAudioReady(audio(1)); });
  expect(mockNativeStop).toHaveBeenCalledTimes(1);
  // More buffers arriving while it stops don't stop it twice.
  await act(async () => { mockAudioReady(audio(1)); });
  expect(mockNativeStop).toHaveBeenCalledTimes(1);
});

describe('live preview in other languages', () => {
  const { updateSettings } = require('../services/settings');

  beforeEach(async () => {
    await act(async () => { await updateSettings({ transcriptionLanguage: 'fr' }); });
  });
  afterEach(async () => {
    await act(async () => { await updateSettings({ transcriptionLanguage: 'auto' }); });
  });

  test('speech is transcribed in the chosen language while recording, and kept when the take is saved', async () => {
    mockTranscribeWindow.mockResolvedValue(' Bonjour tout le monde.');
    await startRecording();
    expect(mockAcquire).toHaveBeenCalledWith('fr');

    // The first window is transcribed as soon as it holds a second and a half of speech.
    await act(async () => { for (let i = 0; i < 16; i++) mockAudioReady(audio(0.1, 0.2)); });
    expect(mockTranscribeWindow).toHaveBeenCalledTimes(1);
    expect(mockTranscribeWindow.mock.calls[0][0]).toHaveLength(1.5 * 16000);
    // Shown as an interim guess until the phrase ends.
    const interim = screen.root.findAllByType(Text).some((node: any) =>
      Array.isArray(node.props.children) && node.props.children.join('') === ' Bonjour tout le monde.');
    expect(interim).toBe(true);

    await act(async () => {
      recordButton().props.onPress();
      mockStop.resolve({ status: 'success' });
    });
    expect(shows('Bonjour tout le monde.')).toBe(true);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    await act(async () => { button('Save').props.onPress(); });
    expect(mockSavedNotes[0].transcription).toBe('Bonjour tout le monde.');
  });

  test('pausing commits the words said so far and runs nothing until Resume', async () => {
    mockTranscribeWindow.mockResolvedValueOnce('Première partie.').mockResolvedValueOnce('Deuxième partie.');
    await startRecording();
    await act(async () => { for (let i = 0; i < 10; i++) mockAudioReady(audio(0.1, 0.2)); });
    // Under the first window's length, so nothing was transcribed yet.
    expect(mockTranscribeWindow).not.toHaveBeenCalled();

    await act(async () => { button('Pause').props.onPress(); });
    expect(mockTranscribeWindow).toHaveBeenCalledTimes(1);
    expect(shows('Première partie.')).toBe(true);
    await act(async () => { for (let i = 0; i < 20; i++) mockAudioReady(audio(0.1, 0.2)); });
    expect(mockTranscribeWindow).toHaveBeenCalledTimes(1);

    await act(async () => { button('Resume').props.onPress(); });
    await act(async () => { for (let i = 0; i < 10; i++) mockAudioReady(audio(0.1, 0.2)); });
    await act(async () => {
      recordButton().props.onPress();
      mockStop.resolve({ status: 'success' });
    });
    expect(shows('Première partie. Deuxième partie.')).toBe(true);
  });

  test('a preview that fails does not cost the recording', async () => {
    mockTranscribeWindow.mockRejectedValue(new Error('model crashed'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await startRecording();
    await act(async () => { for (let i = 0; i < 16; i++) mockAudioReady(audio(0.1, 0.2)); });
    await act(async () => {
      recordButton().props.onPress();
      mockStop.resolve({ status: 'success' });
    });
    warn.mockRestore();
    await act(async () => { button('Save').props.onPress(); });
    expect(mockSavedNotes[0]).toMatchObject({ transcription: '', source: 'recording' });
    expect(mockSavedNotes[0].duration).toBeCloseTo(1.6, 5);
  });

  test('the preview joins a take already under way once the language model has downloaded', async () => {
    const downloading = 'The live preview starts once the speech model for this language has downloaded. Until then, the transcript is written after you save.';
    await act(async () => { mockModelInstalled(false); });
    expect(shows(downloading)).toBe(true);
    mockAcquire.mockResolvedValueOnce(null as never);
    mockTranscribeWindow.mockResolvedValue('La suite.');
    await startRecording();
    await act(async () => { for (let i = 0; i < 16; i++) mockAudioReady(audio(0.1, 0.2)); });
    expect(mockTranscribeWindow).not.toHaveBeenCalled();

    await act(async () => { mockModelInstalled(true); });
    expect(shows(downloading)).toBe(false);
    expect(mockAcquire).toHaveBeenCalledTimes(2);
    await act(async () => { for (let i = 0; i < 16; i++) mockAudioReady(audio(0.1, 0.2)); });
    expect(mockTranscribeWindow).toHaveBeenCalledTimes(1);
    // Only what was said since the model arrived.
    expect(mockTranscribeWindow.mock.calls[0][0]).toHaveLength(1.5 * 16000);

    await act(async () => {
      recordButton().props.onPress();
      mockStop.resolve({ status: 'success' });
    });
    expect(shows('La suite.')).toBe(true);
    // One model hold, one release: nothing keeps the model in memory afterwards.
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  describe('on a phone where the model is slow', () => {
    const speak = (seconds: number) =>
      act(async () => { for (let i = 0; i < Math.round(seconds * 10); i++) mockAudioReady(audio(0.1, 0.2)); });

    test('Stop does not wait for the preview: the take is ready at once, its last words arrive afterwards', async () => {
      const window = deferred<string>();
      mockTranscribeWindow.mockReturnValueOnce(window.promise).mockResolvedValueOnce(' Bonjour à tous.');
      await startRecording();
      await speak(1.6);
      expect(mockTranscribeWindow).toHaveBeenCalledTimes(1);

      await act(async () => {
        recordButton().props.onPress();
        mockStop.resolve({ status: 'success' });
      });
      // The model is still on its first window, and nothing waits for it.
      expect(recordButton().props.accessibilityLabel).toBe('Start recording');
      expect(recordButton().props.accessibilityState).toEqual({ disabled: false, busy: false });
      expect(button('Save').props.disabled).toBe(false);
      expect(shows('Finishing preview…')).toBe(true);
      expect(mockRelease).not.toHaveBeenCalled();

      await act(async () => { window.resolve(' Bonjour'); });
      // That window was cut before the last words: one more pass covers them.
      expect(mockTranscribeWindow).toHaveBeenCalledTimes(2);
      expect(shows('Bonjour à tous.')).toBe(true);
      expect(shows('Finishing preview…')).toBe(false);
      expect(mockRelease).toHaveBeenCalledTimes(1);

      await act(async () => { button('Save').props.onPress(); });
      expect(mockSavedNotes[0].transcription).toBe('Bonjour à tous.');
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    test('saving while the preview is still finishing keeps the take, lets go of the model and ignores the late text', async () => {
      const window = deferred<string>();
      mockTranscribeWindow.mockReturnValueOnce(window.promise);
      await startRecording();
      await speak(1.6);
      await act(async () => {
        recordButton().props.onPress();
        mockStop.resolve({ status: 'success' });
      });
      expect(shows('Finishing preview…')).toBe(true);

      await act(async () => { button('Save').props.onPress(); });
      expect(mockSavedNotes).toHaveLength(1);
      expect(mockSavedNotes[0]).toMatchObject({ transcription: '', source: 'recording' });
      expect(mockSavedNotes[0].duration).toBeCloseTo(1.6, 5);
      // The model is asked to stop and is released, once.
      expect(mockAbortWindow).toHaveBeenCalledTimes(1);
      expect(mockRelease).toHaveBeenCalledTimes(1);

      await act(async () => { window.resolve(' Bonjour'); });
      expect(shows('Bonjour')).toBe(false);
      expect(mockTranscribeWindow).toHaveBeenCalledTimes(1);
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    test('a new take started while the last one is still finishing gets its own preview', async () => {
      const window = deferred<string>();
      mockTranscribeWindow.mockReturnValueOnce(window.promise).mockResolvedValue(' Deuxième prise.');
      await startRecording();
      await speak(1.6);
      await act(async () => {
        recordButton().props.onPress();
        mockStop.resolve({ status: 'success' });
      });
      expect(shows('Finishing preview…')).toBe(true);

      await startRecording();
      expect(mockRelease).toHaveBeenCalledTimes(1);
      expect(mockAcquire).toHaveBeenCalledTimes(2);
      expect(shows('Finishing preview…')).toBe(false);
      // The first take's late text does not land in the second.
      await act(async () => { window.resolve(' Première prise.'); });
      expect(shows('Première prise.')).toBe(false);

      await speak(1.6);
      await act(async () => { recordButton().props.onPress(); });
      expect(shows('Deuxième prise.')).toBe(true);
      expect(mockRelease).toHaveBeenCalledTimes(2);
    });

    test('Resume does not wait for the preview either, and the words said before the pause still arrive', async () => {
      const window = deferred<string>();
      mockTranscribeWindow
        .mockReturnValueOnce(window.promise)
        .mockResolvedValueOnce(' Avant la pause.')
        .mockResolvedValue(' Et après.');
      await startRecording();
      await speak(1.6);
      await act(async () => { button('Pause').props.onPress(); });
      expect(mockPause).toHaveBeenCalledTimes(1);

      // The model is still on its first window.
      await act(async () => { button('Resume').props.onPress(); });
      expect(mockResume).toHaveBeenCalledTimes(1);
      expect(mockAbortWindow).not.toHaveBeenCalled();
      await speak(1.6);
      expect(mockTranscribeWindow).toHaveBeenCalledTimes(1);

      // It answers: the words before the pause are finished first, on their own...
      await act(async () => { window.resolve(' Avant'); });
      expect(mockTranscribeWindow.mock.calls[1][0]).toHaveLength(1.6 * 16000);
      expect(shows('Avant la pause.')).toBe(true);
      // ...then what was said since Resume.
      expect(mockTranscribeWindow).toHaveBeenCalledTimes(3);
      expect(mockTranscribeWindow.mock.calls[2][0]).toHaveLength(1.6 * 16000);

      await act(async () => {
        recordButton().props.onPress();
        mockStop.resolve({ status: 'success' });
      });
      expect(shows('Avant la pause. Et après.')).toBe(true);
    });

    test('a window that takes far too long turns the preview off and says why; after two such takes, later ones do not try', async () => {
      const tooSlow = 'The live preview is too slow on this phone, so it is off. Your recording is transcribed after you save it.';
      let now = Date.now();
      const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
      /** A take whose first window never comes back, saved after `more` further seconds. */
      const slowTake = async (more: number) => {
        mockTranscribeWindow.mockReturnValueOnce(new Promise<string>(() => {}));
        await startRecording();
        await speak(1.6);
        expect(shows(tooSlow)).toBe(false);
        now += 11_000;
        await speak(0.1);
        expect(shows(tooSlow)).toBe(true);
        // The recording itself goes on, and is saved whole.
        await speak(more);
        await act(async () => {
          recordButton().props.onPress();
          mockStop.resolve({ status: 'success' });
        });
        await act(async () => { button('Save').props.onPress(); });
      };
      try {
        await slowTake(1);
        expect(mockTranscribeWindow).toHaveBeenCalledTimes(1);
        expect(mockAbortWindow).toHaveBeenCalledTimes(1);
        expect(mockSavedNotes[0]).toMatchObject({ transcription: '', source: 'recording' });
        expect(mockSavedNotes[0].duration).toBeCloseTo(2.7, 5);
        expect(mockRelease).toHaveBeenCalledTimes(1);

        // Once could be a bad moment: the next take tries again.
        expect(shows(tooSlow)).toBe(false);
        await slowTake(0.5);
        expect(mockAcquire).toHaveBeenCalledTimes(2);
        expect(mockTranscribeWindow).toHaveBeenCalledTimes(2);
        expect(mockRelease).toHaveBeenCalledTimes(2);

        // Twice is the phone: told from the start, and the model is left alone.
        expect(shows(tooSlow)).toBe(true);
        await startRecording();
        await speak(2);
        expect(mockAcquire).toHaveBeenCalledTimes(2);
        expect(mockTranscribeWindow).toHaveBeenCalledTimes(2);
      } finally {
        clock.mockRestore();
      }
    });
  });

  test('without the language model the take is still recorded', async () => {
    mockAcquire.mockResolvedValueOnce(null as never);
    await startRecording();
    await act(async () => { for (let i = 0; i < 16; i++) mockAudioReady(audio(0.1, 0.2)); });
    expect(mockTranscribeWindow).not.toHaveBeenCalled();
    await act(async () => {
      recordButton().props.onPress();
      mockStop.resolve({ status: 'success' });
    });
    await act(async () => { button('Save').props.onPress(); });
    expect(mockSavedNotes[0].duration).toBeCloseTo(1.6, 5);
  });
});
