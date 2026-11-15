/**
 * Ask a note (Pro): questions about one note, answered on this phone from
 * its transcript. The conversation lives only on this screen; nothing is
 * stored and nothing is sent anywhere.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { contentDirection } from '@/components/textDirection';
import Chip from '@/components/ui/Chip';
import EmptyState from '@/components/ui/EmptyState';
import IconButton from '@/components/ui/IconButton';
import ModalHeader from '@/components/ui/ModalHeader';
import { useToast } from '@/components/ui/Toast';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { useNote } from '@/hooks/useNote';
import { usePro } from '@/hooks/usePro';
import { useSummaryState } from '@/hooks/useSummaryState';
import { useI18n, type TKey } from '@/i18n';
import { MAX_QUESTION_CHARS, type QaTurn } from '@/services/ai/ask';
import * as summarizer from '@/services/ai/summarizer';
import { haptic } from '@/services/haptics';
import { countWords, isRtlText } from '@/services/text';

const SUGGESTIONS: TKey[] = ['ask.suggest.actions', 'ask.suggest.decisions', 'ask.suggest.brief', 'ask.suggest.next'];

export default function AskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const { isPro, loading: proLoading } = usePro();
  const { note, loading } = useNote(id);
  const state = useSummaryState(id);

  const [turns, setTurns] = useState<QaTurn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const mounted = useRef(true);
  // True only while this screen's own question is running, so leaving never
  // interrupts a summary being written for the same note.
  const asking = useRef(false);
  useEffect(
    () => () => {
      mounted.current = false;
      // Leaving mid-answer: don't keep the model busy for a screen that's gone.
      if (id && asking.current) summarizer.stop(id);
    },
    [id]
  );

  // Reached without Pro (deep link, restored navigation state): go to the paywall instead.
  useEffect(() => {
    if (!proLoading && !isPro) router.replace('/paywall');
  }, [proLoading, isPro, router]);

  const busy = pending !== null;
  const answering = busy && state.phase === 'answering';

  const send = async (text: string) => {
    const question = text.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_CHARS);
    if (!question || busy || !id) return;
    setDraft('');
    setPending(question);
    asking.current = true;
    void haptic('selection');
    try {
      const answer = await summarizer.ask(id, question, turns);
      if (!mounted.current) return;
      setTurns((previous) => [...previous, { question, answer: answer || t('ask.noAnswer') }]);
      void haptic('success');
    } catch (error) {
      console.warn('Ask failed:', error);
      if (mounted.current) toast.show({ message: t('ask.failed'), tone: 'error' });
    } finally {
      asking.current = false;
      if (mounted.current) setPending(null);
    }
  };

  const copy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    void haptic('success');
    toast.show({ message: t('common.copied'), tone: 'success', durationMs: 1500 });
  };

  if (loading || !note) {
    return (
      <SafeAreaView style={styles.container}>
        <ModalHeader variant="close" title={t('ask.title')} />
        {!loading && <EmptyState icon="document-outline" title={t('note.notFoundTitle')} subtitle={t('note.notFoundBody')} />}
      </SafeAreaView>
    );
  }

  const empty = countWords(note.transcription) < 5;
  const loadingLabel =
    state.phase === 'loading-model' && state.downloadProgress > 0 && state.downloadProgress < 1
      ? t('summary.phase.downloading', { percent: Math.round(state.downloadProgress * 100) })
      : state.phase === 'loading-model'
        ? t('summary.phase.loading')
        : t('summary.phase.answering');

  return (
    <SafeAreaView style={styles.container}>
      <ModalHeader variant="close" title={t('ask.title')} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          <View style={styles.intro}>
            <Text style={styles.noteTitle} numberOfLines={2}>
              {note.title}
            </Text>
            <Text style={styles.muted}>{empty ? t('ask.emptyNote') : t('ask.intro')}</Text>
          </View>

          {turns.length === 0 && !busy && !empty && (
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((key) => (
                <Chip key={key} label={t(key)} tone="tint" onPress={() => void send(t(key))} />
              ))}
            </View>
          )}

          {turns.map((turn, index) => (
            <View key={index} style={styles.turn}>
              <View style={styles.question}>
                <Text style={[styles.questionText, contentDirection(isRtlText(turn.question))]}>{turn.question}</Text>
              </View>
              <View style={styles.answer}>
                <Text style={[styles.answerText, contentDirection(isRtlText(turn.answer))]} selectable>
                  {turn.answer}
                </Text>
                <IconButton
                  name="copy-outline"
                  size={14}
                  background="transparent"
                  onPress={() => void copy(turn.answer)}
                  accessibilityLabel={t('ask.copyAnswer')}
                  style={styles.copy}
                />
              </View>
            </View>
          ))}

          {busy && (
            <View style={styles.turn}>
              <View style={styles.question}>
                <Text style={[styles.questionText, contentDirection(isRtlText(pending ?? ''))]}>{pending}</Text>
              </View>
              <View style={styles.answer} accessibilityLiveRegion="polite">
                {answering && state.partial ? (
                  <Text style={[styles.answerText, contentDirection(isRtlText(state.partial))]}>{state.partial}</Text>
                ) : (
                  <Text style={styles.muted}>{loadingLabel}</Text>
                )}
              </View>
            </View>
          )}
        </ScrollView>

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={t('ask.placeholder')}
            placeholderTextColor={colors.textMuted}
            editable={!empty}
            multiline
            maxLength={MAX_QUESTION_CHARS}
            returnKeyType="send"
            submitBehavior="submit"
            onSubmitEditing={() => void send(draft)}
            accessibilityLabel={t('ask.placeholder')}
          />
          {busy ? (
            <IconButton
              name="stop"
              color={colors.onAccent}
              background={colors.danger}
              onPress={() => id && summarizer.stop(id)}
              accessibilityLabel={t('summary.stop')}
            />
          ) : (
            <IconButton
              name="arrow-up"
              color={colors.onAccent}
              background={colors.tint}
              onPress={() => void send(draft)}
              accessibilityLabel={t('ask.send')}
              style={!draft.trim() || empty ? styles.sendDisabled : undefined}
            />
          )}
        </View>
        <View style={styles.footer}>
          <Ionicons name="lock-closed-outline" size={12} color={colors.textMuted} />
          <Text style={styles.footerText}>{t('ask.privacy')}</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    content: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl, gap: Spacing.lg },
    intro: { gap: Spacing.xs },
    noteTitle: { fontSize: FontSize.lg, fontWeight: '800', color: colors.text },
    muted: { fontSize: FontSize.sm, color: colors.textMuted, lineHeight: 20 },
    suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    turn: { gap: Spacing.sm },
    question: {
      alignSelf: 'flex-end',
      maxWidth: '88%',
      backgroundColor: colors.tint,
      borderRadius: Radius.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    questionText: { color: colors.onAccent, fontSize: FontSize.md, lineHeight: 22, fontWeight: '600' },
    answer: {
      alignSelf: 'flex-start',
      maxWidth: '94%',
      backgroundColor: colors.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    answerText: { color: colors.text, fontSize: FontSize.md, lineHeight: 23 },
    copy: { alignSelf: 'flex-end', marginTop: -4, marginRight: -8, marginBottom: -6 },
    inputBar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: 10,
      color: colors.text,
      fontSize: FontSize.md,
    },
    sendDisabled: { opacity: 0.4 },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingVertical: Spacing.sm,
    },
    footerText: { fontSize: 11, color: colors.textMuted },
  });
}
