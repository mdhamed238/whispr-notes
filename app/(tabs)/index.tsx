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
import { AUDIO_CONFIG, ERROR_MESSAGES, UI_CONFIG } from '@/constants/config';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius, Shadow } from '@/constants/theme';
import storageService from '@/services/storageService';
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
import { models, useSpeechToText } from 'react-native-executorch';
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

  const [recorder] = useState(
    () =>
      new AudioRecorder({
        sampleRate: AUDIO_CONFIG.sampleRate,
        bufferLengthInSamples: AUDIO_CONFIG.sampleRate * 0.1,
      })
  );

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
      iosOptions: ['allowBluetooth', 'defaultToSpeaker'],
    });

    recorder.onAudioReady(({ buffer }) => {
      try {
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
    });
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

      transcriptRef.current = { committed: '', nonCommitted: '' };
      setTranscript({ committed: '', nonCommitted: '' });
      stickToBottomRef.current = true;
      isStoppingRef.current = false;

      // Any writer still open here is from a stop that failed partway; drop
      // its partial file rather than leaking it.
      writerRef.current?.discard();
      writerRef.current = WavFileWriter.create(AUDIO_CONFIG.sampleRate);

      recorder.start();
      // Bug fix: this haptic used to fire after `await model.stream()`,
      // which doesn't resolve until streaming actually stops — so the
      // "start" haptic was actually firing at stop time (double-buzzing
      // alongside handleStopStreaming's own haptic), and start was silent.
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (maxDurationTimer.current) {
        clearTimeout(maxDurationTimer.current);
      }
      maxDurationTimer.current = setTimeout(() => {
        maxDurationTimer.current = null;
        handleStopStreaming();
        Alert.alert('Recording Stopped', 'Maximum recording length reached.');
      }, UI_CONFIG.MAX_RECORDING_DURATION_SECONDS * 1000);

      try {
        // 300ms (down from 500ms): shorter silence gaps count as a commit
        // point, so continuous speech with only brief pauses still gets
        // incremental commits instead of holding everything as
        // non-committed until a long enough gap flushes it all at once.
        const streamIter = model.stream({ useVAD: true, vadDetectionMargin: 300 });
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
      recorder.stop();
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

      onSessionReset();
      router.push('/notes');
    } catch (error) {
      console.error('Failed to save note:', error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to save note');
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (model.isGenerating) {
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
                isRecording={model.isGenerating}
                disabled={!model.isReady || isSaving}
                onPress={model.isGenerating ? handleStopStreaming : handleStartStreaming}
                colors={colors}
              />
              <RecordingStatus
                isRecording={model.isGenerating}
                level={audioLevel}
                colors={colors}
                styles={styles}
              />
            </View>

            <Card style={styles.transcriptionCard} elevation="sm">
              <View style={styles.transcriptionHeader}>
                <Text style={styles.transcriptionLabel}>
                  {model.isGenerating ? 'Listening…' : 'Transcription'}
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
                    {model.isGenerating ? 'Speak now…' : 'Tap the microphone to start recording'}
                  </Text>
                )}
              </ScrollView>

              {hasTranscript && !model.isGenerating && (
                <Animated.View entering={FadeIn.duration(200)} style={styles.actionButtons}>
                  <Button
                    label={isSaving ? 'Saving…' : isCapturingAudio ? 'Processing audio…' : 'Save'}
                    icon="checkmark-circle"
                    variant="primary"
                    loading={isSaving}
                    disabled={isSaving || isCapturingAudio}
                    onPress={handleSaveTranscription}
                    haptic="none"
                    style={styles.saveButton}
                  />
                  <Button
                    label="Reset"
                    icon="refresh"
                    variant="secondary"
                    disabled={isSaving || isCapturingAudio}
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
