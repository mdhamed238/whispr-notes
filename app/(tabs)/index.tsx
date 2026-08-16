/**
 * Record Screen
 * Streaming transcription via react-native-executorch, with a real audio
 * file captured alongside the stream (for playback from the Notes screens).
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
import { computeDurationSeconds, encodeWavBase64 } from '@/services/wavEncoder';
import { Note } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AudioManager, AudioRecorder } from 'react-native-audio-api';
import { useSpeechToText, WHISPER_TINY_EN } from 'react-native-executorch';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import AnimatedPressable from '@/components/ui/AnimatedPressable';

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

export default function RecordScreen() {
  // Bug fix: the old Reset button had no way to clear the model hook's
  // internal committedTranscription (no reset/clear API is exposed by
  // useSpeechToText). Remounting the whole session subtree on a fresh key
  // guarantees a clean AudioRecorder + model instance instead of relying on
  // undocumented internals — this also means each session gets its own
  // onAudioReady registration, so nothing accumulates across sessions.
  const [sessionId, setSessionId] = useState(0);
  return <RecordingSession key={sessionId} onSessionReset={() => setSessionId((n) => n + 1)} />;
}

function RecordingSession({ onSessionReset }: { onSessionReset: () => void }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = createStyles(colors);
  const router = useRouter();

  const [recorder] = useState(
    () =>
      new AudioRecorder({
        sampleRate: AUDIO_CONFIG.sampleRate,
        bufferLengthInSamples: AUDIO_CONFIG.sampleRate * 0.1,
      })
  );

  const model = useSpeechToText({ model: WHISPER_TINY_EN });

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

  // The installed react-native-audio-api has no file-output API, so we
  // accumulate the same raw PCM samples already streamed into the model
  // and encode them into a real WAV file ourselves on stop.
  const samplesRef = useRef<number[]>([]);

  const [captured, setCaptured] = useState<{ audioUri: string | null; duration: number }>({
    audioUri: null,
    duration: 0,
  });
  const [isSaving, setIsSaving] = useState(false);
  // Bug fix: handleStopStreaming is async (it encodes + writes the WAV to
  // disk) but nothing used to disable Save while that was in flight. The
  // render condition that shows Save only checked `!model.isGenerating`,
  // which flips true the instant streamStop() runs, well before the WAV
  // finishes writing — tapping Save in that window silently produced a
  // text-only note even though a real recording was made.
  const [isCapturingAudio, setIsCapturingAudio] = useState(false);

  // Safety cap: samplesRef accumulates every sample with no limit and the
  // WAV encode on stop is fully synchronous, so an unbounded recording
  // risks a long UI freeze. This timer force-stops recording once the cap
  // is hit.
  const maxDurationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (maxDurationTimer.current) {
        clearTimeout(maxDurationTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'spokenAudio',
      iosOptions: ['allowBluetooth', 'defaultToSpeaker'],
    });

    recorder.onAudioReady(async ({ buffer }) => {
      try {
        const bufferArray = Array.from(buffer.getChannelData(0));
        samplesRef.current.push(...bufferArray);
        modelRef.current.streamInsert(bufferArray);
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

      samplesRef.current = [];
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
        await model.stream();
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
      Alert.alert('Error', ERROR_MESSAGES.RECORDING_FAILED);
    }
  };

  const handleStopStreaming = async () => {
    // Bug fix: gate Save on this flag (see the isCapturingAudio comment
    // above) so a tap that lands between streamStop() and the WAV finishing
    // its write can't save a text-only note out from under a real recording.
    setIsCapturingAudio(true);
    try {
      recorder.stop();
      model.streamStop();

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

      // Bug fix: audioUri/duration used to be hardcoded ('streaming_recording'
      // and 0) on every save. Now they come from a real WAV file encoded from
      // the same PCM samples fed to the model (see services/wavEncoder.ts).
      const sampleCount = samplesRef.current.length;
      if (sampleCount > 0) {
        const wavBase64 = encodeWavBase64(samplesRef.current, AUDIO_CONFIG.sampleRate);
        const audioDir = `${FileSystem.documentDirectory}audio/`;
        const dirInfo = await FileSystem.getInfoAsync(audioDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(audioDir, { intermediates: true });
        }
        const fileUri = `${audioDir}note-${Date.now()}.wav`;
        await FileSystem.writeAsStringAsync(fileUri, wavBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setCaptured({
          audioUri: fileUri,
          duration: computeDurationSeconds(sampleCount, AUDIO_CONFIG.sampleRate),
        });
      } else {
        setCaptured({ audioUri: null, duration: 0 });
      }

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      console.error('Failed to stop streaming:', error);
    } finally {
      setIsCapturingAudio(false);
    }
  };

  const handleSaveTranscription = async () => {
    if (!model.committedTranscription) {
      Alert.alert('No Transcription', 'Nothing to save. Try recording some speech first.');
      return;
    }

    setIsSaving(true);
    try {
      const now = new Date();
      const note: Note = {
        id: now.getTime().toString(),
        title: buildAutoTitle(model.committedTranscription),
        transcription: model.committedTranscription,
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

  const downloadProgress = useSharedValue(0);
  useEffect(() => {
    downloadProgress.value = withTiming(model.downloadProgress, { duration: 300 });
  }, [model.downloadProgress, downloadProgress]);
  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${Math.min(downloadProgress.value, 1) * 100}%`,
  }));

  const hasTranscript = Boolean(model.committedTranscription || model.nonCommittedTranscription);

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
              <Text style={styles.recordButtonText}>
                {model.isGenerating ? 'Recording…' : 'Tap to start recording'}
              </Text>
              {model.isGenerating && <Waveform colors={colors} />}
            </View>

            <Card style={styles.transcriptionCard} elevation="sm">
              <Text style={styles.transcriptionLabel}>{model.isGenerating ? 'Listening…' : 'Transcription'}</Text>

              <ScrollView style={styles.transcriptionScroll} showsVerticalScrollIndicator={false}>
                {hasTranscript ? (
                  <Text style={styles.transcriptionText}>
                    <Text style={styles.committedText}>{model.committedTranscription}</Text>
                    {model.nonCommittedTranscription && (
                      <Text style={styles.nonCommittedText}> {model.nonCommittedTranscription}</Text>
                    )}
                  </Text>
                ) : (
                  <Text style={styles.waitingText}>
                    {model.isGenerating ? 'Speak now…' : 'Tap the microphone to start recording'}
                  </Text>
                )}
              </ScrollView>

              {hasTranscript && !model.isGenerating && (
                <View style={styles.actionButtons}>
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
                </View>
              )}
            </Card>
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
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

const WAVE_BAR_COUNT = 5;

function Waveform({ colors }: { colors: typeof Colors.light }) {
  return (
    <View style={waveStyles.row}>
      {Array.from({ length: WAVE_BAR_COUNT }).map((_, i) => (
        <WaveBar key={i} index={i} colors={colors} />
      ))}
    </View>
  );
}

function WaveBar({ index, colors }: { index: number; colors: typeof Colors.light }) {
  const height = useSharedValue(8);

  useEffect(() => {
    const target = 14 + ((index * 7) % 18);
    height.value = withDelay(
      index * 90,
      withRepeat(withSequence(withTiming(target, { duration: 380 }), withTiming(8, { duration: 380 })), -1, true)
    );
  }, [height, index]);

  const style = useAnimatedStyle(() => ({ height: height.value }));

  return <Animated.View style={[waveStyles.bar, { backgroundColor: colors.tint }, style]} />;
}

const waveStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 32, marginTop: Spacing.md },
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
    recordButtonContainer: { alignItems: 'center', marginBottom: Spacing.xl },
    recordButtonText: { fontSize: FontSize.md, fontWeight: '600', color: colors.textMuted, marginTop: Spacing.sm },
    transcriptionCard: { flex: 1 },
    transcriptionLabel: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: Spacing.md,
      textAlign: 'center',
    },
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
