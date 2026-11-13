/**
 * Record Screen
 * Streaming transcription via react-native-executorch, with the raw audio
 * streamed to a real WAV file alongside it (for playback from the Notes
 * screens).
 */

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ScreenHeader from '@/components/ui/ScreenHeader';
import Skeleton from '@/components/ui/Skeleton';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import {
  AUDIO_CONFIG,
  CAPTURE_BUFFER_SECONDS,
  ERROR_MESSAGES,
  STREAMING_CONFIG,
  UI_CONFIG,
} from '@/constants/config';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius, Shadow } from '@/constants/theme';
import * as notesRepo from '@/services/db/notesRepo';
import * as enhanceQueue from '@/services/ai/enhanceQueue';
import { RecordingControls, type RecordingPhase } from '@/services/recordingControls';
import { consumeLiveTranscript } from '@/services/liveTranscription';
import { runHarness } from '@/services/transcriptionHarness';
import { WavFileWriter } from '@/services/wavEncoder';
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

function buildAutoTitle(transcription: string): string {
  const trimmed = transcription.trim();
  if (trimmed.length > 0) {
    return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
  }
  return `Note — ${new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

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

  // react-native-audio-api 0.13 moved buffer configuration off the
  // constructor and onto onAudioReady, so the recorder itself is now
  // parameterless and the capture format is declared at registration below.
  const [recorder] = useState(() => new AudioRecorder());

  // English-only export. The multilingual `whisper_base()` (EN/FR/AR via a
  // `language` option on stream()) was tried and reverted: it threw
  // "[Whisper] The 'decode' method did not succeed" on device. That is not a
  // bad download (the cached .pte is byte-exact against Hugging Face) nor a
  // tokenizer gap (<|en|>/<|fr|>/<|ar|> are all present in its 51,865-token
  // vocab), so the cause is still unknown. To re-enable once it's understood:
  // swap this to whisper_base(), pass `language` to stream() below, and
  // restore the language picker — note the library throws if `language` is
  // passed to a non-multilingual model, so those two must change together.
  const model = useSpeechToText({
    vad: STREAMING_CONFIG.USE_VAD ? models.vad.fsmn_vad() : undefined,
    model: models.speech_to_text.whisper_base_en(),
  });

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

  const [captured, setCaptured] = useState<{ audioUri: string | null; duration: number }>({
    audioUri: null,
    duration: 0,
  });
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [controls] = useState(() => new RecordingControls((next) => {
    if (mountedRef.current) setPhase(next);
  }));
  const streamTaskRef = useRef<Promise<string> | null>(null);
  const capturedUriRef = useRef<string | null>(null);

  // Dev-only fixture run (see services/transcriptionHarness).
  const [isRunningHarness, setIsRunningHarness] = useState(false);

  // Microphone state is independent of inference, which can still be
  // flushing its last words after capture has stopped.
  const isRecording = phase === 'recording';
  const isTransitioning = phase === 'starting' || phase === 'stopping';

  // Runaway guard: force-stops a recording left running by accident.
  const maxDurationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read through a ref by the once-registered interruption listener so it
  // always sees the current recording state.
  const interruptionHandlerRef = useRef<() => void>(() => {});

  const transcriptScrollRef = useRef<ScrollView>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (maxDurationTimer.current) {
        clearTimeout(maxDurationTimer.current);
      }
      // The session subtree is remounted on Reset/Save, so a writer still
      // open here belongs to a recording that will never be saved.
      writerRef.current?.discard();
      writerRef.current = null;
      modelRef.current.streamStop();
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

          const channelData = buffer.getChannelData(0);
          writerRef.current?.write(channelData);
          // A failed live preview must not prevent saving the source audio.
          try {
            modelRef.current.streamInsert(channelData);
          } catch (error) {
            console.warn('Live audio insert failed:', error);
          }

          let sumSquares = 0;
          for (let i = 0; i < channelData.length; i++) {
            sumSquares += channelData[i] * channelData[i];
          }
          audioLevel.value = Math.sqrt(sumSquares / channelData.length);
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

  const handleStartStreaming = async () => {
    if (controls.phase !== 'idle' || savingRef.current || isRunningHarness || !modelRef.current.isReady) return;
    try {
      const started = await controls.start(async () => {
        const permission = await AudioManager.requestRecordingPermissions();
        if (!mountedRef.current) return false;
        if (permission !== 'Granted') {
          Alert.alert('Permission Required', ERROR_MESSAGES.MICROPHONE_PERMISSION_DENIED);
          return false;
        }

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

        transcriptRef.current = { committed: '', nonCommitted: '' };
        setTranscript({ ...transcriptRef.current });
        stickToBottomRef.current = true;
        return true;
      });
      if (!started) {
        writerRef.current?.discard();
        writerRef.current = null;
        enhanceQueue.setRecordingActive(false);
        return;
      }

      maxDurationTimer.current = setTimeout(() => {
        maxDurationTimer.current = null;
        void handleStopStreaming();
        Alert.alert('Recording Stopped', 'Maximum recording length reached.');
      }, UI_CONFIG.MAX_RECORDING_DURATION_SECONDS * 1000);

      // Retain the task: streamStop requests a flush but does not await it.
      const task = consumeLiveTranscript(modelRef.current.stream({
        useVAD: STREAMING_CONFIG.USE_VAD,
        timeout: STREAMING_CONFIG.INFERENCE_TIMEOUT_MS,
        vadDetectionMargin: STREAMING_CONFIG.VAD_DETECTION_MARGIN_MS,
      }), (update) => {
        transcriptRef.current = update;
        if (mountedRef.current) setTranscript(update);
      });
      streamTaskRef.current = task;
      void task.then(() => {
        // Also finalize if the engine ends streaming on its own.
        if (mountedRef.current && controls.phase === 'recording') void handleStopStreaming();
      }, (error) => {
        console.error('Transcription error:', error);
        if (!mountedRef.current) return;
        void handleStopStreaming();
        toast.show({ message: 'Live preview failed. You can still save the audio for final transcription.', tone: 'error', durationMs: 6000 });
      });
    } catch (error) {
      console.error('Failed to start streaming:', error);
      writerRef.current?.discard();
      writerRef.current = null;
      enhanceQueue.setRecordingActive(false);
      if (mountedRef.current) Alert.alert('Error', ERROR_MESSAGES.RECORDING_FAILED);
    }
  };

  const handleStopStreaming = async () => {
    try {
      await controls.stop(async () => {
        if (maxDurationTimer.current) {
          clearTimeout(maxDurationTimer.current);
          maxDurationTimer.current = null;
        }
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
        modelRef.current.streamStop();
        audioLevel.value = 0;
        try {
          await streamTaskRef.current;
        } catch (error) {
          // The WAV remains useful even if inference fails.
          console.warn('Could not finish live transcript:', error);
        } finally {
          streamTaskRef.current = null;
          enhanceQueue.setRecordingActive(false);
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
            ? { audioUri: result.uri, duration: result.durationSeconds }
            : { audioUri: null, duration: 0 });
          void haptic('light');
        } else if (result) {
          await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
        }
      });
    } catch (error) {
      console.error('Failed to stop recording:', error);
      if (mountedRef.current) toast.show({ message: 'Could not stop recording. Please tap Stop again.', tone: 'error' });
    }
  };

  interruptionHandlerRef.current = () => {
    if (controls.phase !== 'recording') return;
    void handleStopStreaming().then(() => {
      if (!mountedRef.current || controls.phase !== 'idle') return;
      void haptic('warning');
      toast.show({ message: 'Recording stopped by an interruption. Save it or record again.', durationMs: 6000 });
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
      Alert.alert('No Recording', 'Nothing to save. Try recording some speech first.');
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    try {
      const now = new Date();
      const note: Note = {
        id: now.getTime().toString(),
        title: buildAutoTitle(text),
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
      Alert.alert('Error', 'Failed to save note');
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const confirmReset = () =>
    sheet.open({
      title: 'Discard this recording?',
      message: 'The audio and transcript will be deleted.',
      actions: [{ label: 'Discard recording', icon: 'trash-outline', destructive: true, onPress: () => void handleReset() }],
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={styles.content}>
        <ScreenHeader
          title="Record"
          subtitle={
            model.isReady
              ? 'Ready to transcribe'
              : model.downloadProgress > 0
                ? `Downloading model… ${Math.round(model.downloadProgress * 100)}%`
                : 'Loading AI model…'
          }
        />

        {!model.isReady ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.loadingContainer}>
            <Card style={styles.loadingCard} elevation="sm">
              <Text style={styles.loadingText}>Loading Whisper model…</Text>
              <Text style={styles.progressText}>{Math.round(model.downloadProgress * 100)}%</Text>
              <View style={styles.progressTrack}>
                <Animated.View style={[styles.progressFill, progressBarStyle]} />
              </View>
              <Skeleton width="88%" height={12} style={{ marginTop: Spacing.xl }} />
              <Skeleton width="62%" height={12} style={{ marginTop: Spacing.sm }} />
            </Card>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown.duration(400)} style={{ flex: 1 }}>
            <View style={styles.recordButtonContainer}>
              <PulseRecordButton
                isRecording={isRecording}
                busy={isTransitioning}
                disabled={!model.isReady || isSaving || isRunningHarness || isTransitioning}
                onPress={isRecording ? handleStopStreaming : handleStartStreaming}
                colors={colors}
              />
              <RecordingStatus
                isRecording={isRecording}
                phase={phase}
                level={audioLevel}
                colors={colors}
                styles={styles}
              />
              {__DEV__ && (
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
                  {isRecording ? 'Live preview · English' : phase === 'stopping' ? 'Finishing preview…' : 'Transcription'}
                </Text>
                {wordCount > 0 && (
                  <Text style={styles.wordCount}>
                    {wordCount} word{wordCount === 1 ? '' : 's'}
                  </Text>
                )}
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
                    <CommittedTranscript text={transcript.committed} style={styles.committedText} />
                    {transcript.nonCommitted && (
                      <Text style={styles.nonCommittedText}> {transcript.nonCommitted}</Text>
                    )}
                  </Text>
                ) : (
                  <Text style={styles.waitingText}>
                    {isRecording ? 'Speak now…' : 'Tap the microphone to start recording'}
                  </Text>
                )}
              </ScrollView>

              <Text style={styles.languageHint}>
                English live preview may change. Final transcription processes the saved audio again for accuracy.
              </Text>

              {(hasTranscript || captured.audioUri) && !isRecording && phase !== 'starting' && (
                <Animated.View entering={FadeIn.duration(200)} style={styles.actionButtons}>
                  <Button
                    label={
                      isSaving
                          ? 'Saving…'
                          : phase === 'stopping'
                            ? 'Finishing recording…'
                            : 'Save'
                    }
                    icon="checkmark-circle"
                    variant="primary"
                    loading={isSaving}
                    disabled={isSaving || phase !== 'idle' || isRunningHarness}
                    onPress={handleSaveTranscription}
                    haptic="none"
                    style={styles.saveButton}
                  />
                  <Button
                    label="Reset"
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
  phase,
  level,
  colors,
  styles,
}: {
  isRecording: boolean;
  phase: RecordingPhase;
  level: SharedValue<number>;
  colors: typeof Colors.light;
  styles: ReturnType<typeof createStyles>;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!isRecording) {
      setSeconds(0);
      return;
    }
    const startedAt = Date.now();
    // Derive from wall-clock rather than incrementing a counter, so the
    // display can't drift if a tick is delayed by inference work.
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(id);
  }, [isRecording]);

  if (!isRecording) {
    return <Text style={styles.recordButtonText} accessibilityLiveRegion="polite">
      {phase === 'starting' ? 'Starting recording…' : phase === 'stopping' ? 'Finishing recording…' : 'Tap to start recording'}
    </Text>;
  }

  return (
    <>
      <Text style={styles.elapsedText}>{formatClock(seconds)}</Text>
      <Waveform level={level} colors={colors} />
    </>
  );
}

const RECORD_SIZE = 128;

function PulseRecordButton({
  isRecording,
  busy = false,
  disabled,
  onPress,
  colors,
}: {
  isRecording: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
  colors: typeof Colors.light;
}) {
  const ring1 = useSharedValue(0);
  const ring2 = useSharedValue(0);

  useEffect(() => {
    if (isRecording) {
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
  }, [isRecording, ring1, ring2]);

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
        accessibilityLabel={busy ? 'Processing recording' : isRecording ? 'Stop recording' : 'Start recording'}
        accessibilityState={{ disabled, busy }}
        scaleTo={0.94}
        haptic="none"
        onPress={onPress}
        style={[
          pulseStyles.button,
          {
            backgroundColor: isRecording ? colors.danger : colors.card,
            borderColor: isRecording ? colors.danger : colors.border,
            opacity: disabled ? 0.45 : 1,
          },
        ]}
      >
        {busy ? <ActivityIndicator size="large" color={colors.danger} /> : (
          <Ionicons name={isRecording ? 'stop' : 'mic'} size={44} color={isRecording ? colors.onAccent : colors.danger} />
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
    content: { flex: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: 128 },
    loadingContainer: { flex: 1, justifyContent: 'center' },
    loadingCard: { alignItems: 'center', paddingVertical: Spacing.xxl },
    loadingText: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginBottom: Spacing.sm },
    progressText: { fontSize: FontSize.xxl, fontWeight: '800', color: colors.tint, marginBottom: Spacing.lg },
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
