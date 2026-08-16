/**
 * Note Detail Screen
 * View/edit a single note: title, transcript, tags, pin, playback, export, delete.
 */

import AnimatedPressable from '@/components/ui/AnimatedPressable';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import IconButton from '@/components/ui/IconButton';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import storageService from '@/services/storageService';
import { Note } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

const AUTOSAVE_DELAY_MS = 800;
const WAVE_BAR_COUNT = 32;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [transcription, setTranscription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [pinned, setPinned] = useState(false);

  // Bug fix: the title and transcript fields used to share one debounce
  // timer keyed to whichever field changed last — editing the title, then
  // switching to the transcript within 800ms, silently cancelled the
  // title's pending save with no way to recover it. This ref always holds
  // the latest values of BOTH fields, and every autosave (scheduled or
  // flushed) persists both together, so no edit is ever dropped by
  // switching fields.
  const latestFieldsRef = useRef({ title, transcription });
  latestFieldsRef.current = { title, transcription };

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const notes = await storageService.getNotes();
      const found = notes.find((n) => n.id === id) ?? null;
      if (!cancelled) {
        setNote(found);
        if (found) {
          setTitle(found.title);
          setTranscription(found.transcription);
          setTags(found.tags);
          setPinned(found.pinned);
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const persist = (updates: Partial<Note>) => {
    if (!id) return;
    storageService.updateNote(id, updates).catch((error) => {
      console.error('Failed to update note:', error);
    });
  };

  const flushPendingSave = () => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
      persist(latestFieldsRef.current);
    }
  };

  const scheduleAutosave = () => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
    }
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      persist(latestFieldsRef.current);
    }, AUTOSAVE_DELAY_MS);
  };

  // Bug fix: closing the modal via swipe-to-dismiss or the Android back
  // button used to skip the save entirely — only the chevron button's
  // onPress flushed a pending autosave. `beforeRemove` fires for every
  // dismissal path (button, swipe, hardware back), so this is now the one
  // place that guarantees a pending edit is saved before the screen goes
  // away, regardless of how the user leaves.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      flushPendingSave();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  // Safety net: flush on unmount too, in case the screen is ever torn down
  // through a path beforeRemove doesn't cover.
  useEffect(() => {
    return () => {
      flushPendingSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTitleChange = (text: string) => {
    setTitle(text);
    scheduleAutosave();
  };

  const handleTranscriptionChange = (text: string) => {
    setTranscription(text);
    scheduleAutosave();
  };

  const handleTogglePin = () => {
    const next = !pinned;
    setPinned(next);
    persist({ pinned: next });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleAddTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed || tags.includes(trimmed)) {
      setNewTag('');
      return;
    }
    const next = [...tags, trimmed];
    setTags(next);
    setNewTag('');
    persist({ tags: next });
  };

  const handleRemoveTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    persist({ tags: next });
  };

  const handleDelete = () => {
    Alert.alert('Delete Note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            // Cancel any pending autosave so it doesn't try to flush a
            // write against a note that's about to be (or just was) deleted.
            if (autosaveTimer.current) {
              clearTimeout(autosaveTimer.current);
              autosaveTimer.current = null;
            }
            if (id) await storageService.deleteNote(id);
            router.back();
          } catch (error) {
            console.error('Failed to delete note:', error);
            Alert.alert('Error', 'Failed to delete note');
          }
        },
      },
    ]);
  };

  const handleExport = async (format: 'txt' | 'json' | 'srt') => {
    if (!id) return;
    try {
      const fileUri = await storageService.exportNote(id, { format, includeMetadata: true });
      await storageService.shareExportedFile(fileUri);
    } catch (error) {
      console.error('Failed to export note:', error);
      Alert.alert('Error', 'Failed to export note');
    }
  };

  const handleExportPress = () => {
    Alert.alert('Export Note', undefined, [
      { text: 'Text (.txt)', onPress: () => handleExport('txt') },
      { text: 'JSON (.json)', onPress: () => handleExport('json') },
      { text: 'Subtitles (.srt)', onPress: () => handleExport('srt') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!note) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Note not found</Text>
          <AnimatedPressable haptic="selection" onPress={() => router.back()} style={{ marginTop: Spacing.lg }}>
            <Text style={{ color: colors.tint, fontWeight: '600' }}>Go back</Text>
          </AnimatedPressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <IconButton name="chevron-down" onPress={() => router.back()} background={colors.surface} />
        <IconButton
          name={pinned ? 'bookmark' : 'bookmark-outline'}
          color={colors.tint}
          background={pinned ? `${colors.tint}1A` : colors.surface}
          onPress={handleTogglePin}
        />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeIn.duration(300)}>
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={handleTitleChange}
            placeholder="Note title"
            placeholderTextColor={colors.textMuted}
            multiline
          />

          <Text style={styles.metaText}>
            {note.createdAt.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>

          {note.audioUri && <NotePlayer uri={note.audioUri} colors={colors} />}

          <View style={styles.tagSection}>
            {tags.length > 0 && (
              <View style={styles.tagRow}>
                {tags.map((tag) => (
                  <Chip key={tag} label={tag} tone="tint" onRemove={() => handleRemoveTag(tag)} />
                ))}
              </View>
            )}
            <View style={styles.addTagRow}>
              <TextInput
                style={styles.addTagInput}
                value={newTag}
                onChangeText={setNewTag}
                placeholder="Add tag"
                placeholderTextColor={colors.textMuted}
                onSubmitEditing={handleAddTag}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <IconButton name="add" size={18} color={colors.onAccent} background={colors.tint} onPress={handleAddTag} />
            </View>
          </View>

          <TextInput
            style={styles.transcriptionInput}
            value={transcription}
            onChangeText={handleTranscriptionChange}
            multiline
            textAlignVertical="top"
          />
        </Animated.View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <Button label="Export" icon="share-outline" variant="ghost" onPress={handleExportPress} style={styles.bottomButton} />
        <Button
          label="Delete"
          icon="trash-outline"
          variant="ghost-destructive"
          onPress={handleDelete}
          style={styles.bottomButton}
        />
      </View>
    </SafeAreaView>
  );
}

function NotePlayer({ uri, colors }: { uri: string; colors: typeof Colors.light }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  // useAudioPlayerStatus re-renders this component on every playback tick,
  // so building the stylesheet inline here re-ran StyleSheet.create several
  // times a second for the whole time a note was playing.
  const styles = useMemo(() => createStyles(colors), [colors]);
  const progress = useSharedValue(0);

  const bars = useMemo(
    () => Array.from({ length: WAVE_BAR_COUNT }, (_, i) => 6 + Math.round(Math.abs(Math.sin(i * 1.8)) * 20)),
    []
  );

  // Bug fix: without this, pressing play again after a note finishes
  // appeared to do nothing — the player was left parked at the end.
  useEffect(() => {
    if (status.didJustFinish) {
      player.seekTo(0);
    }
  }, [status.didJustFinish, player]);

  useEffect(() => {
    const ratio = status.duration ? status.currentTime / status.duration : 0;
    progress.value = withTiming(Math.min(Math.max(ratio, 0), 1), { duration: 150 });
  }, [status.currentTime, status.duration, progress]);

  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <Card style={styles.playerCard}>
      <View style={styles.playerRow}>
        <AnimatedPressable
          haptic="light"
          onPress={() => (status.playing ? player.pause() : player.play())}
          style={[styles.playButton, { backgroundColor: colors.tint }]}
        >
          <Ionicons name={status.playing ? 'pause' : 'play'} size={20} color={colors.onAccent} />
        </AnimatedPressable>

        <View style={{ flex: 1 }}>
          <View style={styles.waveWrap}>
            <View style={styles.waveRow}>
              {bars.map((h, i) => (
                <View key={i} style={[styles.waveBar, { height: h, backgroundColor: colors.border }]} />
              ))}
            </View>
            <Animated.View
              pointerEvents="none"
              style={[styles.waveProgressOverlay, progressStyle, { backgroundColor: colors.tint }]}
            />
          </View>
          <Text style={styles.playerTime}>
            {formatTime(status.currentTime)} / {formatTime(status.duration ?? 0)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
    },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: Spacing.xl },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { color: colors.textMuted, fontSize: FontSize.md },
    titleInput: { fontSize: FontSize.xl, fontWeight: '800', color: colors.text, paddingVertical: Spacing.xs },
    metaText: { fontSize: FontSize.sm, color: colors.textMuted, marginBottom: Spacing.lg },
    playerCard: { marginBottom: Spacing.lg },
    playerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    playButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    waveWrap: {
      height: 32,
      justifyContent: 'center',
      overflow: 'hidden',
      borderRadius: Radius.sm,
    },
    waveRow: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 32 },
    waveBar: { width: 3, borderRadius: 2 },
    waveProgressOverlay: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      opacity: 0.16,
    },
    playerTime: { fontSize: FontSize.sm, color: colors.textMuted, marginTop: Spacing.xs },
    tagSection: { marginBottom: Spacing.lg },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
    addTagRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    addTagInput: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      color: colors.text,
      fontSize: FontSize.md,
    },
    transcriptionInput: {
      fontSize: FontSize.md,
      lineHeight: 24,
      color: colors.text,
      minHeight: 200,
      paddingBottom: Spacing.xxl,
    },
    bottomBar: {
      flexDirection: 'row',
      gap: Spacing.md,
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.lg,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    bottomButton: { flex: 1 },
  });
}
