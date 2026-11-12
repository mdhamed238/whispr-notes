/**
 * Notes: full-text search, tag filter, sort, swipe to pin/delete with undo,
 * long-press menu. The list stays live while background work (enhanced
 * transcripts, summaries, imports) lands.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, SectionList, StatusBar, StyleSheet, Text, View } from 'react-native';
import { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActionSheet } from '@/components/ui/ActionSheet';
import AnimatedPressable from '@/components/ui/AnimatedPressable';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import EmptyState from '@/components/ui/EmptyState';
import IconButton from '@/components/ui/IconButton';
import ScreenHeader from '@/components/ui/ScreenHeader';
import Skeleton from '@/components/ui/Skeleton';
import SwipeableRow from '@/components/ui/SwipeableRow';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius, Shadow } from '@/constants/theme';
import { useNotes, useTags } from '@/hooks/useNotes';
import { usePro } from '@/hooks/usePro';
import * as notesRepo from '@/services/db/notesRepo';
import { ExportPanel } from '@/components/ExportSheet';
import { exportTextFile, shareFile } from '@/services/export/exporter';
import { loadTimeline } from '@/services/timelineStore';
import { formatClock } from '@/services/export/generators';
import { haptic } from '@/services/haptics';
import { runImportFlow } from '@/services/import/importer';
import type { Note, NoteSort } from '@/types';

// Only the first screenful gets a staggered entrance; past that the delay
// would just make scrolling feel laggy.
const MAX_STAGGERED_ITEMS = 8;

const SORT_LABELS: Record<NoteSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  longest: 'Longest first',
  title: 'Title A–Z',
};

function formatRelativeTime(date: Date): string {
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NotesScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const sheet = useActionSheet();
  const toast = useToast();
  const { isPro } = usePro();

  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<NoteSort>('newest');
  const [refreshing, setRefreshing] = useState(false);

  const { notes, loading, refresh } = useNotes({ query, tag, sort });
  const tags = useTags();

  const sections = useMemo(() => {
    const pinned = notes.filter((note) => note.pinned);
    const others = notes.filter((note) => !note.pinned);
    if (pinned.length === 0) return [{ title: null as string | null, data: others }];
    return [
      { title: 'Pinned', data: pinned },
      { title: 'All notes', data: others },
    ].filter((section) => section.data.length > 0);
  }, [notes]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const togglePin = useCallback(
    async (note: Note) => {
      try {
        await notesRepo.updateNote(note.id, { pinned: !note.pinned });
        void haptic('light');
      } catch (error) {
        console.error('Failed to update note:', error);
        toast.show({ message: 'Could not update the note.', tone: 'error' });
      }
    },
    [toast]
  );

  const deleteWithUndo = useCallback(
    async (note: Note) => {
      try {
        const deleted = await notesRepo.deleteNote(note.id);
        if (!deleted) return;
        void haptic('warning');
        toast.show({
          message: `Deleted “${deleted.title}”`,
          action: { label: 'Undo', onPress: () => void notesRepo.restoreNote(deleted) },
          // Files go only once the undo window closes.
          onDismiss: () => notesRepo.purgeNoteFiles(deleted),
          durationMs: 5000,
        });
      } catch (error) {
        console.error('Failed to delete note:', error);
        toast.show({ message: 'Could not delete the note.', tone: 'error' });
      }
    },
    [toast]
  );

  const shareAsText = useCallback(
    async (note: Note) => {
      try {
        const uri = await exportTextFile(note, 'txt');
        await shareFile(uri, 'text/plain', note.title);
      } catch (error) {
        console.error('Failed to share note:', error);
        toast.show({ message: 'Could not share the note.', tone: 'error' });
      }
    },
    [toast]
  );

  const openActions = useCallback(
    (note: Note) => {
      void haptic('medium');
      sheet.open({
        title: note.title,
        actions: [
          { label: note.pinned ? 'Unpin' : 'Pin to top', icon: note.pinned ? 'bookmark' : 'bookmark-outline', onPress: () => togglePin(note) },
          { label: 'Share as text', icon: 'chatbox-ellipses-outline', onPress: () => shareAsText(note) },
          {
            label: 'Export…',
            icon: 'share-outline',
            onPress: async () => {
              const timeline = note.audioUri ? await loadTimeline(note.id) : null;
              sheet.open({
                title: 'Export & share',
                content: <ExportPanel note={note} isPro={isPro} hasTimeline={Boolean(timeline?.length)} />,
                actions: [],
              });
            },
          },
          { label: 'Open', icon: 'open-outline', onPress: () => router.push(`/note/${note.id}`) },
          { label: 'Delete', icon: 'trash-outline', destructive: true, onPress: () => deleteWithUndo(note) },
        ],
      });
    },
    [sheet, togglePin, shareAsText, deleteWithUndo, router, isPro]
  );

  const openSort = () =>
    sheet.open({
      title: 'Sort notes',
      actions: (Object.keys(SORT_LABELS) as NoteSort[]).map((key) => ({
        label: SORT_LABELS[key],
        icon: key === sort ? 'checkmark' : undefined,
        onPress: () => setSort(key),
      })),
    });

  const handleImport = async () => {
    if (!isPro) {
      router.push('/paywall');
      return;
    }
    const report = await runImportFlow();
    if (report) router.push({ pathname: '/import', params: { report: JSON.stringify(report) } });
  };

  const renderItem = useCallback(
    ({ item, index }: { item: Note; index: number }) => (
      <SwipeableRow
        leftAction={{
          icon: item.pinned ? 'bookmark' : 'bookmark-outline',
          color: colors.tint,
          onTrigger: () => togglePin(item),
          accessibilityLabel: item.pinned ? 'Unpin' : 'Pin',
        }}
        rightAction={{
          icon: 'trash',
          color: colors.danger,
          onTrigger: () => deleteWithUndo(item),
          accessibilityLabel: 'Delete',
        }}
      >
        <NoteCard
          note={item}
          index={index}
          colors={colors}
          styles={styles}
          onPress={() => router.push(`/note/${item.id}`)}
          onLongPress={() => openActions(item)}
          onMore={() => openActions(item)}
        />
      </SwipeableRow>
    ),
    [colors, styles, router, togglePin, deleteWithUndo, openActions]
  );

  const isFiltering = query.trim().length > 0 || tag !== null;
  const subtitle = loading ? ' ' : `${notes.length} note${notes.length === 1 ? '' : 's'}${isFiltering ? ' found' : ''}`;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={styles.header}>
        <ScreenHeader
          title="Notes"
          subtitle={subtitle}
          right={
            <IconButton
              name="swap-vertical"
              background={colors.surface}
              onPress={openSort}
              accessibilityLabel={`Sort: ${SORT_LABELS[sort]}`}
            />
          }
        />
        <TextField
          icon="search"
          placeholder="Search notes, summaries, tags…"
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          containerStyle={styles.searchField}
        />
        {tags.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tagRow}
            style={styles.tagScroll}
            keyboardShouldPersistTaps="handled"
          >
            <Chip label="All" tone="muted" selected={tag === null} onPress={() => setTag(null)} />
            {tags.map((t) => (
              <Chip
                key={t.tag}
                label={`#${t.tag}`}
                tone="muted"
                selected={tag === t.tag}
                onPress={() => setTag(tag === t.tag ? null : t.tag)}
              />
            ))}
          </ScrollView>
        )}
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
      ) : notes.length === 0 ? (
        isFiltering ? (
          <EmptyState
            icon="search-outline"
            title="No matching notes"
            subtitle={query ? `Nothing matches “${query.trim()}”.` : 'No notes have this tag.'}
          >
            <Button
              label="Clear filters"
              variant="secondary"
              onPress={() => {
                setQuery('');
                setTag(null);
              }}
            />
          </EmptyState>
        ) : (
          <EmptyState
            icon="mic-outline"
            title="No notes yet"
            subtitle="Record a meeting or a thought. It's transcribed right here on your phone."
          >
            <Button label="Record a note" icon="mic" onPress={() => router.navigate('/')} />
            <Button label="Import notes" icon="download-outline" variant="secondary" onPress={handleImport} />
          </EmptyState>
        )
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(note) => note.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) =>
            section.title ? <Text style={styles.sectionLabel}>{section.title}</Text> : null
          }
          style={styles.scroll}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.tint} />}
        />
      )}
    </SafeAreaView>
  );
}

const NoteCard = React.memo(function NoteCard({
  note,
  index,
  colors,
  styles,
  onPress,
  onLongPress,
  onMore,
}: {
  note: Note;
  index: number;
  colors: typeof Colors.light;
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
  onLongPress: () => void;
  onMore: () => void;
}) {
  const snippet = note.summary?.overview || note.transcription || 'No text yet';
  const enhancing = note.enhancement === 'pending' || note.enhancement === 'running';

  return (
    <AnimatedPressable
      entering={FadeInDown.delay(Math.min(index, MAX_STAGGERED_ITEMS) * 40).duration(300)}
      layout={LinearTransition.springify().damping(18)}
      haptic="selection"
      scaleTo={0.98}
      style={styles.card}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityHint="Opens the note. Long-press for more actions."
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          {note.pinned && (
            <View style={styles.badge}>
              <Ionicons name="bookmark" size={11} color={colors.tint} />
            </View>
          )}
          {note.source === 'import' && (
            <View style={styles.badge}>
              <Ionicons name="download-outline" size={11} color={colors.tint} />
            </View>
          )}
          <Text style={styles.cardTitle} numberOfLines={1}>
            {note.title}
          </Text>
        </View>
        <IconButton name="ellipsis-horizontal" size={16} background={colors.surface} onPress={onMore} />
      </View>

      <Text style={styles.cardSnippet} numberOfLines={2}>
        {note.summary && <Text style={styles.summaryMark}>Summary · </Text>}
        {snippet}
      </Text>

      <View style={styles.cardMeta}>
        <View style={styles.metaLeft}>
          {note.duration > 0 && <Chip label={formatClock(note.duration)} tone="muted" />}
          {enhancing && (
            <Chip
              label={
                note.enhancement === 'running' && note.enhancementProgress > 0
                  ? `Enhancing ${Math.round(note.enhancementProgress * 100)}%`
                  : 'Enhancing…'
              }
              tone="tint"
            />
          )}
          <Text style={styles.metaText}>{formatRelativeTime(note.createdAt)}</Text>
        </View>
        {note.tags.length > 0 && (
          <View style={styles.tagChips}>
            {note.tags.slice(0, 2).map((t) => (
              <Chip key={t} label={t} tone="tint" />
            ))}
            {note.tags.length > 2 && <Text style={styles.metaText}>+{note.tags.length - 2}</Text>}
          </View>
        )}
      </View>
    </AnimatedPressable>
  );
});

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg },
    searchField: { marginBottom: Spacing.md },
    tagScroll: { marginHorizontal: -Spacing.xl, marginBottom: Spacing.md, flexGrow: 0 },
    tagRow: { gap: Spacing.sm, paddingHorizontal: Spacing.xl },
    scroll: { flex: 1 },
    list: { paddingHorizontal: Spacing.xl, paddingBottom: 140, paddingTop: Spacing.xs },
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
    badge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: `${colors.tint}1A`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTitle: { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    cardSnippet: { fontSize: FontSize.sm, color: colors.textMuted, marginTop: Spacing.sm, lineHeight: 20 },
    summaryMark: { color: colors.tint, fontWeight: '700' },
    cardMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: Spacing.md,
      gap: Spacing.sm,
    },
    metaLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1 },
    metaText: { fontSize: FontSize.sm, color: colors.textMuted },
    tagChips: { flexDirection: 'row', gap: Spacing.xs },
  });
}
