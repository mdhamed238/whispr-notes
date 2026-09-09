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
  TIMELINE_CONFIG,
  UI_CONFIG,
} from '@/constants/config';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius, Shadow } from '@/constants/theme';
import storageService from '@/services/storageService';
import { saveTimeline } from '@/services/timelineStore';
import { runHarness } from '@/services/transcriptionHarness';
import { buildTimeline } from '@/services/transcriptionTimeline';
import { WavFileWriter } from '@/services/wavEncoder';
import { Note } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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

  // react-native-audio-api 0.13 moved buffer configuration off the
  // constructor and onto onAudioReady, so the recorder itself is now
  // parameterless and the capture format is declared at registration below.
  const [recorder] = useState(() => new AudioRecorder());

  // VAD-gated streaming (added in v0.9.0) commits text once a short silence
  // is detected instead of endlessly re-transcribing a growing buffer on
  // every iteration — this is what actually cuts the multi-second commit
  // lag down, not just the library bump itself.
  //
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
    vad: models.vad.fsmn_vad(),
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
  // Bug fix: handleStopStreaming does async work (deleting a superseded
  // capture) but nothing used to disable Save while that was in flight. The
  // render condition that shows Save only checked `!model.isGenerating`,
  // which flips true the instant streamStop() runs — tapping Save in that
  // window could save a note out from under the real recording.
  const [isCapturingAudio, setIsCapturingAudio] = useState(false);
  // The post-save timestamp pass (see services/transcriptionTimeline.ts).
  // Held in a ref because two other paths must not run while it is in
  // flight: starting a new recording (transcribe() and stream() would
  // contend for the same model instance) and the session remount that
  // Save schedules (which would tear the model down mid-inference).
  const timelinePassRef = useRef<Promise<void> | null>(null);
  const [isFinishingTimeline, setIsFinishingTimeline] = useState(false);

  // Dev-only fixture run (see services/transcriptionHarness).
  const [isRunningHarness, setIsRunningHarness] = useState(false);

  // useSpeechToText raises `isGenerating` for transcribe() as well as
  // stream(), so during the post-save timeline pass — and during a harness
  // run, which drives both — the model reports itself as generating even
  // though nothing is being recorded. Without this the record button would
  // show its stop state and tapping it would call handleStopStreaming
  // against an inference that isn't a recording.
  const isRecording = model.isGenerating && !isFinishingTimeline && !isRunningHarness;

  // Runaway guard: force-stops a recording left running by accident.
  const maxDurationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bug fix: stop can be triggered from three places at once (the stop
  // button, the max-duration timer, and the stream error path). Without
  // this guard a double-stop could finalize the WAV twice and clobber the
  // freshly-captured file with a null result.
  const isStoppingRef = useRef(false);

  const transcriptScrollRef = useRef<ScrollView>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    return () => {
      if (maxDurationTimer.current) {
        clearTimeout(maxDurationTimer.current);
      }
      // The session subtree is remounted on Reset/Save, so a writer still
      // open here belongs to a recording that will never be saved.
      writerRef.current?.discard();
      writerRef.current = null;
    };
  }, []);

  useEffect(() => {
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'spokenAudio',
      // Renamed in react-native-audio-api 0.13 (was 'allowBluetooth').
      iosOptions: ['allowBluetoothHFP', 'defaultToSpeaker'],
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
          modelRef.current.streamInsert(channelData);
          writerRef.current?.write(channelData);

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

    // Registered once per session (see the remount-key comment above), not
    // re-registered on every Start press.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartStreaming = async () => {
    try {
      // Bug fix: this result was previously ignored — a denied permission
      // failed silently instead of telling the user anything.
      const permission = await AudioManager.requestRecordingPermissions();
      if (permission !== 'Granted') {
        Alert.alert('Permission Required', ERROR_MESSAGES.MICROPHONE_PERMISSION_DENIED);
        return;
      }

      // A timeline pass from the previous note may still hold the model.
      // It is short and already running, so waiting is preferable to
      // starting a stream that would contend with it.
      if (timelinePassRef.current) {
        await timelinePassRef.current;
      }

      transcriptRef.current = { committed: '', nonCommitted: '' };
      setTranscript({ committed: '', nonCommitted: '' });
      stickToBottomRef.current = true;
      isStoppingRef.current = false;

      // Any writer still open here is from a stop that failed partway; drop
      // its partial file rather than leaking it.
      writerRef.current?.discard();
      writerRef.current = WavFileWriter.create(AUDIO_CONFIG.sampleRate);

      // Fired *before* the microphone goes live, and awaited, so the motor
      // has run and settled before the first buffer is captured.
      //
      // This haptic is a physical vibration of the same device the
      // microphone is in, so ordering it after start() recorded the buzz
      // into the first ~100ms of every take — over the first word. The
      // damage is in the WAV itself, not just the live stream: a one-shot
      // transcribe() of a saved "Hi everyone" returns "Bye everyone", and
      // the streamed pass returns "Bye. (buzzer)" — `(buzzer)` being
      // Whisper's sound tag for exactly this kind of mechanical noise.
      //
      // It reached that position as a fix for the opposite bug: it used to
      // sit after `await model.stream()`, which doesn't resolve until
      // streaming *stops*, so the "start" haptic actually fired at stop time
      // (double-buzzing alongside handleStopStreaming's own) and start was
      // silent. Both constraints are satisfied here — before start(), not
      // after stream().
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // 0.13 made start() async and report failure through a Result instead
      // of throwing. Unchecked, a refused start would leave the model
      // streaming against a microphone that never delivers a buffer — an
      // app that looks like it is recording and silently produces nothing.
      const started = await recorder.start();
      if (started.status === 'error') {
        writerRef.current?.discard();
        writerRef.current = null;
        console.error('Failed to start recorder:', started.message);
        Alert.alert('Error', ERROR_MESSAGES.RECORDING_FAILED);
        return;
      }

      if (maxDurationTimer.current) {
        clearTimeout(maxDurationTimer.current);
      }
      maxDurationTimer.current = setTimeout(() => {
        maxDurationTimer.current = null;
        handleStopStreaming();
        Alert.alert('Recording Stopped', 'Maximum recording length reached.');
      }, UI_CONFIG.MAX_RECORDING_DURATION_SECONDS * 1000);

      try {
        // Both knobs live in STREAMING_CONFIG so the CPU/latency trade-off
        // can be profiled by editing one place. vadDetectionMargin is 300ms
        // (down from the library's 500ms): shorter silence gaps count as a
        // commit point, so continuous speech with only brief pauses still
        // gets incremental commits instead of holding everything as
        // non-committed until a long enough gap flushes it all at once.
        const streamIter = model.stream({
          useVAD: true,
          timeout: STREAMING_CONFIG.INFERENCE_TIMEOUT_MS,
          vadDetectionMargin: STREAMING_CONFIG.VAD_DETECTION_MARGIN_MS,
        });
        for await (const { committed, nonCommitted } of streamIter) {
          if (committed.text) {
            transcriptRef.current.committed += committed.text;
          }
          transcriptRef.current.nonCommitted = nonCommitted.text ?? '';
          setTranscript({ ...transcriptRef.current });
        }
      } catch (error) {
        console.error('Transcription error:', error);
        handleStopStreaming();

        if (error instanceof Error && error.message?.includes('BLANK')) {
          Alert.alert('No Speech Detected', 'Please speak clearly into the microphone.');
        } else {
          Alert.alert('Transcription Error', 'Failed to transcribe audio. Please try again.');
        }
      }
    } catch (error) {
      console.error('Failed to start streaming:', error);
      writerRef.current?.discard();
      writerRef.current = null;
      Alert.alert('Error', ERROR_MESSAGES.RECORDING_FAILED);
    }
  };

  const handleStopStreaming = async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    setIsCapturingAudio(true);
    try {
      // Awaited before the WAV is finalized below: stop() is async in 0.13,
      // and buffers already in flight are still delivered to onAudioReady
      // until it settles. Finalizing first would null the writer out from
      // under them and silently drop the tail of the recording.
      const stopped = await recorder.stop();
      if (stopped.status === 'error') {
        console.warn('Recorder stop reported an error:', stopped.message);
      }
      model.streamStop();
      audioLevel.value = 0;

      if (maxDurationTimer.current) {
        clearTimeout(maxDurationTimer.current);
        maxDurationTimer.current = null;
      }

      // Bug fix: a previously-captured-but-unsaved WAV from an earlier stop
      // in this same session would otherwise be silently orphaned on disk
      // the moment `captured` below is overwritten with the new file.
      if (captured.audioUri) {
        try {
          await FileSystem.deleteAsync(captured.audioUri, { idempotent: true });
        } catch (error) {
          console.warn('Failed to delete previous captured audio:', error);
        }
      }

      // Just a 44-byte header patch — the PCM was already written to disk
      // as it arrived, so there is no encode pass to block on here.
      const writer = writerRef.current;
      writerRef.current = null;
      const result = writer ? writer.finalize() : null;

      setCaptured(
        result
          ? { audioUri: result.uri, duration: result.durationSeconds }
          : { audioUri: null, duration: 0 }
      );

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      console.error('Failed to stop streaming:', error);
    } finally {
      setIsCapturingAudio(false);
      isStoppingRef.current = false;
    }
  };

  /**
   * Second, non-streaming pass over the saved WAV. Attaches word-level
   * timestamps and, when nothing has touched the note since Save, adopts
   * this pass's transcript over the streamed one.
   *
   * Deliberately fire-and-forget: the note is already saved and useful, so
   * a failure here costs only the timeline. The session remount is deferred
   * until this settles — remounting swaps in a fresh model instance and
   * would abort the in-flight transcribe().
   */
  const runTimelinePass = async (saved: Note) => {
    const audioUri = saved.audioUri;
    if (!audioUri || saved.duration > TIMELINE_CONFIG.MAX_DURATION_SECONDS) {
      onSessionReset();
      return;
    }

    setIsFinishingTimeline(true);
    const pass = (async () => {
      const timeline = await buildTimeline(modelRef.current, audioUri);
      if (!timeline) return;

      try {
        // Compare-and-swap: the user reaches the saved note while this is
        // still running, so only adopt the new text if nothing has touched
        // it since Save. An edit made in that window wins outright — and in
        // that case the timeline is dropped too, since it would describe
        // words the user has already replaced.
        const stored = (await storageService.getNotes()).find((n) => n.id === saved.id);
        const untouched =
          stored?.transcription === saved.transcription && stored?.title === saved.title;

        if (!untouched) return;

        // Timings go to a sidecar file rather than onto the note — see
        // services/timelineStore.ts for why.
        saveTimeline(saved.id, timeline.segments);

        // The pass's own text supersedes the streamed transcript. Streaming
        // decodes a rolling buffer that is silence-trimmed and dropped at
        // each commit point, so its weakest words sit at those boundaries;
        // this pass sees whole windows of the finished file and is the
        // better transcript. Taking it also keeps the stored text, the
        // timeline, listen mode and SRT in agreement.
        if (timeline.text) {
          await storageService.updateNote(saved.id, {
            transcription: timeline.text,
            // The title was derived from the streamed text at save time, so
            // it is regenerated from the same source as the text it now
            // summarizes.
            title: buildAutoTitle(timeline.text),
          });
        }
      } catch (error) {
        console.warn('Failed to attach transcript timeline to note:', error);
      }
    })();

    timelinePassRef.current = pass;
    try {
      await pass;
    } finally {
      timelinePassRef.current = null;
      setIsFinishingTimeline(false);
      onSessionReset();
    }
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
    if (!transcript.committed) {
      Alert.alert('No Transcription', 'Nothing to save. Try recording some speech first.');
      return;
    }

    setIsSaving(true);
    try {
      const now = new Date();
      const note: Note = {
        id: now.getTime().toString(),
        title: buildAutoTitle(transcript.committed),
        transcription: transcript.committed,
        audioUri: captured.audioUri,
        duration: captured.duration,
        tags: [],
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };

      await storageService.saveNote(note);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // The note is saved and the user moves on immediately — the timeline
      // is enrichment, not part of the save. It resolves onto the stored
      // note a few seconds later, and the note is perfectly usable without
      // it if the pass fails.
      router.push('/notes');
      void runTimelinePass(note);
    } catch (error) {
      console.error('Failed to save note:', error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to save note');
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (isRecording) {
      await handleStopStreaming();
    }
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
  const wordCount = useMemo(() => countWords(transcript.committed), [transcript.committed]);

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
                disabled={!model.isReady || isSaving || isFinishingTimeline}
                onPress={isRecording ? handleStopStreaming : handleStartStreaming}
                colors={colors}
              />
              <RecordingStatus
                isRecording={isRecording}
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
                  disabled={!model.isReady || isRecording || isRunningHarness || isFinishingTimeline}
                  onPress={handleRunHarness}
                  style={styles.harnessButton}
                />
              )}
            </View>

            <Card style={styles.transcriptionCard} elevation="sm">
              <View style={styles.transcriptionHeader}>
                <Text style={styles.transcriptionLabel}>
                  {isRecording ? 'Listening…' : 'Transcription'}
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

              {hasTranscript && !isRecording && (
                <Animated.View entering={FadeIn.duration(200)} style={styles.actionButtons}>
                  <Button
                    label={
                      isFinishingTimeline
                        ? 'Finishing…'
                        : isSaving
                          ? 'Saving…'
                          : isCapturingAudio
                            ? 'Processing audio…'
                            : 'Save'
                    }
                    icon="checkmark-circle"
                    variant="primary"
                    loading={isSaving || isFinishingTimeline}
                    disabled={isSaving || isCapturingAudio || isFinishingTimeline}
                    onPress={handleSaveTranscription}
                    haptic="none"
                    style={styles.saveButton}
                  />
                  <Button
                    label="Reset"
                    icon="refresh"
                    variant="secondary"
                    disabled={isSaving || isCapturingAudio || isFinishingTimeline}
                    onPress={handleReset}
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
  level,
  colors,
  styles,
}: {
  isRecording: boolean;
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
    return <Text style={styles.recordButtonText}>Tap to start recording</Text>;
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
  disabled,
  onPress,
  colors,
}: {
  isRecording: boolean;
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
        scaleTo={0.94}
        haptic="none"
        onPress={onPress}
        style={[
          pulseStyles.button,
          {
            backgroundColor: isRecording ? colors.danger : colors.card,
            borderColor: isRecording ? colors.danger : colors.border,
          },
        ]}
      >
        <Ionicons name={isRecording ? 'stop' : 'mic'} size={44} color={isRecording ? colors.onAccent : colors.danger} />
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
    actionButtons: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
    saveButton: { flex: 1 },
    resetButton: { flex: 1 },
  });
}
