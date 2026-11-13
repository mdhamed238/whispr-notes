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

function recordButton() {
  return screen.root.findAllByType(AnimatedPressable).find((node: any) => node.props.accessibilityLabel);
}

async function startRecording() {
  await act(async () => { recordButton().props.onPress(); });
  expect(recordButton().props.accessibilityLabel).toBe('Stop recording');
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mockStop = deferred();
  mockFinalUpdate = deferred();
  mockStreamEnd = deferred();
  mockSavedNotes.length = 0;
  mockPush.mockClear();
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
