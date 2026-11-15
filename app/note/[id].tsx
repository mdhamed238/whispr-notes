/**
 * Note detail: title, real-waveform player, summary, tags and transcript.
 *
 * The note is live (useNote): when the enhanced transcript or a summary lands
 * while the note is open, it appears in place — unless the user has edited
 * that field, in which case their text wins.
 */

import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  I18nManager,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, runOnJS } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActionSheet } from '@/components/ui/ActionSheet';
import AnimatedPressable from '@/components/ui/AnimatedPressable';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Chip from '@/components/ui/Chip';
import EmptyState from '@/components/ui/EmptyState';
import IconButton from '@/components/ui/IconButton';
import SegmentedControl from '@/components/ui/SegmentedControl';
import { useToast } from '@/components/ui/Toast';
import { contentDirection } from '@/components/textDirection';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { isUnspacedLanguage, languageLabel } from '@/constants/languages';
import { STYLE_LABELS } from '@/constants/summaryStyleLabels';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { useEnhanceProgress } from '@/hooks/useEnhanceProgress';
import { useNote } from '@/hooks/useNote';
import { usePro } from '@/hooks/usePro';
import { useSummaryState } from '@/hooks/useSummaryState';
import { getLocaleTag, useI18n, type TKey } from '@/i18n';
import * as enhanceQueue from '@/services/ai/enhanceQueue';
import * as summarizer from '@/services/ai/summarizer';
import { SUMMARY_STYLES, type SummaryStyle, isProStyle, isSummaryStyle } from '@/services/ai/summaryStyles';
import { FREE_SUMMARIES_PER_WEEK, summaryAllowance } from '@/services/billing/quota';
import { useSettings } from '@/services/settings';
import * as notesRepo from '@/services/db/notesRepo';
import { ExportPanel } from '@/components/ExportSheet';
import { formatClock, formatNoteDate } from '@/services/export/generators';
import { haptic } from '@/services/haptics';
import { countWords, isRtlText } from '@/services/text';
import { deleteTimeline } from '@/services/timelineStore';
import { type TranscriptParagraph, buildParagraphs, paragraphAt } from '@/services/transcriptParagraphs';
import { normalizePeaks } from '@/services/waveform';
import { PEAK_COUNT, loadPeaks } from '@/services/waveformStore';
import type { Note, NoteSummary, TranscriptSegment, TranscriptWord } from '@/types';

const AUTOSAVE_DELAY_MS = 800;
// The player's own default is 500ms, which is too coarse to track a spoken
// word — highlighting visibly lags the audio at that rate.
const PLAYBACK_UPDATE_INTERVAL_MS = 100;
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
const SKIP_SECONDS = 15;

/** Below this there's nothing worth summarizing (matches the summarizer). */
const MIN_WORDS_FOR_SUMMARY = 25;

type Tab = 'summary' | 'transcript';
type Translate = ReturnType<typeof useI18n>['t'];


export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheet = useActionSheet();
  const toast = useToast();
  const { t } = useI18n();

  const { note, timeline, loading, setTimeline } = useNote(id);
  const summaryState = useSummaryState(id);
  const { isPro } = usePro();
  const [settings] = useSettings();
  const allowance = summaryAllowance(settings.summaryLog, new Date(), isPro);
  const generating = summaryState.phase !== 'idle';

  const [title, setTitle] = useState('');
  const [transcription, setTranscription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [mode, setMode] = useState<'listen' | 'edit'>('listen');
  const [tab, setTab] = useState<Tab>('transcript');
  const enhancing = note?.enhancement === 'pending' || note?.enhancement === 'running';

  // What the fields last held when they matched storage. An incoming update
  // only replaces a field the user hasn't changed since — so a transcript
  // enhanced in the background never overwrites a correction being typed.
  const syncedRef = useRef<{ title: string; transcription: string } | null>(null);

  useEffect(() => {
    if (!note) return;
    const synced = syncedRef.current;
    const transcriptDirty = Boolean(synced) && transcription !== synced!.transcription;
    // Compare trimmed: autosave stores the trimmed title, and re-applying it
    // while the user is still typing would eat a trailing space.
    const untitled = t('note.untitled');
    if (!synced || (title.trim() || untitled) === (synced.title.trim() || untitled)) {
      if (note.title !== (title.trim() || untitled)) setTitle(note.title);
    }
    if (!synced || !transcriptDirty) {
      setTranscription(note.transcription);
    } else if (timeline && id) {
      // Background text landed while the user was editing: their edit will
      // win when it saves, so timings for the other text must go.
      setTimeline(null);
      deleteTimeline(id);
    }
    setTags(note.tags);
    syncedRef.current = { title: note.title, transcription: note.transcription };
    // Open on the summary once one exists for this note.
    if (!synced && note.summary) setTab('summary');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, timeline]);

  // Hoisted so the timestamped transcript can drive the same player.
  const player = useAudioPlayer(note?.audioUri ?? null, { updateInterval: PLAYBACK_UPDATE_INTERVAL_MS });
  const hasTimeline = Boolean(note?.audioUri && timeline && timeline.length > 0);

  // Both fields are always persisted together, so switching fields within
  // the debounce window can never drop the first one's edit.
  const latestFieldsRef = useRef({ title, transcription });
  latestFieldsRef.current = { title, transcription };
  const dirtyTitleRef = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    (updates: Partial<Note>) => {
      if (!id) return;
      notesRepo.updateNote(id, updates).catch((error) => {
        console.error('Failed to update note:', error);
        toast.show({ message: t('note.saveFailed'), tone: 'error' });
      });
    },
    [id, toast, t]
  );

  const persistFields = useCallback(() => {
    const fields = latestFieldsRef.current;
    syncedRef.current = { ...fields };
    persist({
      title: fields.title.trim() || t('note.untitled'),
      transcription: fields.transcription,
      ...(dirtyTitleRef.current ? { titleIsAuto: false } : {}),
    });
  }, [persist, t]);

  const flushPendingSave = useCallback(() => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
      persistFields();
    }
  }, [persistFields]);

  const scheduleAutosave = () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      persistFields();
    }, AUTOSAVE_DELAY_MS);
  };

  // `beforeRemove` covers every way out (button, swipe, hardware back).
  useEffect(() => navigation.addListener('beforeRemove', flushPendingSave), [navigation, flushPendingSave]);
  // Safety net for teardown paths beforeRemove doesn't cover.
  const flushRef = useRef(flushPendingSave);
  flushRef.current = flushPendingSave;
  useEffect(() => () => flushRef.current(), []);

  const handleTitleChange = (text: string) => {
    setTitle(text);
    dirtyTitleRef.current = true;
    scheduleAutosave();
  };

  const handleTranscriptionChange = (text: string) => {
    setTranscription(text);
    // Typing means editing: don't flip to listen mode if timings arrive.
    setMode('edit');
    // A timeline describes the audio, not the text: once the transcript is
    // hand-edited the two disagree, so the timings are dropped rather than
    // ever showing stale words. SRT falls back to a single cue.
    if (timeline && id) {
      setTimeline(null);
      deleteTimeline(id);
    }
    scheduleAutosave();
  };

  const handleTogglePin = () => {
    if (!note) return;
    persist({ pinned: !note.pinned });
    void haptic('light');
  };

  const handleAddTag = () => {
    const trimmed = newTag.trim().replace(/^#/, '');
    setNewTag('');
    if (!trimmed || tags.includes(trimmed)) return;
    const next = [...tags, trimmed];
    setTags(next);
    persist({ tags: next });
    void haptic('selection');
  };

  const handleRemoveTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    persist({ tags: next });
    void haptic('selection');
  };

  const handleDelete = async () => {
    if (!id) return;
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    try {
      player.pause();
      const deleted = await notesRepo.deleteNote(id);
      router.back();
      if (deleted) {
        toast.show({
          message: t('notes.deleted', { title: deleted.title }),
          action: { label: t('common.undo'), onPress: () => void notesRepo.restoreNote(deleted) },
          onDismiss: () => notesRepo.purgeNoteFiles(deleted),
          durationMs: 5000,
        });
      }
    } catch (error) {
      console.error('Failed to delete note:', error);
      toast.show({ message: t('notes.deleteFailed'), tone: 'error' });
    }
  };

  const currentNote = (): Note | null => (note ? { ...note, title, transcription, tags } : null);

  const handleShare = () => {
    const n = currentNote();
    if (!n) return;
    flushPendingSave();
    sheet.open({
      title: t('export.title'),
      content: <ExportPanel note={n} isPro={isPro} hasTimeline={hasTimeline} />,
      actions: [],
    });
  };

  const handleSummarize = async (style?: SummaryStyle) => {
    if (!note || generating) return;
    if (countWords(transcription) < MIN_WORDS_FOR_SUMMARY) {
      toast.show({ message: enhancing ? t('note.summaryAfterTranscript') : t('note.tooShortToSummarize') });
      return;
    }
    if (!allowance.allowed) {
      router.push('/paywall');
      return;
    }
    flushPendingSave();
    try {
      await summarizer.summarize(note.id, { style });
      void haptic('success');
      setTab('summary');
    } catch (error) {
      if (summarizer.isStopped(error)) return;
      console.warn('Summary failed:', error);
      toast.show({ message: t('note.summaryFailed'), tone: 'error' });
    }
  };

  /** Pick what the summary should focus on (Pro beyond the default). */
  const handleSummarizeAs = () =>
    sheet.open({
      title: t('summary.styleTitle'),
      message: t('summary.styleBody'),
      actions: SUMMARY_STYLES.map((style) => ({
        label: t(STYLE_LABELS[style]),
        icon: style === settings.summaryStyle ? ('checkmark' as const) : undefined,
        badge: !isPro && isProStyle(style) ? t('common.pro') : undefined,
        onPress: () => {
          if (!isPro && isProStyle(style)) router.push('/paywall');
          else void handleSummarize(style);
        },
      })),
    });

  const handleAsk = () => {
    if (!note) return;
    if (!isPro) {
      router.push('/paywall');
      return;
    }
    flushPendingSave();
    router.push(`/ask/${note.id}`);
  };

  const handleRegenerateTitle = async () => {
    if (!note || generating) return;
    flushPendingSave();
    dirtyTitleRef.current = false;
    try {
      await summarizer.generateTitle(note.id, true);
      void haptic('success');
    } catch (error) {
      if (summarizer.isStopped(error)) return;
      console.warn('Title failed:', error);
      toast.show({ message: t('note.titleFailed'), tone: 'error' });
    }
  };

  const handleRetranscribe = () => {
    if (!note) return;
    flushPendingSave();
    void enhanceQueue.enqueue(note.id, 'enhance');
    toast.show({ message: t('note.retranscribing') });
  };

  const handleMore = () =>
    sheet.open({
      title: title || t('note.fallbackTitle'),
      actions: [
        ...(note?.audioUri && note.enhancement !== 'pending' && note.enhancement !== 'running'
          ? [{ label: t('note.retranscribe'), icon: 'refresh-outline' as const, onPress: handleRetranscribe }]
          : []),
        { label: t('note.summarizeAs'), icon: 'options-outline', onPress: handleSummarizeAs },
        { label: t('note.newTitle'), icon: 'sparkles-outline', onPress: handleRegenerateTitle },
        {
          label: t('note.duplicate'),
          icon: 'copy-outline',
          onPress: async () => {
            const n = currentNote();
            if (!n) return;
            const now = new Date();
            await notesRepo.createNote({
              ...n,
              id: now.getTime().toString(),
              title: t('note.copyOf', { title: n.title }),
              // The copy has no audio of its own; deleting either note must
              // never remove the other's recording.
              audioUri: null,
              duration: 0,
              createdAt: now,
              updatedAt: now,
              enhancement: 'none',
              enhancementProgress: 0,
            });
            void haptic('success');
            toast.show({ message: t('note.duplicated'), tone: 'success' });
          },
        },
        { label: t('note.delete'), icon: 'trash-outline', destructive: true, onPress: handleDelete },
      ],
    });

  if (loading) {
    return <SafeAreaView style={styles.container} />;
  }

  if (!note) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState icon="document-outline" title={t('note.notFoundTitle')} subtitle={t('note.notFoundBody')}>
          <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
        </EmptyState>
      </SafeAreaView>
    );
  }

  // Arabic, Hebrew, Persian and Urdu notes read right to left whatever the interface language.
  const textDirection = contentDirection(isRtlText(transcription || title, note.language));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <IconButton
          name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'}
          onPress={() => router.back()}
          background={colors.surface}
          accessibilityLabel={t('common.back')}
        />
        <View style={styles.topBarActions}>
          {hasTimeline && tab === 'transcript' && (
            <IconButton
              name={mode === 'listen' ? 'create-outline' : 'headset-outline'}
              color={colors.tint}
              background={colors.surface}
              accessibilityLabel={mode === 'listen' ? t('note.editTranscript') : t('note.listenMode')}
              onPress={() => setMode((current) => (current === 'listen' ? 'edit' : 'listen'))}
            />
          )}
          <IconButton
            name={note.pinned ? 'bookmark' : 'bookmark-outline'}
            color={colors.tint}
            background={note.pinned ? `${colors.tint}1A` : colors.surface}
            accessibilityLabel={note.pinned ? t('notes.unpin') : t('notes.pin')}
            onPress={handleTogglePin}
            haptic="none"
          />
          <IconButton name="ellipsis-horizontal" background={colors.surface} onPress={handleMore} accessibilityLabel={t('notes.moreA11y')} />
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Animated.View entering={FadeIn.duration(250)}>
            <View style={styles.titleRow}>
              <TextInput
                style={[styles.titleInput, textDirection]}
                value={title}
                onChangeText={handleTitleChange}
                placeholder={t('note.titlePlaceholder')}
                placeholderTextColor={colors.textMuted}
                multiline
                accessibilityLabel={t('note.titleA11y')}
              />
              {note.titleIsAuto && (
                <IconButton
                  name="sparkles"
                  size={14}
                  color={colors.tint}
                  background="transparent"
                  onPress={handleRegenerateTitle}
                  accessibilityLabel={t('note.aiTitleA11y')}
                />
              )}
            </View>

            <Text style={styles.metaText}>
              {formatNoteDate(note.createdAt, getLocaleTag())}
              {note.duration > 0 ? ` · ${formatClock(note.duration)}` : ''}
              {note.language ? ` · ${languageLabel(note.language)}` : ''}
              {note.source === 'import' ? ` · ${t('note.imported')}` : ''}
            </Text>

            {enhancing && (
              <EnhancementBanner note={note} colors={colors} styles={styles} t={t} onCancel={() => void enhanceQueue.cancel(note.id, 'enhance')} />
            )}
            {note.enhancement === 'failed' && note.audioUri && (
              <View style={styles.banner} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <Text style={[styles.bannerText, { flex: 1 }]}>{t('note.transcribeFailed')}</Text>
                <Button label={t('common.retry')} variant="ghost" onPress={handleRetranscribe} />
              </View>
            )}

            {note.audioUri && <NotePlayer noteId={note.id} audioUri={note.audioUri} player={player} colors={colors} t={t} />}

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
                  placeholder={t('note.addTag')}
                  placeholderTextColor={colors.textMuted}
                  onSubmitEditing={handleAddTag}
                  submitBehavior="submit"
                  returnKeyType="done"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel={t('note.addTag')}
                />
                <IconButton name="add" size={18} color={colors.onAccent} background={colors.tint} onPress={handleAddTag} accessibilityLabel={t('note.addTag')} />
              </View>
            </View>

            {generating && summaryState.phase !== 'answering' && (
              <SummaryProgress state={summaryState} colors={colors} styles={styles} t={t} onStop={() => summarizer.stop(note.id)} />
            )}

            {note.summary && (
              <View style={styles.segment}>
                <SegmentedControl
                  options={[
                    { value: 'summary', label: t('note.tabSummary') },
                    { value: 'transcript', label: t('note.tabTranscript') },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
              </View>
            )}

            {tab === 'summary' && note.summary ? (
              <SummaryView summary={note.summary} language={note.language} colors={colors} styles={styles} t={t} />
            ) : hasTimeline && mode === 'listen' && timeline ? (
              <TimelineTranscript
                player={player}
                segments={timeline}
                styles={styles}
                hint={t('note.tapWordHint')}
                textDirection={textDirection}
                unspaced={isUnspacedLanguage(note.language)}
              />
            ) : (
              <TextInput
                style={[styles.transcriptionInput, textDirection]}
                value={transcription}
                onChangeText={handleTranscriptionChange}
                multiline
                scrollEnabled={false}
                textAlignVertical="top"
                placeholder={enhancing ? t('note.transcriptPending') : t('note.tabTranscript')}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={t('note.tabTranscript')}
              />
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.bottomBar}>
        <IconButton
          name="share-outline"
          background={colors.surface}
          onPress={handleShare}
          accessibilityLabel={t('note.share')}
          style={styles.bottomIcon}
        />
        <View style={styles.bottomButton}>
          <Button label={t('note.ask')} icon="chatbubble-ellipses-outline" variant="secondary" onPress={handleAsk} />
          {!isPro && <Text style={styles.allowance}>{t('common.pro')}</Text>}
        </View>
        <View style={styles.bottomButton}>
          <Button
            label={generating ? t('note.writing') : note.summary ? t('note.newSummary') : t('note.summarize')}
            icon="sparkles"
            loading={generating}
            disabled={generating}
            onPress={() => void handleSummarize()}
          />
          {!isPro && typeof allowance.remaining === 'number' && (
            <Text style={styles.allowance}>
              {allowance.remaining > 0
                ? t('note.freeLeft', { count: allowance.remaining, total: FREE_SUMMARIES_PER_WEEK })
                : t('note.unlimitedWithPro')}
            </Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function EnhancementBanner({
  note,
  colors,
  styles,
  t,
  onCancel,
}: {
  note: Note;
  colors: typeof Colors.light;
  styles: ReturnType<typeof createStyles>;
  t: Translate;
  onCancel: () => void;
}) {
  // Ticks come from memory, not the note row, so they redraw this banner only.
  const progress = useEnhanceProgress(note.id);
  const known = progress !== null && progress.fraction >= 0;
  const pct = known ? Math.round(progress.fraction * 100) : 0;
  const label =
    note.enhancement === 'pending' || !progress
      ? t('note.transcribeWaiting')
      : progress.phase === 'model'
        ? t('note.downloadingModel', { percent: pct })
        : known
          ? t('note.transcribingPercent', { percent: pct })
          : t('note.transcribingShort');
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Ionicons name="sparkles" size={16} color={colors.tint} />
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.bannerText}>{label}</Text>
        <View style={styles.bannerTrack}>
          <View style={[styles.bannerFill, { width: known ? `${pct}%` : '35%' }]} />
        </View>
      </View>
      <IconButton name="close" size={14} background="transparent" onPress={onCancel} accessibilityLabel={t('note.cancelTranscription')} />
    </View>
  );
}

const PHASE_LABEL: Record<Exclude<summarizer.SummaryPhase, 'idle'>, TKey> = {
  'loading-model': 'summary.phase.loading',
  summarizing: 'summary.phase.reading',
  merging: 'summary.phase.merging',
  titling: 'summary.phase.titling',
  answering: 'summary.phase.answering',
};

function SummaryProgress({
  state,
  colors,
  styles,
  t,
  onStop,
}: {
  state: summarizer.SummaryState;
  colors: typeof Colors.light;
  styles: ReturnType<typeof createStyles>;
  t: Translate;
  onStop: () => void;
}) {
  const phase = state.phase === 'idle' ? 'summarizing' : state.phase;
  const label =
    state.phase === 'loading-model' && state.downloadProgress > 0 && state.downloadProgress < 1
      ? t('summary.phase.downloading', { percent: Math.round(state.downloadProgress * 100) })
      : state.step
        ? t('summary.phase.part', { label: t(PHASE_LABEL[phase]), index: state.step.index, total: state.step.total })
        : t(PHASE_LABEL[phase]);
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Ionicons name="sparkles" size={16} color={colors.tint} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.bannerText}>{label}</Text>
        {state.partial ? (
          <Text style={styles.partialText} numberOfLines={4}>
            {state.partial}
          </Text>
        ) : null}
      </View>
      <IconButton name="stop" size={14} background="transparent" onPress={onStop} accessibilityLabel={t('summary.stop')} />
    </View>
  );
}

function SummaryView({
  summary,
  language,
  colors,
  styles,
  t,
}: {
  summary: NoteSummary;
  language: string | null;
  colors: typeof Colors.light;
  styles: ReturnType<typeof createStyles>;
  t: Translate;
}) {
  const toast = useToast();
  const copy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    void haptic('success');
    toast.show({ message: t('common.copied'), tone: 'success', durationMs: 1500 });
  };
  // The summary may be in another language than the transcript (Pro), so its direction is read from its own text.
  const sample = summary.overview || summary.keyPoints.join(' ');
  const direction = contentDirection(sample ? isRtlText(sample, null) : isRtlText('', language));
  const sections: { title: string; icon: React.ComponentProps<typeof Ionicons>['name']; items: string[] }[] = [
    { title: t('export.label.keyPoints'), icon: 'list-outline', items: summary.keyPoints },
    { title: t('export.label.actionItems'), icon: 'checkbox-outline', items: summary.actionItems },
    { title: t('export.label.decisions'), icon: 'git-commit-outline', items: summary.decisions },
  ];
  const style = isSummaryStyle(summary.style) && isProStyle(summary.style) ? t(STYLE_LABELS[summary.style]) : null;
  const allText = [
    summary.overview,
    ...sections.filter((s) => s.items.length).map((s) => `${s.title}\n${s.items.map((i) => `- ${i}`).join('\n')}`),
  ].join('\n\n');

  return (
    <View style={{ gap: Spacing.md, paddingBottom: Spacing.xxl }}>
      <Card style={styles.summaryCard} elevation="none">
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryLabel}>{style ? `${t('summary.overview')} · ${style}` : t('summary.overview')}</Text>
          <IconButton name="copy-outline" size={16} background={colors.surface} onPress={() => copy(allText)} accessibilityLabel={t('summary.copy')} />
        </View>
        <Text style={[styles.summaryText, direction]} selectable>
          {summary.overview}
        </Text>
      </Card>
      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => (
          <Card key={section.title} style={styles.summaryCard} elevation="none">
            <View style={styles.summaryHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                <Ionicons name={section.icon} size={16} color={colors.tint} />
                <Text style={styles.summaryLabel}>{section.title}</Text>
              </View>
            </View>
            {section.items.map((item, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={[styles.bullet, { backgroundColor: colors.tint }]} />
                <Text style={[styles.summaryText, direction]} selectable>
                  {item}
                </Text>
              </View>
            ))}
          </Card>
        ))}
      <Text style={styles.aiNote}>{t('summary.aiNote')}</Text>
    </View>
  );
}

/**
 * One paragraph of the tappable transcript. Memoized on `activeIndex`, so a
 * playback tick re-renders only the paragraph being spoken.
 */
const TranscriptParagraphView = React.memo(function TranscriptParagraphView({
  paragraph,
  activeIndex,
  onWordPress,
  textStyle,
  activeStyle,
  separator,
}: {
  paragraph: TranscriptParagraph;
  /** Index of the word being spoken, or -1 when playback is elsewhere. */
  activeIndex: number;
  onWordPress: (word: TranscriptWord) => void;
  textStyle: object[];
  activeStyle: object;
  separator: string;
}) {
  return (
    <Text style={textStyle}>
      {paragraph.words.map((word, index) => (
        <React.Fragment key={`${index}-${word.start}`}>
          {index > 0 ? separator : ''}
          <Text onPress={() => onWordPress(word)} suppressHighlighting style={index === activeIndex ? activeStyle : undefined}>
            {word.word.trim()}
          </Text>
        </React.Fragment>
      ))}
    </Text>
  );
});

/**
 * Tappable transcript with the spoken word highlighted. Subscribes to the
 * player itself so playback ticks re-render only this subtree, and within it
 * only the paragraph being spoken.
 */
function TimelineTranscript({
  player,
  segments,
  styles,
  hint,
  textDirection,
  unspaced,
}: {
  player: AudioPlayer;
  segments: TranscriptSegment[];
  styles: ReturnType<typeof createStyles>;
  hint: string;
  textDirection: object;
  unspaced: boolean;
}) {
  const status = useAudioPlayerStatus(player);
  const paragraphs = useMemo(() => buildParagraphs(segments), [segments]);
  const time = status.currentTime;
  const activeParagraph = paragraphAt(paragraphs, time);
  const activeWord =
    activeParagraph >= 0
      ? paragraphs[activeParagraph].words.findIndex((word) => time >= word.start && time < word.end)
      : -1;

  const playingRef = useRef(status.playing);
  playingRef.current = status.playing;
  const handleWordPress = useCallback(
    (word: TranscriptWord) => {
      void player.seekTo(word.start);
      if (!playingRef.current) player.play();
      void haptic('light');
    },
    [player]
  );
  const textStyle = useMemo(() => [styles.paragraph, textDirection], [styles, textDirection]);

  return (
    <View style={styles.timeline}>
      <Text style={styles.timelineHint}>{hint}</Text>
      {paragraphs.map((paragraph, index) => (
        <TranscriptParagraphView
          key={`${index}-${paragraph.start}`}
          paragraph={paragraph}
          activeIndex={index === activeParagraph ? activeWord : -1}
          onWordPress={handleWordPress}
          textStyle={textStyle}
          activeStyle={styles.activeWord}
          separator={unspaced ? '' : ' '}
        />
      ))}
    </View>
  );
}

function NotePlayer({
  noteId,
  audioUri,
  player,
  colors,
  t,
}: {
  noteId: string;
  audioUri: string;
  player: AudioPlayer;
  colors: typeof Colors.light;
  t: Translate;
}) {
  const status = useAudioPlayerStatus(player);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadPeaks(noteId, audioUri).then((p) => !cancelled && setPeaks(p ? normalizePeaks(p) : null));
    return () => {
      cancelled = true;
    };
  }, [noteId, audioUri]);

  // Without this, play after the end appeared to do nothing.
  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [status.didJustFinish, player]);

  const duration = status.duration || 0;
  const progress = duration > 0 ? Math.min(1, Math.max(0, status.currentTime / duration)) : 0;
  const bars = peaks ?? Array.from({ length: PEAK_COUNT }, () => 0.12);

  const seekToRatio = useCallback(
    (ratio: number) => {
      if (duration <= 0) return;
      void player.seekTo(Math.min(duration, Math.max(0, ratio * duration)));
    },
    [player, duration]
  );

  // The bars run right to left in an RTL layout, so the touch position is mirrored too.
  const rtl = I18nManager.isRTL;
  const scrub = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      if (width > 0) runOnJS(seekToRatio)(rtl ? 1 - e.x / width : e.x / width);
    })
    .onUpdate((e) => {
      if (width > 0) runOnJS(seekToRatio)(rtl ? 1 - e.x / width : e.x / width);
    })
    .onEnd(() => {
      runOnJS(haptic)('selection');
    });

  const cycleSpeed = () => {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    player.setPlaybackRate(SPEEDS[next]);
  };

  const skip = (delta: number) => {
    seekToRatio((status.currentTime + delta) / Math.max(duration, 1));
    void haptic('selection');
  };

  return (
    <Card style={styles.playerCard}>
      <GestureDetector gesture={scrub}>
        <View
          style={styles.waveRow}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          accessibilityRole="adjustable"
          accessibilityLabel={t('player.position')}
          accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(status.currentTime) }}
        >
          {bars.map((h, i) => (
            <View
              key={i}
              style={[
                styles.waveBar,
                {
                  height: 4 + h * 32,
                  backgroundColor: (i + 0.5) / bars.length <= progress ? colors.tint : colors.border,
                },
              ]}
            />
          ))}
        </View>
      </GestureDetector>

      <View style={styles.playerControls}>
        <Text style={styles.playerTime}>
          {formatClock(status.currentTime)}
          <Text style={{ color: colors.textMuted }}> / {formatClock(duration)}</Text>
        </Text>
        <View style={styles.playerButtons}>
          <IconButton name="play-back" size={18} background={colors.surface} onPress={() => skip(-SKIP_SECONDS)} accessibilityLabel={t('player.back', { seconds: SKIP_SECONDS })} haptic="none" />
          <AnimatedPressable
            haptic="light"
            onPress={() => (status.playing ? player.pause() : player.play())}
            style={[styles.playButton, { backgroundColor: colors.tint }]}
            accessibilityRole="button"
            accessibilityLabel={status.playing ? t('player.pause') : t('player.play')}
          >
            <Ionicons name={status.playing ? 'pause' : 'play'} size={22} color={colors.onAccent} />
          </AnimatedPressable>
          <IconButton name="play-forward" size={18} background={colors.surface} onPress={() => skip(SKIP_SECONDS)} accessibilityLabel={t('player.forward', { seconds: SKIP_SECONDS })} haptic="none" />
        </View>
        <AnimatedPressable haptic="selection" onPress={cycleSpeed} style={styles.speedChip} accessibilityRole="button" accessibilityLabel={t('player.speed')}>
          <Text style={styles.speedText}>{SPEEDS[speedIndex]}×</Text>
        </AnimatedPressable>
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
    topBarActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
    titleInput: { flex: 1, fontSize: FontSize.xl, fontWeight: '800', color: colors.text, paddingVertical: Spacing.xs },
    metaText: { fontSize: FontSize.sm, color: colors.textMuted, marginBottom: Spacing.lg },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: `${colors.tint}14`,
      borderRadius: Radius.md,
      padding: Spacing.md,
      marginBottom: Spacing.lg,
    },
    bannerText: { color: colors.text, fontSize: FontSize.sm, fontWeight: '600' },
    bannerTrack: { height: 4, borderRadius: 2, backgroundColor: `${colors.tint}26`, overflow: 'hidden' },
    bannerFill: { height: 4, borderRadius: 2, backgroundColor: colors.tint },
    playerCard: { marginBottom: Spacing.lg, gap: Spacing.md },
    waveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 40 },
    waveBar: { width: 3, borderRadius: 2 },
    playerControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    playerButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
    playButton: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
    playerTime: { fontSize: FontSize.sm, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 84 },
    speedChip: {
      minWidth: 48,
      alignItems: 'center',
      paddingVertical: 6,
      borderRadius: Radius.pill,
      backgroundColor: colors.surface,
    },
    speedText: { fontSize: FontSize.sm, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
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
    segment: { marginBottom: Spacing.lg },
    summaryCard: { backgroundColor: colors.card, gap: Spacing.sm, borderWidth: 1, borderColor: colors.border },
    summaryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    summaryLabel: { fontSize: FontSize.xs, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
    summaryText: { flex: 1, fontSize: FontSize.md, lineHeight: 23, color: colors.text },
    bulletRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
    bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
    aiNote: { fontSize: FontSize.xs, color: colors.textMuted, textAlign: 'center' },
    timelineHint: {
      fontSize: FontSize.xs,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      fontWeight: '700',
      marginBottom: Spacing.sm,
    },
    activeWord: { color: colors.tint, fontWeight: '700', backgroundColor: `${colors.tint}1A` },
    timeline: { minHeight: 200, paddingBottom: Spacing.xxl },
    paragraph: { fontSize: FontSize.md, lineHeight: 25, color: colors.text, marginBottom: Spacing.md },
    transcriptionInput: {
      fontSize: FontSize.md,
      lineHeight: 25,
      color: colors.text,
      minHeight: 200,
      paddingBottom: Spacing.xxl,
    },
    bottomBar: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.md,
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    bottomButton: { flex: 1 },
    bottomIcon: { width: 48, height: 48 },
    allowance: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
    partialText: { fontSize: FontSize.sm, color: colors.textMuted, lineHeight: 19 },
  });
}
