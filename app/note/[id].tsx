/**
 * Note Detail Screen
 * View/edit a single note: title, transcript, tags, pin, playback, export, delete.
 */

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import storageService from '@/services/storageService';
import { Note } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const AUTOSAVE_DELAY_MS = 800;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = createStyles(colors);

  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [transcription, setTranscription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [pinned, setPinned] = useState(false);

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

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
      }
    };
  }, []);

  const persist = (updates: Partial<Note>) => {
    if (!id) return;
    storageService.updateNote(id, updates).catch((error) => {
      console.error('Failed to update note:', error);
    });
  };

  const scheduleAutosave = (updates: Partial<Note>) => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
    }
    autosaveTimer.current = setTimeout(() => persist(updates), AUTOSAVE_DELAY_MS);
  };

  const handleTitleChange = (text: string) => {
    setTitle(text);
    scheduleAutosave({ title: text });
  };

  const handleTranscriptionChange = (text: string) => {
    setTranscription(text);
    scheduleAutosave({ transcription: text });
  };

  const handleTogglePin = () => {
    const next = !pinned;
    setPinned(next);
    persist({ pinned: next });
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

  const handleClose = () => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      persist({ title, transcription });
    }
    router.back();
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
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: Spacing.lg }}>
            <Text style={{ color: colors.tint }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleClose} hitSlop={8}>
          <Ionicons name="chevron-down" size={26} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleTogglePin} hitSlop={8}>
          <Ionicons name={pinned ? 'bookmark' : 'bookmark-outline'} size={22} color={colors.tint} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
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
          <View style={styles.tagRow}>
            {tags.map((tag) => (
              <TouchableOpacity key={tag} style={styles.tagChip} onPress={() => handleRemoveTag(tag)}>
                <Text style={styles.tagChipText}>{tag} ×</Text>
              </TouchableOpacity>
            ))}
          </View>
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
            <TouchableOpacity onPress={handleAddTag} style={styles.addTagButton}>
              <Ionicons name="add" size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>

        <TextInput
          style={styles.transcriptionInput}
          value={transcription}
          onChangeText={handleTranscriptionChange}
          multiline
          textAlignVertical="top"
        />
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.bottomButton} onPress={handleExportPress}>
          <Ionicons name="share-outline" size={20} color={colors.tint} />
          <Text style={[styles.bottomButtonText, { color: colors.tint }]}>Export</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomButton} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={20} color={colors.danger} />
          <Text style={[styles.bottomButtonText, { color: colors.danger }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function NotePlayer({ uri, colors }: { uri: string; colors: typeof Colors.light }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const styles = createStyles(colors);

  return (
    <View style={styles.playerRow}>
      <TouchableOpacity onPress={() => (status.playing ? player.pause() : player.play())}>
        <Ionicons name={status.playing ? 'pause-circle' : 'play-circle'} size={40} color={colors.tint} />
      </TouchableOpacity>
      <Text style={styles.metaText}>
        {formatTime(status.currentTime)} / {formatTime(status.duration ?? 0)}
      </Text>
    </View>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
    },
    scroll: { flex: 1, paddingHorizontal: Spacing.lg },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { color: colors.textMuted, fontSize: FontSize.md },
    titleInput: { fontSize: FontSize.xl, fontWeight: 'bold', color: colors.text, paddingVertical: Spacing.xs },
    metaText: { fontSize: FontSize.sm, color: colors.textMuted, marginBottom: Spacing.md },
    playerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    tagSection: { marginBottom: Spacing.md },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
    tagChip: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    tagChipText: { color: colors.tint, fontSize: FontSize.sm, fontWeight: '600' },
    addTagRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    addTagInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      color: colors.text,
    },
    addTagButton: {
      backgroundColor: colors.tint,
      borderRadius: 8,
      width: 32,
      height: 32,
      justifyContent: 'center',
      alignItems: 'center',
    },
    transcriptionInput: {
      fontSize: FontSize.md,
      lineHeight: 22,
      color: colors.text,
      minHeight: 200,
      paddingBottom: Spacing.xxl,
    },
    bottomBar: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingVertical: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    bottomButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    bottomButtonText: { fontSize: FontSize.md, fontWeight: '600' },
  });
}
