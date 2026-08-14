/**
 * Notes Screen
 * Search, pinned section, and card list of saved notes.
 */

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import storageService from '@/services/storageService';
import { Note } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function NotesScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = createStyles(colors);
  const router = useRouter();

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const loadNotes = useCallback(async () => {
    try {
      setLoading(true);
      const items = await storageService.getNotes();
      setNotes(items);
    } catch (error) {
      console.error('Failed to load notes:', error);
      Alert.alert('Error', 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, []);

  // Bug fix: the old screen only loaded on mount, so a note saved from the
  // Record tab didn't show up here until the app restarted.
  useFocusEffect(
    useCallback(() => {
      loadNotes();
    }, [loadNotes])
  );

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(q) ||
        note.transcription.toLowerCase().includes(q) ||
        note.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [notes, query]);

  const pinnedNotes = useMemo(() => filteredNotes.filter((note) => note.pinned), [filteredNotes]);
  const otherNotes = useMemo(() => filteredNotes.filter((note) => !note.pinned), [filteredNotes]);

  const handleTogglePin = async (note: Note) => {
    try {
      await storageService.updateNote(note.id, { pinned: !note.pinned });
      loadNotes();
    } catch (error) {
      console.error('Failed to update note:', error);
      Alert.alert('Error', 'Failed to update note');
    }
  };

  const handleDelete = (note: Note) => {
    Alert.alert('Delete Note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await storageService.deleteNote(note.id);
            loadNotes();
          } catch (error) {
            console.error('Failed to delete note:', error);
            Alert.alert('Error', 'Failed to delete note');
          }
        },
      },
    ]);
  };

  const handleExport = async (note: Note) => {
    try {
      const fileUri = await storageService.exportNote(note.id, { format: 'txt', includeMetadata: true });
      await storageService.shareExportedFile(fileUri);
    } catch (error) {
      console.error('Failed to export note:', error);
      Alert.alert('Error', 'Failed to export note');
    }
  };

  const handleOpenActions = (note: Note) => {
    Alert.alert(note.title, undefined, [
      { text: note.pinned ? 'Unpin' : 'Pin', onPress: () => handleTogglePin(note) },
      { text: 'Export', onPress: () => handleExport(note) },
      { text: 'Delete', style: 'destructive', onPress: () => handleDelete(note) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const renderNoteCard = (note: Note) => (
    <TouchableOpacity
      key={note.id}
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => router.push(`/note/${note.id}`)}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {note.pinned ? '📌 ' : ''}
          {note.title}
        </Text>
        <TouchableOpacity onPress={() => handleOpenActions(note)} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      <Text style={styles.cardSnippet} numberOfLines={2}>
        {note.transcription || 'No transcription text'}
      </Text>
      <View style={styles.cardMeta}>
        <Text style={styles.metaText}>
          {formatDuration(note.duration)} • {formatRelativeTime(note.createdAt)}
        </Text>
        {note.tags.length > 0 && (
          <View style={styles.tagRow}>
            {note.tags.slice(0, 2).map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagChipText}>{tag}</Text>
              </View>
            ))}
            {note.tags.length > 2 && <Text style={styles.metaText}>+{note.tags.length - 2}</Text>}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search notes"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading notes…</Text>
        </View>
      ) : filteredNotes.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="document-text-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyStateTitle}>{query ? 'No matching notes' : 'No Notes Yet'}</Text>
          <Text style={styles.emptyStateText}>
            {query ? 'Try a different search term.' : 'Record and save your first note to see it here.'}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {pinnedNotes.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Pinned</Text>
              {pinnedNotes.map(renderNoteCard)}
              <Text style={[styles.sectionLabel, { marginTop: Spacing.lg }]}>All Notes</Text>
            </>
          )}
          {otherNotes.map(renderNoteCard)}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginHorizontal: Spacing.lg,
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: 10,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: FontSize.md },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { fontSize: FontSize.md, color: colors.textMuted },
    list: { flex: 1, paddingHorizontal: Spacing.lg },
    sectionLabel: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: Spacing.sm,
      marginTop: Spacing.xs,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: Spacing.md,
      marginBottom: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardTitle: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: colors.text, marginRight: Spacing.sm },
    cardSnippet: { fontSize: FontSize.sm, color: colors.textMuted, marginTop: Spacing.xs, lineHeight: 20 },
    cardMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
    metaText: { fontSize: FontSize.sm, color: colors.textMuted },
    tagRow: { flexDirection: 'row', gap: Spacing.xs },
    tagChip: { backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
    tagChipText: { fontSize: 11, color: colors.tint, fontWeight: '600' },
    emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xxl },
    emptyStateTitle: {
      fontSize: FontSize.lg,
      fontWeight: '600',
      color: colors.text,
      marginTop: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    emptyStateText: { fontSize: FontSize.md, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  });
}
