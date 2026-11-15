/**
 * Record Screen
 * Streaming transcription via react-native-executorch, with the raw audio
 * streamed to a real WAV file alongside it (for playback from the Notes
 * screens).
 */

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ScreenHeader from '@/components/ui/ScreenHeader';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { AUDIO_CONFIG, CAPTURE_BUFFER_SECONDS, STREAMING_CONFIG, UI_CONFIG } from '@/constants/config';
import { isUnspacedLanguage, languageLabel } from '@/constants/languages';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius, Shadow } from '@/constants/theme';
import { usePro } from '@/hooks/usePro';
import { formatDateTime, useI18n } from '@/i18n';
import * as notesRepo from '@/services/db/notesRepo';
import * as enhanceQueue from '@/services/ai/enhanceQueue';
import { effectiveLanguage, livePreviewEngine } from '@/services/ai/language';
import { MODEL_CATALOG, formatBytes } from '@/services/ai/modelCatalog';
import { fallbackTitle } from '@/services/ai/prompts';
import { RecordingControls, type RecordingPhase } from '@/services/recordingControls';
import { LivePreview } from '@/services/livePreview';
import { consumeLiveTranscript, joinTranscript } from '@/services/liveTranscription';
import {
  acquireLiveWhisper,
  isLiveWhisperAvailable,
  isLiveWhisperTooSlow,
  markLiveWhisperTooSlow,
  releaseLiveWhisper,
  subscribeLiveWhisperAvailability,
} from '@/services/liveWhisper';
import { useSettings } from '@/services/settings';
import { runHarness } from '@/services/transcriptionHarness';
import { WavFileWriter } from '@/services/wavEncoder';
import { bucketPeaks } from '@/services/waveform';
import { PEAK_COUNT, savePeaks } from '@/services/waveformStore';
import { Note } from '@/types';
import { haptic } from '@/services/haptics';
import { useActionSheet } from '@/components/ui/ActionSheet';
import { useToast } from '@/components/ui/Toast';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StatusBar,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';
import { AudioManager, AudioRecorder } from 'react-native-audio-api';
// `/legacy` on purpose: executorch 0.10's new root API returns plain strings
// from transcribe()/stream() with no `verbose` option, so segment and word
// timestamps — which the note timeline is built on — are only available here.
import { models, useSpeechToText } from 'react-native-executorch/legacy';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import AnimatedPressable from '@/components/ui/AnimatedPressable';

// How close to the bottom (in px) the transcript must be for new text to
// keep auto-scrolling. Scrolling up past this parks the view so the user
// can read back through a long transcript without being yanked down.
const AUTOSCROLL_STICK_THRESHOLD = 32;

function formatClock(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export default function RecordScreen() {
  // Remounting the whole session subtree on a fresh key guarantees a clean
  // AudioRecorder + model instance on Reset, rather than relying on internal
  // hook state — this also means each session gets its own onAudioReady
  // registration, so nothing accumulates across sessions.
  const [sessionId, setSessionId] = useState(0);
  return <RecordingSession key={sessionId} onSessionReset={() => setSessionId((n) => n + 1)} />;
}

function RecordingSession({ onSessionReset }: { onSessionReset: () => void }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  // Memoized so the style objects keep a stable identity across the many
  // re-renders a live transcription drives — without this, StyleSheet.create
  // ran on every stream tick and every memoized child below would still see
  // a new `style` prop and re-render anyway.
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const sheet = useActionSheet();
  const toast = useToast();
  const { t, tp, language: appLanguage } = useI18n();
  const { isPro } = usePro();
  const [settings] = useSettings();

  // The language this recording will be transcribed in, which decides how
  // the live preview is made. English streams word by word through the
  // ExecuTorch model below. Every other language uses the multilingual
  // whisper.cpp model over a sliding window (services/livePreview.ts), once
  // that model is installed; until then the take is simply recorded.
  const spokenLanguage = effectiveLanguage(settings.transcriptionLanguage, appLanguage);
  const streaming = livePreviewEngine(settings.transcriptionLanguage, appLanguage) === 'whisper-base-en';
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  const spokenLanguageRef = useRef(spokenLanguage);
  spokenLanguageRef.current = spokenLanguage;
  // What the take in progress started with (the setting can't change
  // mid-take, but the refs above follow renders).
  const streamingSessionRef = useRef(streaming);
  // The sliding-window preview of the take in progress, when there is one.
  const previewRef = useRef<LivePreview | null>(null);
  // Its model is being loaded; a second load would hold the model twice.
  const previewStartingRef = useRef(false);
  // Counts takes, so a model that finishes loading late can tell its take is over.
  const takeRef = useRef(0);
  const [windowModelReady, setWindowModelReady] = useState(() => isLiveWhisperAvailable());
  useEffect(() => subscribeLiveWhisperAvailability(setWindowModelReady), []);
  // The multilingual model needs too long per window on this phone for a
  // preview to be worth its cost (see LIVE_PREVIEW_TUNING.maxRunSeconds).
  const [previewTooSlow, setPreviewTooSlow] = useState(() => isLiveWhisperTooSlow());
  // Whether this take gets a live preview. Without one it is still recorded
  // and transcribed after saving.
  const hasPreview = streaming || (windowModelReady && !previewTooSlow);
  // After Stop, the sliding-window preview is still writing its last words.
  const [previewFinishing, setPreviewFinishing] = useState(false);

  // react-native-audio-api 0.13 moved buffer configuration off the
  // constructor and onto onAudioReady, so the recorder itself is now
  // parameterless and the capture format is declared at registration below.
  const [recorder] = useState(() => new AudioRecorder());

  // English-only export, used for English alone. The multilingual
  // `whisper_base()` (with a `language` option on stream()) was tried here
  // and reverted: it threw "[Whisper] The 'decode' method did not succeed"
  // on device. That is not a bad download (the cached .pte is byte-exact
  // against Hugging Face) nor a tokenizer gap, so the cause is still unknown;
  // other languages therefore preview through whisper.cpp instead. Note the
  // library throws if `language` is passed to a non-multilingual model.
  const model = useSpeechToText({
    vad: STREAMING_CONFIG.USE_VAD ? models.vad.fsmn_vad() : undefined,
    model: models.speech_to_text.whisper_base_en(),
    // Not needed in other languages: nothing to download or keep in memory.
    preventLoad: !streaming,
  });
  // Other languages can always record; their preview joins in when it can.
  const ready = streaming ? model.isReady : true;
  const streamingModelSize = formatBytes(MODEL_CATALOG['whisper-base-en'].approxBytes);

  // Bug fix: useSpeechToText rebuilds `streamInsert` (via useCallback keyed
  // on `isReady`) every time readiness changes, and the rebuilt version
  // throws ModuleNotLoaded if the `isReady` it closed over was false at
  // creation time. The onAudioReady callback below is registered exactly
  // once per session (see that effect's comment for why), so without this
  // ref it would permanently call the very first render's streamInsert —
  // captured while the model was still loading — meaning every audio
  // buffer was silently dropped (caught by the try/catch below) and no
  // transcription ever appeared. Keeping this ref current on every render
  // and reading through it lets the one-time registration always reach the
  // latest, ready-bound streamInsert.
  const modelRef = useRef(model);
  modelRef.current = model;

  // v0.9.3 removed the hook's own committedTranscription/nonCommittedTranscription
  // — the caller now has to consume model.stream()'s async generator and
  // accumulate the text itself. transcriptRef backs the accumulation (so the
  // streaming loop always appends to the latest value even across renders);
  // transcript state is just its mirror for rendering.
  const transcriptRef = useRef({ committed: '', nonCommitted: '' });
  const [transcript, setTranscript] = useState({ committed: '', nonCommitted: '' });

  // Audio is streamed straight to a WAV file on disk as it arrives rather
  // than accumulated in memory and encoded on stop — see
  // services/wavEncoder.ts for why that matters for long recordings.
  const writerRef = useRef<WavFileWriter | null>(null);

  // Live input level (RMS per buffer), consumed by the waveform on the UI
  // thread. A shared value keeps the 10Hz meter off the React render path
  // entirely, so it costs nothing per frame.
  const audioLevel = useSharedValue(0);

  const [captured, setCaptured] = useState<{ audioUri: string | null; duration: number; chunkPeaks: number[] }>({
    audioUri: null,
    duration: 0,
    chunkPeaks: [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [controls] = useState(() => new RecordingControls((next) => {
    if (mountedRef.current) setPhase(next);
  }));
  const streamTaskRef = useRef<Promise<string> | null>(null);
  // The preview finishing its last words after Pause; Resume and Stop wait for it.
  const pausingRef = useRef<Promise<void> | null>(null);
  const resumingRef = useRef(false);
  const capturedUriRef = useRef<string | null>(null);

  // Dev-only fixture run (see services/transcriptionHarness).
  const [isRunningHarness, setIsRunningHarness] = useState(false);

  // Microphone state is independent of inference, which can still be
  // flushing its last words after capture has stopped.
  const isRecording = phase === 'recording';
  const isPaused = phase === 'paused';
  // A take is in progress, capturing or paused.
  const inSession = isRecording || isPaused;
  const isTransitioning = phase === 'starting' || phase === 'stopping';

  // Runaway guard: stops a take left running by accident. Measured in
  // recorded time (read from the audio callback), so pauses don't count.
  const limitHandlerRef = useRef<() => void>(() => {});
  const limitReachedRef = useRef(false);
  const maxSecondsRef = useRef<number>(UI_CONFIG.MAX_RECORDING_DURATION_SECONDS);

  // Read through a ref by the once-registered interruption listener so it
  // always sees the current recording state.
  const interruptionHandlerRef = useRef<() => void>(() => {});

  const transcriptScrollRef = useRef<ScrollView>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // The session subtree is remounted on Reset/Save, so a writer still
      // open here belongs to a recording that will never be saved.
      writerRef.current?.discard();
      writerRef.current = null;
      if (previewRef.current) {
        previewRef.current.dispose();
        previewRef.current = null;
        releaseLiveWhisper();
      }
      try {
        modelRef.current.streamStop();
      } catch {
        // Nothing was streaming (the preview model isn't loaded in this language).
      }
      void recorder.stop().catch((error) => console.warn('Recorder cleanup failed:', error));
      const uri = capturedUriRef.current;
      // A save still in flight owns this file until its database write settles.
      if (uri && !savingRef.current) void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      enhanceQueue.setRecordingActive(false);
    };
  }, []);

  useEffect(() => {
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'spokenAudio',
      // Renamed in react-native-audio-api 0.13 (was 'allowBluetooth').
      iosOptions: ['allowBluetoothHFP', 'defaultToSpeaker'],
    });

    // A phone call, alarm or another app taking the microphone ends the
    // capture under us. Stop cleanly so the WAV is finalized and the take
    // stays ready to save, instead of a recording that silently went dead.
    AudioManager.observeAudioInterruptions(true);
    const interruption = AudioManager.addSystemEventListener('interruption', (event) => {
      if (event.type === 'began') interruptionHandlerRef.current();
    });

    // The options below are a *preference*, not a contract: 0.13 opens the
    // input stream at the hardware rate and resamples into the callback
    // (miniaudio on Android, AVAudioConverter on iOS), so what actually
    // arrives can differ from what was asked for. Both consumers of these
    // buffers assume AUDIO_CONFIG.sampleRate — streamInsert feeds the model,
    // which expects 16 kHz, and the WAV header is written from the same
    // constant — so a mismatch is silent: audio at the wrong rate is
    // transcribed and stored as if it were 16 kHz. Logged on change rather
    // than per buffer (they arrive ~10x/second) to make that visible.
    let lastFormat = '';

    const registration = recorder.onAudioReady(
      {
        sampleRate: AUDIO_CONFIG.sampleRate,
        bufferLength: AUDIO_CONFIG.sampleRate * CAPTURE_BUFFER_SECONDS,
        channelCount: AUDIO_CONFIG.numberOfChannels,
      },
      ({ buffer }) => {
        try {
          if (__DEV__) {
            const format = `${buffer.sampleRate}Hz ${buffer.numberOfChannels}ch ${buffer.length}f`;
            if (format !== lastFormat) {
              lastFormat = format;
              const expected = `${AUDIO_CONFIG.sampleRate}Hz ${AUDIO_CONFIG.numberOfChannels}ch ${AUDIO_CONFIG.sampleRate * CAPTURE_BUFFER_SECONDS}f`;
              console.log(
                `[capture] ${format}` + (format === expected ? '' : ` — EXPECTED ${expected}`)
              );
            }
          }

          // A paused take records nothing, even if a buffer arrives late.
          if (controls.phase === 'paused') return;

          const channelData = buffer.getChannelData(0);
          const writer = writerRef.current;
          writer?.write(channelData);

          let sumSquares = 0;
          for (let i = 0; i < channelData.length; i++) {
            sumSquares += channelData[i] * channelData[i];
          }
          const rms = Math.sqrt(sumSquares / channelData.length);
          audioLevel.value = rms;

          // A failed live preview must not prevent saving the source audio.
          try {
            if (streamingSessionRef.current) modelRef.current.streamInsert(channelData);
            else previewRef.current?.push(channelData, rms);
          } catch (error) {
            console.warn('Live audio insert failed:', error);
          }

          if (writer && writer.durationSeconds >= maxSecondsRef.current) limitHandlerRef.current();
        } catch (error) {
          console.error('Audio buffer processing error:', error);
        }
      }
    );

    // 0.13 reports registration failures through a Result rather than
    // throwing, so a silent failure here would look exactly like a dead
    // microphone — surface it instead.
    if (registration.status === 'error') {
      console.error('Failed to register audio callback:', registration.message);
    }

    return () => {
      interruption?.remove();
      recorder.clearOnAudioReady();
    };
    // Registered once per session (see the remount-key comment above), not
    // re-registered on every Start press.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxSeconds = isPro ? UI_CONFIG.MAX_RECORDING_DURATION_SECONDS_PRO : UI_CONFIG.MAX_RECORDING_DURATION_SECONDS;
  maxSecondsRef.current = maxSeconds;

  const showTranscript = (update: { committed: string; nonCommitted: string }) => {
    transcriptRef.current = update;
    if (mountedRef.current) setTranscript(update);
  };

  /** Starts the English streaming preview; after a pause, continues behind what was already said. */
  const startStream = () => {
    const saidBefore = transcriptRef.current.committed;
    // Retain the task: streamStop requests a flush but does not await it.
    const task = consumeLiveTranscript(
      modelRef.current.stream({
        useVAD: STREAMING_CONFIG.USE_VAD,
        timeout: STREAMING_CONFIG.INFERENCE_TIMEOUT_MS,
        vadDetectionMargin: STREAMING_CONFIG.VAD_DETECTION_MARGIN_MS,
      }),
      showTranscript,
      saidBefore
    );
    streamTaskRef.current = task;
    // `streamTaskRef.current !== task` means we ended this stream ourselves
    // (to pause or stop), which is not something to react to.
    void task.then(() => {
      // Also finalize if the engine ends streaming on its own.
      if (mountedRef.current && streamTaskRef.current === task && controls.phase === 'recording') void handleStopStreaming();
    }, (error) => {
      console.error('Transcription error:', error);
      if (!mountedRef.current || streamTaskRef.current !== task) return;
      void handleStopStreaming();
      toast.show({ message: t('record.previewFailed'), tone: 'error', durationMs: 6000 });
    });
  };

  /** Ends the streaming preview and waits for its last words. */
  const drainStream = async () => {
    const task = streamTaskRef.current;
    if (!task) return;
    streamTaskRef.current = null;
    try {
      modelRef.current.streamStop();
      await task;
    } catch (error) {
      // The WAV remains useful even if inference fails.
      console.warn('Could not finish live transcript:', error);
    }
    // Keep the last interim guess as text, so a resumed stream continues after it.
    const { committed, nonCommitted } = transcriptRef.current;
    if (nonCommitted.trim()) showTranscript({ committed: joinTranscript(committed, nonCommitted.trim()), nonCommitted: '' });
  };

  /** Starts the sliding-window preview for languages the streaming model doesn't speak. */
  const startWindowPreview = async (take: number) => {
    if (previewStartingRef.current || previewRef.current || isLiveWhisperTooSlow()) return;
    previewStartingRef.current = true;
    try {
      const language = spokenLanguageRef.current;
      const transcribe = await acquireLiveWhisper(language);
      if (!transcribe) return;
      // The model can take a moment to load; the take may have ended meanwhile.
      if (!mountedRef.current || takeRef.current !== take || !controls.inSession) {
        releaseLiveWhisper();
        return;
      }
      previewRef.current = new LivePreview({
        sampleRate: AUDIO_CONFIG.sampleRate,
        transcribe,
        abort: () => transcribe.abort(),
        unspaced: isUnspacedLanguage(language),
        onUpdate: showTranscript,
        onTooSlow: (firstWindow) => {
          // Slow from the very first window points at the phone rather than at
          // a busy moment: it is counted, and after the second such take the
          // preview stays off. The recording itself is unaffected.
          if (firstWindow) markLiveWhisperTooSlow();
          if (mountedRef.current) setPreviewTooSlow(true);
        },
        onError: (error) => {
          console.warn('Live preview failed:', error);
          if (mountedRef.current) toast.show({ message: t('record.previewFailed'), tone: 'error', durationMs: 6000 });
        },
      });
    } finally {
      previewStartingRef.current = false;
      // A new take began while the model was loading for the last one.
      if (mountedRef.current && takeRef.current !== take && controls.inSession && !streamingSessionRef.current) {
        void startWindowPreview(takeRef.current);
      }
    }
  };

  // The language model finished downloading during a take: the preview joins
  // in from here (what was said before is transcribed after saving).
  useEffect(() => {
    if (windowModelReady && controls.inSession && !streamingSessionRef.current) void startWindowPreview(takeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowModelReady]);

  /**
   * Lets go of the sliding-window preview and its model. Text still on its
   * way is ignored. The queue's own models waited for this one to get out of
   * the way; they stay waiting when a new take is about to start.
   */
  const releaseWindowPreview = (resumeQueue = true) => {
    const preview = previewRef.current;
    if (!preview) return;
    previewRef.current = null;
    preview.dispose();
    releaseLiveWhisper();
    if (resumeQueue) enhanceQueue.setRecordingActive(false);
    if (mountedRef.current) setPreviewFinishing(false);
  };

  /**
   * After Stop, the sliding-window preview writes its last words in the
   * background. The take is already captured, and whisper needs a full pass
   * for them: seconds on a slower phone, which Stop must not wait for.
   */
  const finishWindowPreview = () => {
    const preview = previewRef.current;
    if (!preview) return;
    setPreviewFinishing(true);
    void preview
      .flush()
      .catch((error) => console.warn('Could not finish live transcript:', error))
      .finally(() => {
        // Unless it was let go of meanwhile: saved, reset, or a new take.
        if (previewRef.current === preview) releaseWindowPreview();
      });
  };

  const handleStartStreaming = async () => {
    const withStream = streamingRef.current;
    if (controls.phase !== 'idle' || savingRef.current || isRunningHarness) return;
    if (withStream && !modelRef.current.isReady) return;
    // The last take's preview may still be finishing; this take replaces it.
    releaseWindowPreview(false);
    try {
      const started = await controls.start(async () => {
        const permission = await AudioManager.requestRecordingPermissions();
        if (!mountedRef.current) return false;
        if (permission !== 'Granted') {
          // Once refused, the system won't ask again: the switch is in Settings.
          sheet.open({
            title: t('record.micDeniedTitle'),
            message: t('record.micDeniedBody'),
            actions: [{ label: t('common.openSettings'), icon: 'settings-outline', onPress: () => void Linking.openSettings() }],
          });
          return false;
        }
        streamingSessionRef.current = withStream;

        // Keep the motor out of the captured audio, including the first word.
        await haptic('medium');
        if (!mountedRef.current) return false;
        writerRef.current?.discard();
        writerRef.current = WavFileWriter.create(AUDIO_CONFIG.sampleRate);
        enhanceQueue.setRecordingActive(true);
        const result = await recorder.start();
        if (result.status === 'error') throw new Error(result.message);
        if (!mountedRef.current) {
          await recorder.stop();
          return false;
        }

        showTranscript({ committed: '', nonCommitted: '' });
        setPreviewTooSlow(isLiveWhisperTooSlow());
        stickToBottomRef.current = true;
        limitReachedRef.current = false;
        pausingRef.current = null;
        return true;
      });
      if (!started) {
        writerRef.current?.discard();
        writerRef.current = null;
        enhanceQueue.setRecordingActive(false);
        return;
      }

      const take = ++takeRef.current;
      if (withStream) startStream();
      else void startWindowPreview(take);
    } catch (error) {
      console.error('Failed to start streaming:', error);
      writerRef.current?.discard();
      writerRef.current = null;
      enhanceQueue.setRecordingActive(false);
      if (mountedRef.current) toast.show({ message: t('record.startFailed'), tone: 'error' });
    }
  };

  const handleStopStreaming = async () => {
    try {
      await controls.stop(async () => {
        try {
          // Capture ends before transcription finishes. Keep the button busy
          // until both the native recorder and the final stream update settle.
          const stopped = await recorder.stop();
          if (stopped.status === 'error') {
            if (recorder.isRecording()) throw new Error(stopped.message);
            console.warn('Recorder stop reported an error:', stopped.message);
          }
        } catch (error) {
          if (recorder.isRecording()) throw error;
          console.warn('Recorder already stopped:', error);
        }
        audioLevel.value = 0;
        if (streamingSessionRef.current) {
          try {
            // A pause may still be finishing its last words.
            await pausingRef.current;
            await drainStream();
          } catch (error) {
            // The WAV remains useful even if the preview fails.
            console.warn('Could not finish live transcript:', error);
          } finally {
            pausingRef.current = null;
            enhanceQueue.setRecordingActive(false);
          }
        } else {
          pausingRef.current = null;
          if (previewRef.current) finishWindowPreview();
          else enhanceQueue.setRecordingActive(false);
        }

        const writer = writerRef.current;
        writerRef.current = null;
        const result = writer ? writer.finalize() : null;
        const previousUri = capturedUriRef.current;
        capturedUriRef.current = result?.uri ?? null;
        if (previousUri) {
          await FileSystem.deleteAsync(previousUri, { idempotent: true }).catch((error) => {
            console.warn('Failed to delete previous captured audio:', error);
          });
        }
        if (mountedRef.current) {
          setCaptured(result
            ? { audioUri: result.uri, duration: result.durationSeconds, chunkPeaks: result.chunkPeaks }
            : { audioUri: null, duration: 0, chunkPeaks: [] });
          void haptic('light');
        } else if (result) {
          await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
        }
      });
    } catch (error) {
      console.error('Failed to stop recording:', error);
      if (mountedRef.current) toast.show({ message: t('record.stopFailed'), tone: 'error' });
    }
  };

  const handlePause = () => {
    try {
      const paused = controls.pause(() => {
        recorder.pause();
        // The native call returns quietly when it has nothing to pause.
        if (!recorder.isPaused()) throw new Error('The recorder did not pause');
      });
      if (!paused) return;
    } catch (error) {
      console.error('Failed to pause recording:', error);
      toast.show({ message: t('record.pauseFailed'), tone: 'error' });
      return;
    }
    audioLevel.value = 0;
    void haptic('light');
    // Finish the preview for what was said so far; after that nothing runs
    // while paused, neither microphone nor model. The streaming model has to
    // be done before Resume can start it again. The sliding-window preview
    // finishes in the background, and Resume does not wait for it.
    const finishing = streamingSessionRef.current ? drainStream() : previewRef.current?.flush() ?? Promise.resolve();
    const settled = finishing.catch((error) => console.warn('Could not finish live transcript before pausing:', error));
    pausingRef.current = streamingSessionRef.current ? settled : null;
  };

  const handleResume = async () => {
    if (controls.phase !== 'paused' || resumingRef.current) return;
    resumingRef.current = true;
    try {
      // The streaming preview must have said its last words before it is
      // started again. (The sliding-window one keeps the two apart by itself.)
      await pausingRef.current;
      // Keep the motor out of the captured audio, as on Start.
      await haptic('light');
      if (!mountedRef.current) return;
      const resumed = controls.resume(() => {
        recorder.resume();
        if (recorder.isPaused()) throw new Error('The recorder did not resume');
      });
      if (!resumed) return;
      if (streamingSessionRef.current) startStream();
    } catch (error) {
      console.error('Failed to resume recording:', error);
      if (mountedRef.current) toast.show({ message: t('record.pauseFailed'), tone: 'error' });
    } finally {
      resumingRef.current = false;
    }
  };

  limitHandlerRef.current = () => {
    if (limitReachedRef.current || controls.phase !== 'recording') return;
    limitReachedRef.current = true;
    void handleStopStreaming();
    const minutes = Math.round(maxSeconds / 60);
    toast.show({
      message: isPro ? t('record.maxReached', { minutes }) : t('record.maxReachedFree', { minutes }),
      durationMs: 8000,
    });
  };

  interruptionHandlerRef.current = () => {
    // A call or another app took the microphone: keep what was captured.
    if (!controls.inSession) return;
    void handleStopStreaming().then(() => {
      if (!mountedRef.current || controls.phase !== 'idle') return;
      void haptic('warning');
      toast.show({ message: t('record.interrupted'), durationMs: 6000 });
    });
  };

  /**
   * Runs the fixture harness against the live model instance.
   *
   * Deliberately the same `modelRef.current` the recorder feeds, not a
   * second instance: the point is to test the model this app actually
   * loaded, on this device, with whatever it downloaded.
   */
  const handleRunHarness = async () => {
    setIsRunningHarness(true);
    try {
      // Runs every fixture once. To narrow a sweep or measure the streamed
      // route's run-to-run spread, pass options — e.g.
      // `{ only: 'greeting', streamRepeats: 5 }`.
      const results = await runHarness(modelRef.current);
      const summary = results
        .map((result) => {
          if (result.oneShotWer === undefined) {
            return `${result.fixture}\n${result.oneShot || '(empty)'}`;
          }
          // One-shot leads: it is the deterministic column, so it is the one
          // worth reading off a single run.
          return `${result.fixture} — one-shot ${result.oneShotWer.toFixed(2)} / streamed ${result.streamedWer!.toFixed(2)}`;
        })
        .join('\n');
      Alert.alert(
        'Harness',
        summary || 'No fixtures ran. See the Metro log.',
        undefined,
        // Transcripts run long; the full side-by-side is in the log.
        { cancelable: true }
      );
    } finally {
      setIsRunningHarness(false);
    }
  };

  const handleSaveTranscription = async () => {
    if (controls.phase !== 'idle' || savingRef.current) return;
    const text = (transcriptRef.current.committed + transcriptRef.current.nonCommitted).trim();
    if (!text && !captured.audioUri) {
      toast.show({ message: t('record.nothingToSave') });
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    // The note takes the preview as it stands; its model makes way for the final pass.
    releaseWindowPreview();
    try {
      const now = new Date();
      const note: Note = {
        id: now.getTime().toString(),
        // A placeholder until the AI title is written from the final transcript.
        title: fallbackTitle(
          text,
          now,
          t('note.untitledDated', {
            date: formatDateTime(now, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
          })
        ),
        transcription: text,
        audioUri: captured.audioUri,
        duration: captured.duration,
        tags: [],
        pinned: false,
        createdAt: now,
        updatedAt: now,
        summary: null,
        language: null,
        source: 'recording',
        enhancement: 'none',
        enhancementProgress: 0,
        titleIsAuto: true,
        contentHash: null,
      };

      await notesRepo.createNote(note);
      // Ownership transfers to the saved note, so remount cleanup keeps it.
      capturedUriRef.current = null;
      // The waveform was measured while capturing; the note never has to
      // decode its own recording to draw it.
      if (note.audioUri && captured.chunkPeaks.length > 0) {
        savePeaks(note.id, bucketPeaks(captured.chunkPeaks, PEAK_COUNT));
      }
      // The enhanced transcript, timings and summary are background work
      // on the saved note (services/ai/enhanceQueue); the user moves on now.
      if (note.audioUri) {
        await enhanceQueue.enqueue(note.id, 'enhance').catch((error) => {
          console.warn('Note saved, but could not queue final transcription:', error);
        });
      }
      void haptic('success');

      // The note is saved and the user moves on immediately — the timeline
      // is enrichment, not part of the save. It resolves onto the stored
      // note a few seconds later, and the note is perfectly usable without
      // it if the pass fails.
      router.push(`/note/${note.id}`);
      onSessionReset();
    } catch (error) {
      console.error('Failed to save note:', error);
      void haptic('error');
      if (!mountedRef.current) {
        const uri = capturedUriRef.current;
        capturedUriRef.current = null;
        if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
        return;
      }
      toast.show({ message: t('record.saveFailed'), tone: 'error' });
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const confirmReset = () =>
    sheet.open({
      title: t('record.discardTitle'),
      message: t('record.discardBody'),
      actions: [{ label: t('record.discard'), icon: 'trash-outline', destructive: true, onPress: () => void handleReset() }],
    });

  const handleReset = async () => {
    if (controls.phase !== 'idle' || savingRef.current) return;
    // Bug fix: Reset used to discard `captured` (and the whole session, via
    // remount) without deleting the WAV file already written to disk at
    // captured.audioUri, orphaning it — only a saved note's audio should
    // survive past this point.
    if (captured.audioUri) {
      try {
        await FileSystem.deleteAsync(captured.audioUri, { idempotent: true });
      } catch (error) {
        console.warn('Failed to delete captured audio on reset:', error);
      }
    }
    onSessionReset();
  };

  /** Recorded time so far. Paused time isn't recorded, so it isn't counted. */
  const recordedSeconds = useCallback(() => writerRef.current?.durationSeconds ?? 0, []);

  const handleTranscriptScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    stickToBottomRef.current = distanceFromBottom <= AUTOSCROLL_STICK_THRESHOLD;
  }, []);

  const handleTranscriptContentSizeChange = useCallback(() => {
    if (stickToBottomRef.current) {
      transcriptScrollRef.current?.scrollToEnd({ animated: true });
    }
  }, []);

  const downloadProgress = useSharedValue(0);
  useEffect(() => {
    downloadProgress.value = withTiming(model.downloadProgress, { duration: 300 });
  }, [model.downloadProgress, downloadProgress]);
  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${Math.min(downloadProgress.value, 1) * 100}%`,
  }));

  const hasTranscript = Boolean(transcript.committed || transcript.nonCommitted);
  const wordCount = useMemo(
    () => countWords(transcript.committed + transcript.nonCommitted),
    [transcript.committed, transcript.nonCommitted]
  );
  // Only the tail while recording (see LIVE_TRANSCRIPT_TAIL_CHARS); the whole
  // transcript once it stops.
  const shownCommitted = useMemo(() => {
    const text = transcript.committed;
    const tail = UI_CONFIG.LIVE_TRANSCRIPT_TAIL_CHARS;
    if (!inSession || text.length <= tail) return text;
    // Start on a word boundary when there is one.
    const space = text.indexOf(' ', text.length - tail);
    return `…${text.slice(space >= 0 ? space + 1 : text.length - tail)}`;
  }, [transcript.committed, inSession]);
  const languageName = languageLabel(spokenLanguage);
  const canChangeLanguage = phase === 'idle' && !isSaving && !captured.audioUri && !hasTranscript;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={styles.content}>
        <ScreenHeader
          title={t('record.title')}
          subtitle={
            ready
              ? t('record.ready')
              : model.error
                ? t('record.modelFailed')
                : model.downloadProgress > 0
                  ? t('record.downloadingModel', { percent: Math.round(model.downloadProgress * 100) })
                  : t('record.loadingModel')
          }
          right={
            <AnimatedPressable
              haptic="selection"
              disabled={!canChangeLanguage}
              onPress={() => router.push({ pathname: '/language', params: { kind: 'transcription' } })}
              style={[styles.languageChip, !canChangeLanguage && { opacity: 0.5 }]}
              accessibilityRole="button"
              accessibilityLabel={t('record.languageA11y', { language: languageName })}
            >
              <Ionicons name="language" size={15} color={colors.tint} />
              <Text style={styles.languageChipText} numberOfLines={1}>
                {languageName}
              </Text>
              <Ionicons name="chevron-down" size={13} color={colors.textMuted} />
            </AnimatedPressable>
          }
        />

        {!ready ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.loadingContainer}>
            {model.error ? (
              // The download (or the load) failed. The library only reports it;
              // left unshown, this was a progress bar at 0% for ever.
              <Card style={styles.loadingCard} elevation="sm">
                <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} style={styles.loadingIcon} />
                <Text style={styles.loadingText}>{t('record.modelFailed')}</Text>
                <Text style={styles.loadingNote}>{t('record.modelFailedBody', { size: streamingModelSize })}</Text>
                {/* The library's own words, untranslated: what a bug report needs. */}
                <Text style={styles.loadingReason} numberOfLines={4} selectable>
                  {model.error.message}
                </Text>
                {/* A fresh session mounts the model hook again, which starts the load over. */}
                <Button label={t('common.retry')} icon="refresh" onPress={onSessionReset} style={styles.retryButton} />
              </Card>
            ) : (
              <Card style={styles.loadingCard} elevation="sm">
                <Text style={styles.loadingText}>{t('record.loadingCard')}</Text>
                <Text style={styles.progressText}>{Math.round(model.downloadProgress * 100)}%</Text>
                <View style={styles.progressTrack}>
                  <Animated.View style={[styles.progressFill, progressBarStyle]} />
                </View>
                <Text style={styles.loadingNote}>{t('record.modelDownloadNote', { size: streamingModelSize })}</Text>
              </Card>
            )}
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown.duration(400)} style={{ flex: 1 }}>
            <View style={styles.recordButtonContainer}>
              <PulseRecordButton
                inSession={inSession}
                pulsing={isRecording}
                busy={isTransitioning}
                disabled={!ready || isSaving || isRunningHarness || isTransitioning}
                onPress={inSession ? handleStopStreaming : handleStartStreaming}
                colors={colors}
                labels={{ start: t('record.start'), stop: t('record.stop'), busy: t('record.processing') }}
              />
              <RecordingStatus
                isRecording={isRecording}
                isPaused={isPaused}
                phase={phase}
                level={audioLevel}
                getSeconds={recordedSeconds}
                colors={colors}
                styles={styles}
                labels={{
                  idle: t('record.tapToStart'),
                  starting: t('record.starting'),
                  stopping: t('record.finishing'),
                  paused: t('record.paused'),
                }}
              />
              {inSession && (
                <Button
                  label={isPaused ? t('record.resume') : t('record.pause')}
                  icon={isPaused ? 'play' : 'pause'}
                  variant="secondary"
                  // Each handler times its own haptic around the microphone.
                  haptic="none"
                  onPress={isPaused ? () => void handleResume() : handlePause}
                  style={styles.pauseButton}
                />
              )}
              {__DEV__ && streaming && (
                <Button
                  label={isRunningHarness ? 'Running harness…' : 'Run harness'}
                  icon="flask"
                  variant="secondary"
                  loading={isRunningHarness}
                  disabled={!model.isReady || phase !== 'idle' || isRunningHarness || isSaving}
                  onPress={handleRunHarness}
                  style={styles.harnessButton}
                />
              )}
            </View>

            <Card style={styles.transcriptionCard} elevation="sm">
              <View style={styles.transcriptionHeader}>
                <Text style={styles.transcriptionLabel}>
                  {!hasPreview
                    ? t('record.transcript')
                    : inSession
                      ? t('record.livePreview')
                      : phase === 'stopping' || previewFinishing
                        ? t('record.finishingPreview')
                        : t('record.transcript')}
                </Text>
                {wordCount > 0 && <Text style={styles.wordCount}>{tp('record.words', wordCount)}</Text>}
              </View>

              <ScrollView
                ref={transcriptScrollRef}
                style={styles.transcriptionScroll}
                showsVerticalScrollIndicator={false}
                onScroll={handleTranscriptScroll}
                scrollEventThrottle={64}
                onContentSizeChange={handleTranscriptContentSizeChange}
              >
                {hasTranscript ? (
                  <Text style={styles.transcriptionText}>
                    {/* Memoized so a growing committed transcript isn't
                        re-rendered on every interim (non-committed) update. */}
                    <CommittedTranscript text={shownCommitted} style={styles.committedText} />
                    {transcript.nonCommitted && (
                      <Text style={styles.nonCommittedText}> {transcript.nonCommitted}</Text>
                    )}
                  </Text>
                ) : (
                  <Text style={styles.waitingText}>
                    {isPaused
                      ? t('record.paused')
                      : isRecording
                        ? t('record.speakNow')
                        : captured.audioUri
                          ? t('record.noPreviewCaptured')
                          : t('record.tapMicHint')}
                  </Text>
                )}
              </ScrollView>

              <Text style={styles.languageHint}>
                {hasPreview
                  ? t('record.previewHint')
                  : !streaming && windowModelReady
                    ? t('record.previewTooSlow')
                    : t('record.previewDownloading')}
              </Text>

              {(hasTranscript || captured.audioUri) && !inSession && phase !== 'starting' && (
                <Animated.View entering={FadeIn.duration(200)} style={styles.actionButtons}>
                  <Button
                    label={isSaving ? t('record.saving') : phase === 'stopping' ? t('record.finishing') : t('common.save')}
                    icon="checkmark-circle"
                    variant="primary"
                    loading={isSaving}
                    disabled={isSaving || phase !== 'idle' || isRunningHarness}
                    onPress={handleSaveTranscription}
                    haptic="none"
                    style={styles.saveButton}
                  />
                  <Button
                    label={t('record.reset')}
                    icon="refresh"
                    variant="secondary"
                    disabled={isSaving || phase !== 'idle' || isRunningHarness}
                    onPress={confirmReset}
                    style={styles.resetButton}
                  />
                </Animated.View>
              )}
            </Card>
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}

const CommittedTranscript = React.memo(function CommittedTranscript({
  text,
  style,
}: {
  text: string;
  style: StyleProp<TextStyle>;
}) {
  return <Text style={style}>{text}</Text>;
});

/**
 * Elapsed time + live waveform while recording, idle hint otherwise.
 * Split out so the once-a-second clock tick re-renders only this subtree
 * rather than the whole screen (and the growing transcript with it).
 */
function RecordingStatus({
  isRecording,
  isPaused,
  phase,
  level,
  getSeconds,
  colors,
  styles,
  labels,
}: {
  isRecording: boolean;
  isPaused: boolean;
  phase: RecordingPhase;
  level: SharedValue<number>;
  /** Seconds recorded so far (must keep a stable identity). */
  getSeconds: () => number;
  colors: typeof Colors.light;
  styles: ReturnType<typeof createStyles>;
  labels: { idle: string; starting: string; stopping: string; paused: string };
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!isRecording && !isPaused) {
      setSeconds(0);
      return;
    }
    // Read from the audio actually written rather than a counter or the
    // wall clock: it can't drift when inference delays a tick, and it stands
    // still while paused.
    const read = () => setSeconds(Math.floor(getSeconds()));
    read();
    if (!isRecording) return;
    const id = setInterval(read, 250);
    return () => clearInterval(id);
  }, [isRecording, isPaused, getSeconds]);

  if (!isRecording && !isPaused) {
    return <Text style={styles.recordButtonText} accessibilityLiveRegion="polite">
      {phase === 'starting' ? labels.starting : phase === 'stopping' ? labels.stopping : labels.idle}
    </Text>;
  }

  return (
    <>
      <Text style={styles.elapsedText}>{formatClock(seconds)}</Text>
      {isPaused ? (
        <Text style={styles.pausedText} accessibilityLiveRegion="polite">{labels.paused}</Text>
      ) : (
        <Waveform level={level} colors={colors} />
      )}
    </>
  );
}

const RECORD_SIZE = 128;

function PulseRecordButton({
  inSession,
  pulsing,
  busy = false,
  disabled,
  onPress,
  colors,
  labels,
}: {
  /** A take is in progress (capturing or paused): the button stops it. */
  inSession: boolean;
  /** The microphone is capturing right now. */
  pulsing: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
  colors: typeof Colors.light;
  labels: { start: string; stop: string; busy: string };
}) {
  const ring1 = useSharedValue(0);
  const ring2 = useSharedValue(0);

  useEffect(() => {
    if (pulsing) {
      ring1.value = 0;
      ring2.value = 0;
      ring1.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.ease) }), -1, false);
      ring2.value = withDelay(
        800,
        withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.ease) }), -1, false)
      );
    } else {
      ring1.value = withTiming(0, { duration: 200 });
      ring2.value = withTiming(0, { duration: 200 });
    }
  }, [pulsing, ring1, ring2]);

  const ring1Style = useAnimatedStyle(() => ({
    opacity: (1 - ring1.value) * 0.35,
    transform: [{ scale: 1 + ring1.value * 0.7 }],
  }));
  const ring2Style = useAnimatedStyle(() => ({
    opacity: (1 - ring2.value) * 0.35,
    transform: [{ scale: 1 + ring2.value * 0.7 }],
  }));

  return (
    <View style={pulseStyles.wrap}>
      <Animated.View
        pointerEvents="none"
        style={[pulseStyles.ring, { backgroundColor: colors.danger }, ring1Style]}
      />
      <Animated.View
        pointerEvents="none"
        style={[pulseStyles.ring, { backgroundColor: colors.danger }, ring2Style]}
      />
      <AnimatedPressable
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={busy ? labels.busy : inSession ? labels.stop : labels.start}
        accessibilityState={{ disabled, busy }}
        scaleTo={0.94}
        haptic="none"
        onPress={onPress}
        style={[
          pulseStyles.button,
          {
            backgroundColor: inSession ? colors.danger : colors.card,
            borderColor: inSession ? colors.danger : colors.border,
            opacity: disabled ? 0.45 : 1,
          },
        ]}
      >
        {busy ? <ActivityIndicator size="large" color={colors.danger} /> : (
          <Ionicons name={inSession ? 'stop' : 'mic'} size={44} color={inSession ? colors.onAccent : colors.danger} />
        )}
      </AnimatedPressable>
    </View>
  );
}

const pulseStyles = StyleSheet.create({
  wrap: {
    width: RECORD_SIZE + 40,
    height: RECORD_SIZE + 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: RECORD_SIZE,
    height: RECORD_SIZE,
    borderRadius: RECORD_SIZE / 2,
  },
  button: {
    width: RECORD_SIZE,
    height: RECORD_SIZE,
    borderRadius: RECORD_SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.md,
  },
});

// Centre bars react most, giving the meter a natural spectrum-ish shape.
const WAVE_BAR_WEIGHTS = [0.35, 0.62, 0.85, 1, 0.85, 0.62, 0.35];
const WAVE_BAR_MIN_HEIGHT = 6;
const WAVE_BAR_RANGE = 28;
// Speech RMS sits well below 1.0, so the raw level needs scaling up before
// it maps onto a full-height bar.
const WAVE_LEVEL_GAIN = 7;

function Waveform({ level, colors }: { level: SharedValue<number>; colors: typeof Colors.light }) {
  // The level updates at ~10Hz (one buffer per 100ms); easing between those
  // steps on the UI thread is what makes it read as a smooth meter rather
  // than a strobe.
  const smoothed = useDerivedValue(() =>
    withTiming(Math.min(1, level.value * WAVE_LEVEL_GAIN), { duration: 120 })
  );

  return (
    <View style={waveStyles.row}>
      {WAVE_BAR_WEIGHTS.map((weight, i) => (
        <WaveBar key={i} weight={weight} level={smoothed} colors={colors} />
      ))}
    </View>
  );
}

function WaveBar({
  weight,
  level,
  colors,
}: {
  weight: number;
  level: SharedValue<number>;
  colors: typeof Colors.light;
}) {
  const style = useAnimatedStyle(() => ({
    height: WAVE_BAR_MIN_HEIGHT + level.value * weight * WAVE_BAR_RANGE,
  }));

  return <Animated.View style={[waveStyles.bar, { backgroundColor: colors.tint }, style]} />;
}

const waveStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, marginTop: Spacing.sm },
  bar: { width: 5, borderRadius: 3 },
});

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: Spacing.lg },
    languageChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.surface,
      borderRadius: Radius.pill,
      paddingHorizontal: Spacing.md,
      minHeight: 36,
      maxWidth: 170,
      marginTop: 4,
    },
    languageChipText: { fontSize: FontSize.sm, fontWeight: '700', color: colors.text, flexShrink: 1 },
    loadingContainer: { flex: 1, justifyContent: 'center' },
    loadingCard: { alignItems: 'center', paddingVertical: Spacing.xxl },
    loadingText: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginBottom: Spacing.sm },
    progressText: { fontSize: FontSize.xxl, fontWeight: '800', color: colors.tint, marginBottom: Spacing.lg },
    loadingIcon: { marginBottom: Spacing.md },
    loadingNote: { fontSize: FontSize.sm, color: colors.textMuted, textAlign: 'center', marginTop: Spacing.lg },
    loadingReason: { fontSize: FontSize.xs, color: colors.textMuted, textAlign: 'center', marginTop: Spacing.md, opacity: 0.8 },
    retryButton: { marginTop: Spacing.xl, alignSelf: 'stretch' },
    progressTrack: {
      width: '100%',
      height: 8,
      backgroundColor: colors.surface,
      borderRadius: Radius.pill,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', backgroundColor: colors.tint, borderRadius: Radius.pill },
    recordButtonContainer: { alignItems: 'center', marginBottom: Spacing.lg },
    harnessButton: { marginTop: Spacing.md, alignSelf: 'center' },
    pauseButton: { marginTop: Spacing.md, alignSelf: 'center', minWidth: 148, minHeight: 48 },
    // Same height as the waveform it replaces, so pausing doesn't shift the layout.
    pausedText: {
      height: 36,
      lineHeight: 36,
      marginTop: Spacing.sm,
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.textMuted,
    },
    recordButtonText: { fontSize: FontSize.md, fontWeight: '600', color: colors.textMuted, marginTop: Spacing.sm },
    elapsedText: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.danger,
      marginTop: Spacing.sm,
      fontVariant: ['tabular-nums'],
    },
    transcriptionCard: { flex: 1 },
    transcriptionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.md,
    },
    transcriptionLabel: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    wordCount: { fontSize: FontSize.xs, fontWeight: '600', color: colors.textMuted },
    transcriptionScroll: { flex: 1 },
    transcriptionText: { fontSize: FontSize.lg, lineHeight: 27 },
    committedText: { color: colors.text, fontWeight: '600' },
    nonCommittedText: { color: colors.textMuted, fontStyle: 'italic' },
    waitingText: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      textAlign: 'center',
      fontStyle: 'italic',
      paddingVertical: Spacing.xl,
    },
    languageHint: { fontSize: FontSize.xs, color: colors.textMuted, marginTop: Spacing.sm, textAlign: 'center' },
    actionButtons: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
    saveButton: { flex: 1 },
    resetButton: { flex: 1 },
  });
}
