/**
 * Record Screen
 * Streaming transcription via react-native-executorch, with a real audio
 * file captured alongside the stream (for playback from the Notes screens).
 */

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { AUDIO_CONFIG, ERROR_MESSAGES, UI_CONFIG } from '@/constants/config';
import { FontSize, Spacing } from '@/constants/Spacing';
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
  TouchableOpacity,
  View,
} from 'react-native';
import { AudioManager, AudioRecorder } from 'react-native-audio-api';
import { useSpeechToText, WHISPER_TINY_EN } from 'react-native-executorch';
import { SafeAreaView } from 'react-native-safe-area-context';

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
        model.streamInsert(bufferArray);
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
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      onSessionReset();
      router.push('/notes');
    } catch (error) {
      console.error('Failed to save note:', error);
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Record</Text>
          <Text style={styles.subtitle}>
            {model.isReady
              ? 'Ready to transcribe'
              : model.downloadProgress > 0
                ? `Downloading model… ${Math.round(model.downloadProgress * 100)}%`
                : 'Loading AI model…'}
          </Text>
        </View>

        {!model.isReady ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading Whisper model…</Text>
            <Text style={styles.progressText}>{Math.round(model.downloadProgress * 100)}%</Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${model.downloadProgress * 100}%` }]} />
            </View>
          </View>
        ) : (
          <>
            <View style={styles.recordButtonContainer}>
              <TouchableOpacity
                style={[styles.recordButton, model.isGenerating && styles.recordButtonRecording]}
                onPress={model.isGenerating ? handleStopStreaming : handleStartStreaming}
                disabled={!model.isReady || isSaving}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={model.isGenerating ? 'stop' : 'mic'}
                  size={56}
                  color={model.isGenerating ? colors.onAccent : colors.danger}
                />
              </TouchableOpacity>
              <Text style={styles.recordButtonText}>
                {model.isGenerating ? 'Stop Recording' : 'Start Recording'}
              </Text>
            </View>

            <View style={styles.transcriptionContainer}>
              <Text style={styles.transcriptionLabel}>
                {model.isGenerating ? 'Listening…' : 'Transcription'}
              </Text>

              <ScrollView style={styles.transcriptionScroll}>
                {model.committedTranscription || model.nonCommittedTranscription ? (
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

              {(model.committedTranscription || model.nonCommittedTranscription) && !model.isGenerating && (
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={styles.saveButton}
                    onPress={handleSaveTranscription}
                    disabled={isSaving || isCapturingAudio}
                  >
                    <Ionicons name="save" size={20} color={colors.onAccent} />
                    <Text style={styles.saveButtonText}>
                      {isSaving ? 'Saving…' : isCapturingAudio ? 'Processing audio…' : 'Save'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.resetButton}
                    onPress={handleReset}
                    disabled={isSaving || isCapturingAudio}
                  >
                    <Ionicons name="refresh" size={20} color={colors.textMuted} />
                    <Text style={styles.resetButtonText}>Reset</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xl },
    header: { alignItems: 'center', marginBottom: Spacing.xxl },
    title: { fontSize: FontSize.xl, fontWeight: 'bold', color: colors.text, marginBottom: Spacing.xs },
    subtitle: { fontSize: FontSize.md, color: colors.textMuted, textAlign: 'center' },
    loadingContainer: { alignItems: 'center', justifyContent: 'center', flex: 1 },
    loadingText: { fontSize: FontSize.lg, fontWeight: '600', color: colors.text, marginBottom: Spacing.lg },
    progressText: { fontSize: FontSize.xl, fontWeight: 'bold', color: colors.tint, marginBottom: Spacing.lg },
    progressBar: { width: '80%', height: 8, backgroundColor: colors.surface, borderRadius: 4 },
    progressFill: { height: '100%', backgroundColor: colors.tint, borderRadius: 4 },
    recordButtonContainer: { alignItems: 'center', marginBottom: Spacing.xxl },
    recordButton: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: colors.background,
      borderWidth: 4,
      borderColor: colors.danger,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      marginBottom: Spacing.md,
    },
    recordButtonRecording: { backgroundColor: colors.danger, borderColor: colors.danger },
    recordButtonText: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    transcriptionContainer: { backgroundColor: colors.surface, padding: Spacing.lg, borderRadius: 12, flex: 1 },
    transcriptionLabel: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.text,
      marginBottom: Spacing.md,
      textAlign: 'center',
    },
    transcriptionScroll: { flex: 1 },
    transcriptionText: { fontSize: FontSize.lg, lineHeight: 26 },
    committedText: { color: colors.text, fontWeight: '600' },
    nonCommittedText: { color: colors.textMuted, fontStyle: 'italic' },
    waitingText: { fontSize: FontSize.md, color: colors.textMuted, textAlign: 'center', fontStyle: 'italic' },
    actionButtons: { flexDirection: 'row', justifyContent: 'space-around', marginTop: Spacing.lg },
    saveButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.success,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      borderRadius: 8,
      flex: 1,
      marginRight: Spacing.sm,
    },
    saveButtonText: { color: colors.onAccent, fontSize: FontSize.md, fontWeight: '600', marginLeft: Spacing.sm },
    resetButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      borderRadius: 8,
      flex: 1,
      marginLeft: Spacing.sm,
    },
    resetButtonText: { color: colors.textMuted, fontSize: FontSize.md, fontWeight: '600', marginLeft: Spacing.sm },
  });
}
