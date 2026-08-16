/**
 * Notes Screen
 * Search, pinned section, and card list of saved notes.
 */

import AnimatedPressable from '@/components/ui/AnimatedPressable';
import Chip from '@/components/ui/Chip';
import EmptyState from '@/components/ui/EmptyState';
import IconButton from '@/components/ui/IconButton';
import ScreenHeader from '@/components/ui/ScreenHeader';
import Skeleton from '@/components/ui/Skeleton';
import TextField from '@/components/ui/TextField';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius, Shadow } from '@/constants/theme';
import storageService from '@/services/storageService';
import { Note } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
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
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  const renderNoteCard = (note: Note, index: number) => (
    <AnimatedPressable
      key={note.id}
      entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(320)}
      haptic="selection"
      style={styles.card}
      onPress={() => router.push(`/note/${note.id}`)}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          {note.pinned && (
            <View style={styles.pinBadge}>
              <Ionicons name="bookmark" size={11} color={colors.tint} />
            </View>
          )}
          <Text style={styles.cardTitle} numberOfLines={1}>
            {note.title}
          </Text>
        </View>
        <IconButton
          name="ellipsis-horizontal"
          size={16}
          background={colors.surface}
          onPress={() => handleOpenActions(note)}
        />
      </View>
      <Text style={styles.cardSnippet} numberOfLines={2}>
        {note.transcription || 'No transcription text'}
      </Text>
      <View style={styles.cardMeta}>
        <View style={styles.metaLeft}>
          <Chip label={formatDuration(note.duration)} tone="muted" />
          <Text style={styles.metaText}>{formatRelativeTime(note.createdAt)}</Text>
        </View>
        {note.tags.length > 0 && (
          <View style={styles.tagRow}>
            {note.tags.slice(0, 2).map((tag) => (
              <Chip key={tag} label={tag} tone="tint" />
            ))}
            {note.tags.length > 2 && <Text style={styles.metaText}>+{note.tags.length - 2}</Text>}
          </View>
        )}
      </View>
    </AnimatedPressable>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={styles.header}>
        <ScreenHeader title="Notes" subtitle={`${notes.length} note${notes.length === 1 ? '' : 's'} saved`} />

        <TextField
          icon="search"
          placeholder="Search notes, tags…"
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          autoCapitalize="none"
          autoCorrect={false}
          containerStyle={styles.searchField}
        />
      </View>

      {loading ? (
        <View style={styles.list}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={styles.skeletonCard}>
              <Skeleton width="55%" height={16} />
              <Skeleton width="90%" height={12} style={{ marginTop: Spacing.md }} />
              <Skeleton width="35%" height={12} style={{ marginTop: Spacing.sm }} />
            </View>
          ))}
        </View>
      ) : filteredNotes.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title={query ? 'No matching notes' : 'No notes yet'}
          subtitle={query ? 'Try a different search term.' : 'Record and save your first note to see it here.'}
        />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
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
    header: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg },
    searchField: { marginBottom: Spacing.lg },
    scroll: { flex: 1 },
    list: { paddingHorizontal: Spacing.xl, paddingBottom: 128 },
    sectionLabel: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: Spacing.sm,
      marginTop: Spacing.xs,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: Radius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
      ...Shadow.sm,
    },
    skeletonCard: {
      backgroundColor: colors.card,
      borderRadius: Radius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
      ...Shadow.sm,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginRight: Spacing.sm },
    pinBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: `${colors.tint}1A`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTitle: { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    cardSnippet: { fontSize: FontSize.sm, color: colors.textMuted, marginTop: Spacing.sm, lineHeight: 20 },
    cardMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: Spacing.md,
      gap: Spacing.sm,
    },
    metaLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    metaText: { fontSize: FontSize.sm, color: colors.textMuted },
    tagRow: { flexDirection: 'row', gap: Spacing.xs },
  });
}
