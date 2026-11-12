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
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { languageLabel } from '@/constants/languages';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { useNote } from '@/hooks/useNote';
import { usePro } from '@/hooks/usePro';
import { useSummaryState } from '@/hooks/useSummaryState';
import * as enhanceQueue from '@/services/ai/enhanceQueue';
import * as summarizer from '@/services/ai/summarizer';
import { summaryAllowance } from '@/services/billing/quota';
import { useSettings } from '@/services/settings';
import * as notesRepo from '@/services/db/notesRepo';
import { ExportPanel } from '@/components/ExportSheet';
import { formatClock, formatNoteDate } from '@/services/export/generators';
import { haptic } from '@/services/haptics';
import { deleteTimeline } from '@/services/timelineStore';
import { normalizePeaks } from '@/services/waveform';
import { PEAK_COUNT, loadPeaks } from '@/services/waveformStore';
import type { Note, NoteSummary, TranscriptSegment, TranscriptWord } from '@/types';

const AUTOSAVE_DELAY_MS = 800;
// The player's own default is 500ms, which is too coarse to track a spoken
// word — highlighting visibly lags the audio at that rate.
const PLAYBACK_UPDATE_INTERVAL_MS = 100;
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
const SKIP_SECONDS = 15;

type Tab = 'summary' | 'transcript';

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheet = useActionSheet();
  const toast = useToast();

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

  // What the fields last held when they matched storage. An incoming update
  // only replaces a field the user hasn't changed since — so a transcript
  // enhanced in the background never overwrites a correction being typed.
  const syncedRef = useRef<{ title: string; transcription: string } | null>(null);

  useEffect(() => {
    if (!note) return;
    const synced = syncedRef.current;
    if (!synced || title === synced.title) setTitle(note.title);
    if (!synced || transcription === synced.transcription) setTranscription(note.transcription);
    setTags(note.tags);
    syncedRef.current = { title: note.title, transcription: note.transcription };
    // Open on the summary once one exists for this note.
    if (!synced && note.summary) setTab('summary');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);

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
        toast.show({ message: 'Could not save your changes.', tone: 'error' });
      });
    },
    [id, toast]
  );

  const persistFields = useCallback(() => {
    const fields = latestFieldsRef.current;
    syncedRef.current = { ...fields };
    persist({
      title: fields.title.trim() || 'Untitled note',
      transcription: fields.transcription,
      ...(dirtyTitleRef.current ? { titleIsAuto: false } : {}),
    });
  }, [persist]);

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
          message: `Deleted “${deleted.title}”`,
          action: { label: 'Undo', onPress: () => void notesRepo.restoreNote(deleted) },
          onDismiss: () => notesRepo.purgeNoteFiles(deleted),
          durationMs: 5000,
        });
      }
    } catch (error) {
      console.error('Failed to delete note:', error);
      toast.show({ message: 'Could not delete the note.', tone: 'error' });
    }
  };

  const currentNote = (): Note | null => (note ? { ...note, title, transcription, tags } : null);

  const handleShare = () => {
    const n = currentNote();
    if (!n) return;
    flushPendingSave();
    sheet.open({
      title: 'Export & share',
      content: <ExportPanel note={n} isPro={isPro} hasTimeline={hasTimeline} />,
      actions: [],
    });
  };

  const handleSummarize = async () => {
    if (!note || generating) return;
    if (transcription.trim().split(/\s+/).length < 25) {
      toast.show({ message: 'Record a little more to get a useful summary.' });
      return;
    }
    if (!allowance.allowed) {
      router.push('/paywall');
      return;
    }
    flushPendingSave();
    try {
      await summarizer.summarize(note.id);
      void haptic('success');
      setTab('summary');
    } catch (error) {
      console.warn('Summary failed:', error);
      toast.show({ message: 'Could not write a summary. Try again.', tone: 'error' });
    }
  };

  const handleRegenerateTitle = async () => {
    if (!note || generating) return;
    flushPendingSave();
    dirtyTitleRef.current = false;
    try {
      await summarizer.generateTitle(note.id, true);
      void haptic('success');
    } catch (error) {
      console.warn('Title failed:', error);
      toast.show({ message: 'Could not write a title. Try again.', tone: 'error' });
    }
  };

  const handleMore = () =>
    sheet.open({
      title: title || 'Note',
      actions: [
        ...(note?.audioUri && note.enhancement !== 'pending' && note.enhancement !== 'running'
          ? [
              {
                label: 'Re-transcribe audio',
                icon: 'sparkles-outline' as const,
                onPress: () => {
                  flushPendingSave();
                  void enhanceQueue.enqueue(note.id, 'enhance');
                  toast.show({ message: 'Re-transcribing with your best model…' });
                },
              },
            ]
          : []),
        { label: 'Write a new title with AI', icon: 'sparkles-outline', onPress: handleRegenerateTitle },
        {
          label: 'Duplicate',
          icon: 'copy-outline',
          onPress: async () => {
            const n = currentNote();
            if (!n) return;
            const now = new Date();
            await notesRepo.createNote({
              ...n,
              id: now.getTime().toString(),
              title: `${n.title} (copy)`,
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
            toast.show({ message: 'Note duplicated (text only).', tone: 'success' });
          },
        },
        { label: 'Delete note', icon: 'trash-outline', destructive: true, onPress: handleDelete },
      ],
    });

  if (loading) {
    return <SafeAreaView style={styles.container} />;
  }

  if (!note) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState icon="document-outline" title="Note not found" subtitle="It may have been deleted.">
          <Button label="Go back" variant="secondary" onPress={() => router.back()} />
        </EmptyState>
      </SafeAreaView>
    );
  }

  const enhancing = note.enhancement === 'pending' || note.enhancement === 'running';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <IconButton name="chevron-back" onPress={() => router.back()} background={colors.surface} accessibilityLabel="Back" />
        <View style={styles.topBarActions}>
          {hasTimeline && tab === 'transcript' && (
            <IconButton
              name={mode === 'listen' ? 'create-outline' : 'headset-outline'}
              color={colors.tint}
              background={colors.surface}
              accessibilityLabel={mode === 'listen' ? 'Edit transcript' : 'Listen mode'}
              onPress={() => setMode((current) => (current === 'listen' ? 'edit' : 'listen'))}
            />
          )}
          <IconButton
            name={note.pinned ? 'bookmark' : 'bookmark-outline'}
            color={colors.tint}
            background={note.pinned ? `${colors.tint}1A` : colors.surface}
            accessibilityLabel={note.pinned ? 'Unpin' : 'Pin'}
            onPress={handleTogglePin}
            haptic="none"
          />
          <IconButton name="ellipsis-horizontal" background={colors.surface} onPress={handleMore} accessibilityLabel="More" />
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
                style={styles.titleInput}
                value={title}
                onChangeText={handleTitleChange}
                placeholder="Note title"
                placeholderTextColor={colors.textMuted}
                multiline
                accessibilityLabel="Title"
              />
              {note.titleIsAuto && (
                <IconButton
                  name="sparkles"
                  size={14}
                  color={colors.tint}
                  background="transparent"
                  onPress={handleRegenerateTitle}
                  accessibilityLabel="Title written by AI. Tap to write a new one."
                />
              )}
            </View>

            <Text style={styles.metaText}>
              {formatNoteDate(note.createdAt)}
              {note.duration > 0 ? ` · ${formatClock(note.duration)}` : ''}
              {note.language ? ` · ${languageLabel(note.language)}` : ''}
              {note.source === 'import' ? ' · Imported' : ''}
            </Text>

            {enhancing && (
              <EnhancementBanner note={note} colors={colors} styles={styles} onCancel={() => void enhanceQueue.cancel(note.id, 'enhance')} />
            )}

            {note.audioUri && <NotePlayer noteId={note.id} audioUri={note.audioUri} player={player} colors={colors} />}

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
                  submitBehavior="submit"
                  returnKeyType="done"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="New tag"
                />
                <IconButton name="add" size={18} color={colors.onAccent} background={colors.tint} onPress={handleAddTag} accessibilityLabel="Add tag" />
              </View>
            </View>

            {generating && (
              <SummaryProgress state={summaryState} colors={colors} styles={styles} onStop={() => summarizer.stop(note.id)} />
            )}

            {note.summary && (
              <View style={styles.segment}>
                <SegmentedControl
                  options={[
                    { value: 'summary', label: 'Summary' },
                    { value: 'transcript', label: 'Transcript' },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
              </View>
            )}

            {tab === 'summary' && note.summary ? (
              <SummaryView summary={note.summary} colors={colors} styles={styles} />
            ) : hasTimeline && mode === 'listen' && timeline ? (
              <TimelineTranscript player={player} segments={timeline} styles={styles} />
            ) : (
              <TextInput
                style={styles.transcriptionInput}
                value={transcription}
                onChangeText={handleTranscriptionChange}
                multiline
                scrollEnabled={false}
                textAlignVertical="top"
                placeholder="Transcript"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Transcript"
              />
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.bottomBar}>
        <Button label="Share" icon="share-outline" variant="secondary" onPress={handleShare} style={styles.bottomButton} />
        <View style={styles.bottomButton}>
          <Button
            label={generating ? 'Writing…' : note.summary ? 'New summary' : 'Summarize'}
            icon="sparkles"
            loading={generating}
            disabled={generating}
            onPress={handleSummarize}
          />
          {!isPro && typeof allowance.remaining === 'number' && (
            <Text style={styles.allowance}>
              {allowance.remaining > 0 ? `${allowance.remaining} of 3 free this week` : 'Unlimited with Pro'}
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
  onCancel,
}: {
  note: Note;
  colors: typeof Colors.light;
  styles: ReturnType<typeof createStyles>;
  onCancel: () => void;
}) {
  const known = note.enhancement === 'running' && note.enhancementProgress >= 0;
  const pct = Math.round(Math.max(0, Math.min(1, note.enhancementProgress)) * 100);
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Ionicons name="sparkles" size={16} color={colors.tint} />
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.bannerText}>
          {note.enhancement === 'pending' ? 'Waiting to enhance transcript…' : `Enhancing transcript${known ? ` · ${pct}%` : '…'}`}
        </Text>
        <View style={styles.bannerTrack}>
          <View style={[styles.bannerFill, { width: known ? `${pct}%` : '35%' }]} />
        </View>
      </View>
      <IconButton name="close" size={14} background="transparent" onPress={onCancel} accessibilityLabel="Cancel enhancement" />
    </View>
  );
}

const PHASE_LABEL: Record<string, string> = {
  'loading-model': 'Loading the summary model…',
  summarizing: 'Reading your transcript…',
  merging: 'Putting it together…',
  titling: 'Writing a title…',
};

function SummaryProgress({
  state,
  colors,
  styles,
  onStop,
}: {
  state: summarizer.SummaryState;
  colors: typeof Colors.light;
  styles: ReturnType<typeof createStyles>;
  onStop: () => void;
}) {
  const label =
    state.phase === 'loading-model' && state.downloadProgress > 0 && state.downloadProgress < 1
      ? `Downloading the summary model… ${Math.round(state.downloadProgress * 100)}%`
      : state.step
        ? `${PHASE_LABEL[state.phase]} (part ${state.step.index} of ${state.step.total})`
        : PHASE_LABEL[state.phase];
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
      <IconButton name="stop" size={14} background="transparent" onPress={onStop} accessibilityLabel="Stop" />
    </View>
  );
}

function SummaryView({
  summary,
  colors,
  styles,
}: {
  summary: NoteSummary;
  colors: typeof Colors.light;
  styles: ReturnType<typeof createStyles>;
}) {
  const toast = useToast();
  const copy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    void haptic('success');
    toast.show({ message: 'Copied', tone: 'success', durationMs: 1500 });
  };
  const sections: { title: string; icon: React.ComponentProps<typeof Ionicons>['name']; items: string[] }[] = [
    { title: 'Key points', icon: 'list-outline', items: summary.keyPoints },
    { title: 'Action items', icon: 'checkbox-outline', items: summary.actionItems },
    { title: 'Decisions', icon: 'git-commit-outline', items: summary.decisions },
  ];
  const allText = [
    summary.overview,
    ...sections.filter((s) => s.items.length).map((s) => `${s.title}\n${s.items.map((i) => `- ${i}`).join('\n')}`),
  ].join('\n\n');

  return (
    <View style={{ gap: Spacing.md, paddingBottom: Spacing.xxl }}>
      <Card style={styles.summaryCard} elevation="none">
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryLabel}>Overview</Text>
          <IconButton name="copy-outline" size={16} background={colors.surface} onPress={() => copy(allText)} accessibilityLabel="Copy summary" />
        </View>
        <Text style={styles.summaryText} selectable>
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
                <Text style={styles.summaryText} selectable>
                  {item}
                </Text>
              </View>
            ))}
          </Card>
        ))}
      <Text style={styles.aiNote}>Written on-device by AI. Check important details against the transcript.</Text>
    </View>
  );
}

/**
 * Flattens a timeline into ordered seek targets. A segment without word
 * timings still contributes itself — a coarser target beats a gap.
 */
function flattenWords(segments: TranscriptSegment[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const segment of segments) {
    if (segment.words && segment.words.length > 0) {
      words.push(...segment.words);
    } else if (segment.text.trim().length > 0) {
      words.push({ word: segment.text.trim(), start: segment.start, end: segment.end });
    }
  }
  return words.sort((a, b) => a.start - b.start);
}

/**
 * Tappable transcript with the spoken word highlighted. Subscribes to the
 * player itself so playback ticks re-render only this subtree.
 */
function TimelineTranscript({
  player,
  segments,
  styles,
}: {
  player: AudioPlayer;
  segments: TranscriptSegment[];
  styles: ReturnType<typeof createStyles>;
}) {
  const status = useAudioPlayerStatus(player);
  const words = useMemo(() => flattenWords(segments), [segments]);
  const activeIndex = useMemo(
    () => words.findIndex((word) => status.currentTime >= word.start && status.currentTime < word.end),
    [words, status.currentTime]
  );

  const handleWordPress = (word: TranscriptWord) => {
    void player.seekTo(word.start);
    if (!status.playing) player.play();
    void haptic('light');
  };

  return (
    <View>
      <Text style={styles.timelineHint}>Tap any word to play from there</Text>
      <Text style={styles.transcriptionInput}>
        {words.map((word, index) => (
          <React.Fragment key={`${index}-${word.start}`}>
            {index > 0 ? ' ' : ''}
            <Text
              onPress={() => handleWordPress(word)}
              suppressHighlighting
              style={index === activeIndex ? styles.activeWord : undefined}
            >
              {word.word.trim()}
            </Text>
          </React.Fragment>
        ))}
      </Text>
    </View>
  );
}

function NotePlayer({
  noteId,
  audioUri,
  player,
  colors,
}: {
  noteId: string;
  audioUri: string;
  player: AudioPlayer;
  colors: typeof Colors.light;
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

  const scrub = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      if (width > 0) runOnJS(seekToRatio)(e.x / width);
    })
    .onUpdate((e) => {
      if (width > 0) runOnJS(seekToRatio)(e.x / width);
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
          accessibilityLabel="Playback position"
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
          <IconButton name="play-back" size={18} background={colors.surface} onPress={() => skip(-SKIP_SECONDS)} accessibilityLabel={`Back ${SKIP_SECONDS} seconds`} haptic="none" />
          <AnimatedPressable
            haptic="light"
            onPress={() => (status.playing ? player.pause() : player.play())}
            style={[styles.playButton, { backgroundColor: colors.tint }]}
            accessibilityRole="button"
            accessibilityLabel={status.playing ? 'Pause' : 'Play'}
          >
            <Ionicons name={status.playing ? 'pause' : 'play'} size={22} color={colors.onAccent} />
          </AnimatedPressable>
          <IconButton name="play-forward" size={18} background={colors.surface} onPress={() => skip(SKIP_SECONDS)} accessibilityLabel={`Forward ${SKIP_SECONDS} seconds`} haptic="none" />
        </View>
        <AnimatedPressable haptic="selection" onPress={cycleSpeed} style={styles.speedChip} accessibilityRole="button" accessibilityLabel="Playback speed">
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
    transcriptionInput: {
      fontSize: FontSize.md,
      lineHeight: 25,
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
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    bottomButton: { flex: 1 },
    allowance: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
    partialText: { fontSize: FontSize.sm, color: colors.textMuted, lineHeight: 19 },
  });
}
