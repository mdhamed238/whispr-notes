/**
 * Notes: full-text search, tag filter, sort, swipe to pin/delete with undo,
 * long-press menu. The list stays live while background work (enhanced
 * transcripts, summaries, imports) lands.
 *
 * Rows are loaded as snippets (see notesRepo.listNoteItems); the full note
 * is read only when an action needs it.
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
import { useEnhanceProgress } from '@/hooks/useEnhanceProgress';
import { useNotes, useTags } from '@/hooks/useNotes';
import { usePro } from '@/hooks/usePro';
import { formatDate, useI18n, type TKey } from '@/i18n';
import * as notesRepo from '@/services/db/notesRepo';
import { ExportPanel } from '@/components/ExportSheet';
import { exportTextFile, shareFile } from '@/services/export/exporter';
import { loadTimeline } from '@/services/timelineStore';
import { formatClock } from '@/services/export/generators';
import { haptic } from '@/services/haptics';
import { AudioImportError, importAudioFile, pickAudioFile } from '@/services/import/audioImport';
import { runImportFlow } from '@/services/import/importer';
import type { NoteListItem, NoteSort } from '@/types';

// Only the first screenful gets a staggered entrance; past that the delay
// would just make scrolling feel laggy.
const MAX_STAGGERED_ITEMS = 8;

const SORT_LABELS: Record<NoteSort, TKey> = {
  newest: 'notes.sort.newest',
  oldest: 'notes.sort.oldest',
  longest: 'notes.sort.longest',
  title: 'notes.sort.title',
};

const AUDIO_ERRORS: Record<AudioImportError['reason'], TKey> = {
  'too-large': 'notes.audioTooLarge',
  'too-short': 'notes.audioTooShort',
  unreadable: 'notes.audioUnreadable',
};

type Translate = ReturnType<typeof useI18n>['t'];

function formatRelativeTime(date: Date, t: Translate): string {
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return t('time.justNow');
  if (diffMinutes < 60) return t('time.minutesAgo', { count: diffMinutes });
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return t('time.hoursAgo', { count: diffHours });
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return t('time.daysAgo', { count: diffDays });
  return formatDate(date, { month: 'short', day: 'numeric' });
}

export default function NotesScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const sheet = useActionSheet();
  const toast = useToast();
  const { t, tp } = useI18n();
  const { isPro } = usePro();

  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<NoteSort>('newest');
  const [refreshing, setRefreshing] = useState(false);
  const [importingAudio, setImportingAudio] = useState(false);

  const { notes, loading, refresh } = useNotes({ query, tag, sort });
  const tags = useTags();

  const sections = useMemo(() => {
    const pinned = notes.filter((note) => note.pinned);
    const others = notes.filter((note) => !note.pinned);
    if (pinned.length === 0) return [{ title: null as string | null, data: others }];
    return [
      { title: t('notes.pinned'), data: pinned },
      { title: t('notes.all'), data: others },
    ].filter((section) => section.data.length > 0);
  }, [notes, t]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const togglePin = useCallback(
    async (note: NoteListItem) => {
      try {
        await notesRepo.updateNote(note.id, { pinned: !note.pinned });
        void haptic('light');
      } catch (error) {
        console.error('Failed to update note:', error);
        toast.show({ message: t('notes.updateFailed'), tone: 'error' });
      }
    },
    [toast, t]
  );

  const deleteWithUndo = useCallback(
    async (note: NoteListItem) => {
      try {
        const deleted = await notesRepo.deleteNote(note.id);
        if (!deleted) return;
        void haptic('warning');
        toast.show({
          message: t('notes.deleted', { title: deleted.title }),
          action: { label: t('common.undo'), onPress: () => void notesRepo.restoreNote(deleted) },
          // Files go only once the undo window closes.
          onDismiss: () => notesRepo.purgeNoteFiles(deleted),
          durationMs: 5000,
        });
      } catch (error) {
        console.error('Failed to delete note:', error);
        toast.show({ message: t('notes.deleteFailed'), tone: 'error' });
      }
    },
    [toast, t]
  );

  const shareAsText = useCallback(
    async (item: NoteListItem) => {
      try {
        const note = await notesRepo.getNote(item.id);
        if (!note) return;
        const uri = await exportTextFile(note, 'txt');
        await shareFile(uri, 'text/plain', note.title);
      } catch (error) {
        console.error('Failed to share note:', error);
        toast.show({ message: t('notes.shareFailed'), tone: 'error' });
      }
    },
    [toast, t]
  );

  const openActions = useCallback(
    (item: NoteListItem) => {
      void haptic('medium');
      sheet.open({
        title: item.title,
        actions: [
          {
            label: item.pinned ? t('notes.unpin') : t('notes.pin'),
            icon: item.pinned ? 'bookmark' : 'bookmark-outline',
            onPress: () => togglePin(item),
          },
          { label: t('notes.shareText'), icon: 'chatbox-ellipses-outline', onPress: () => shareAsText(item) },
          {
            label: t('notes.export'),
            icon: 'share-outline',
            onPress: async () => {
              const note = await notesRepo.getNote(item.id);
              if (!note) return;
              const timeline = note.audioUri ? await loadTimeline(note.id) : null;
              sheet.open({
                title: t('export.title'),
                content: <ExportPanel note={note} isPro={isPro} hasTimeline={Boolean(timeline?.length)} />,
                actions: [],
              });
            },
          },
          { label: t('notes.open'), icon: 'open-outline', onPress: () => router.push(`/note/${item.id}`) },
          { label: t('common.delete'), icon: 'trash-outline', destructive: true, onPress: () => deleteWithUndo(item) },
        ],
      });
    },
    [sheet, togglePin, shareAsText, deleteWithUndo, router, isPro, t]
  );

  const openSort = () =>
    sheet.open({
      title: t('notes.sortTitle'),
      actions: (Object.keys(SORT_LABELS) as NoteSort[]).map((key) => ({
        label: t(SORT_LABELS[key]),
        icon: key === sort ? 'checkmark' : undefined,
        onPress: () => setSort(key),
      })),
    });

  const handleImport = async () => {
    const report = await runImportFlow();
    if (report) router.push({ pathname: '/import', params: { report: JSON.stringify(report) } });
  };

  const handleImportAudio = async () => {
    if (!isPro) {
      router.push('/paywall');
      return;
    }
    if (importingAudio) return;
    const picked = await pickAudioFile();
    if (!picked) return;
    setImportingAudio(true);
    toast.show({ message: t('notes.audioPreparing'), durationMs: 60000 });
    try {
      const id = await importAudioFile(picked, t('notes.audioFallbackTitle'));
      void haptic('success');
      toast.show({ message: t('notes.audioQueued'), tone: 'success' });
      router.push(`/note/${id}`);
    } catch (error) {
      console.warn('Audio import failed:', error);
      toast.show({
        message: t(error instanceof AudioImportError ? AUDIO_ERRORS[error.reason] : 'notes.audioUnreadable'),
        tone: 'error',
        durationMs: 6000,
      });
    } finally {
      setImportingAudio(false);
    }
  };

  const openAdd = () =>
    sheet.open({
      title: t('notes.addTitle'),
      actions: [
        { label: t('notes.recordNote'), icon: 'mic-outline', onPress: () => router.navigate('/') },
        {
          label: t('notes.transcribeAudio'),
          icon: 'musical-notes-outline',
          badge: isPro ? undefined : t('common.pro'),
          onPress: () => void handleImportAudio(),
        },
        { label: t('notes.importNotes'), icon: 'download-outline', onPress: () => void handleImport() },
      ],
    });

  const renderItem = useCallback(
    ({ item, index }: { item: NoteListItem; index: number }) => (
      <SwipeableRow
        leftAction={{
          icon: item.pinned ? 'bookmark' : 'bookmark-outline',
          color: colors.tint,
          onTrigger: () => togglePin(item),
          accessibilityLabel: item.pinned ? t('notes.unpin') : t('notes.pin'),
        }}
        rightAction={{
          icon: 'trash',
          color: colors.danger,
          onTrigger: () => deleteWithUndo(item),
          accessibilityLabel: t('common.delete'),
        }}
      >
        <NoteCard
          note={item}
          index={index}
          colors={colors}
          styles={styles}
          t={t}
          onPress={() => router.push(`/note/${item.id}`)}
          onLongPress={() => openActions(item)}
          onMore={() => openActions(item)}
        />
      </SwipeableRow>
    ),
    [colors, styles, router, togglePin, deleteWithUndo, openActions, t]
  );

  const isFiltering = query.trim().length > 0 || tag !== null;
  const subtitle = loading ? ' ' : isFiltering ? tp('notes.found', notes.length) : tp('notes.count', notes.length);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={styles.header}>
        <ScreenHeader
          title={t('notes.title')}
          subtitle={subtitle}
          right={
            <View style={styles.headerActions}>
              <IconButton
                name="swap-vertical"
                background={colors.surface}
                onPress={openSort}
                accessibilityLabel={t('notes.sortA11y', { sort: t(SORT_LABELS[sort]) })}
              />
              <IconButton
                name="add"
                color={colors.onAccent}
                background={colors.tint}
                onPress={openAdd}
                accessibilityLabel={t('notes.addTitle')}
              />
            </View>
          }
        />
        <TextField
          icon="search"
          placeholder={t('notes.searchPlaceholder')}
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
            <Chip label={t('notes.allTags')} tone="muted" selected={tag === null} onPress={() => setTag(null)} />
            {tags.map((item) => (
              <Chip
                key={item.tag}
                label={`#${item.tag}`}
                tone="muted"
                selected={tag === item.tag}
                onPress={() => setTag(tag === item.tag ? null : item.tag)}
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
            title={t('notes.noMatchTitle')}
            subtitle={query ? t('notes.noMatchQuery', { query: query.trim() }) : t('notes.noMatchTag')}
          >
            <Button
              label={t('notes.clearFilters')}
              variant="secondary"
              onPress={() => {
                setQuery('');
                setTag(null);
              }}
            />
          </EmptyState>
        ) : (
          <EmptyState icon="mic-outline" title={t('notes.emptyTitle')} subtitle={t('notes.emptyBody')}>
            <Button label={t('notes.recordNote')} icon="mic" onPress={() => router.navigate('/')} />
            <Button label={t('notes.importNotes')} icon="download-outline" variant="secondary" onPress={handleImport} />
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

/** Subscribes to live progress by itself, so a ticking percentage re-renders one chip, not the list. */
function EnhancingChip({ noteId, t }: { noteId: string; t: Translate }) {
  const progress = useEnhanceProgress(noteId);
  const percent = progress && progress.fraction > 0 ? Math.round(progress.fraction * 100) : null;
  const label =
    progress?.phase === 'model'
      ? t('note.downloadingModelShort')
      : percent !== null
        ? t('note.transcribingPercent', { percent })
        : t('note.transcribingShort');
  return <Chip label={label} tone="tint" />;
}

const NoteCard = React.memo(function NoteCard({
  note,
  index,
  colors,
  styles,
  t,
  onPress,
  onLongPress,
  onMore,
}: {
  note: NoteListItem;
  index: number;
  colors: typeof Colors.light;
  styles: ReturnType<typeof createStyles>;
  t: Translate;
  onPress: () => void;
  onLongPress: () => void;
  onMore: () => void;
}) {
  const enhancing = note.enhancement === 'pending' || note.enhancement === 'running';
  const snippet = note.snippet || (enhancing ? t('note.transcribingShort') : t('notes.noText'));

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
      accessibilityLabel={note.title}
      accessibilityHint={t('notes.cardHint')}
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
              <Ionicons name={note.hasAudio ? 'musical-notes-outline' : 'download-outline'} size={11} color={colors.tint} />
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
          onPress={onMore}
          accessibilityLabel={t('notes.moreA11y')}
        />
      </View>

      <Text style={styles.cardSnippet} numberOfLines={2}>
        {note.hasSummary && <Text style={styles.summaryMark}>{t('notes.summaryMark')} · </Text>}
        {snippet}
      </Text>

      <View style={styles.cardMeta}>
        <View style={styles.metaLeft}>
          {note.duration > 0 && <Chip label={formatClock(note.duration)} tone="muted" />}
          {enhancing && <EnhancingChip noteId={note.id} t={t} />}
          <Text style={styles.metaText}>{formatRelativeTime(note.createdAt, t)}</Text>
        </View>
        {note.tags.length > 0 && (
          <View style={styles.tagChips}>
            {note.tags.slice(0, 2).map((tag) => (
              <Chip key={tag} label={tag} tone="tint" />
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
    headerActions: { flexDirection: 'row', gap: Spacing.sm },
    searchField: { marginBottom: Spacing.md },
    tagScroll: { marginHorizontal: -Spacing.xl, marginBottom: Spacing.md, flexGrow: 0 },
    tagRow: { gap: Spacing.sm, paddingHorizontal: Spacing.xl },
    scroll: { flex: 1 },
    list: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl, paddingTop: Spacing.xs },
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
