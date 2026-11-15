/**
 * Language picker, used three ways (`?kind=`): the interface language, the
 * language recordings are transcribed in, and the language summaries are
 * written in. Languages are listed under their own names, so the list reads
 * the same whatever the interface is set to.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ModalHeader from '@/components/ui/ModalHeader';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { AUTO_LANGUAGE, LANGUAGES, languageInfo, languageLabel } from '@/constants/languages';
import { FontSize, Spacing } from '@/constants/Spacing';
import { usePro } from '@/hooks/usePro';
import { applyLanguagePreference, syncLayoutDirection, t as translate, useI18n } from '@/i18n';
import { APP_LANGUAGES, type LanguagePreference } from '@/i18n/languages';
import { prefetchSpeechModel } from '@/services/ai/modelPrefetch';
import { haptic } from '@/services/haptics';
import { updateSettings, useSettings } from '@/services/settings';
import { SUMMARY_LANGUAGE_APP, SUMMARY_LANGUAGE_TRANSCRIPT } from '@/services/settingsModel';

type Kind = 'app' | 'transcription' | 'summary';

interface Option {
  value: string;
  label: string;
  detail?: string;
}

const languageOptions = (codes: readonly string[]): Option[] =>
  codes.map((code) => {
    const info = languageInfo(code);
    return { value: code, label: info?.endonym ?? code, detail: info && info.name !== info.endonym ? info.name : undefined };
  });

export default function LanguageScreen() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const mode: Kind = kind === 'transcription' || kind === 'summary' ? kind : 'app';
  const colors = Colors[useColorScheme() ?? 'light'];
  const router = useRouter();
  const toast = useToast();
  const { t, language } = useI18n();
  const { isPro } = usePro();
  const [settings] = useSettings();
  const [query, setQuery] = useState('');

  const selected =
    mode === 'app' ? settings.appLanguage : mode === 'transcription' ? settings.transcriptionLanguage : settings.summaryLanguage;

  const options = useMemo<Option[]>(() => {
    const all = LANGUAGES.map((l) => l.code);
    if (mode === 'app') {
      return [{ value: 'system', label: t('lang.system'), detail: t('lang.systemDetail') }, ...languageOptions(APP_LANGUAGES)];
    }
    if (mode === 'transcription') {
      return [
        { value: AUTO_LANGUAGE, label: t('common.automatic'), detail: t('lang.autoDetail', { language: languageLabel(language) }) },
        ...languageOptions(all),
      ];
    }
    return [
      { value: SUMMARY_LANGUAGE_TRANSCRIPT, label: t('lang.sameAsTranscript'), detail: t('lang.sameAsTranscriptDetail') },
      { value: SUMMARY_LANGUAGE_APP, label: t('lang.appLanguage'), detail: languageLabel(language) },
      ...languageOptions(all),
    ];
  }, [mode, t, language]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(needle) || o.detail?.toLowerCase().includes(needle) || o.value === needle
    );
  }, [options, query]);

  const choose = async (value: string) => {
    void haptic('selection');
    if (mode === 'summary' && !isPro && value !== SUMMARY_LANGUAGE_TRANSCRIPT) {
      router.replace('/paywall');
      return;
    }
    if (mode === 'app') {
      await updateSettings({ appLanguage: value as LanguagePreference });
      applyLanguagePreference(value as LanguagePreference);
      // The message is read in the language just chosen.
      if (syncLayoutDirection()) toast.show({ message: translate('lang.restartForDirection'), durationMs: 7000 });
    } else if (mode === 'transcription') {
      await updateSettings({ transcriptionLanguage: value });
    } else {
      await updateSettings({ summaryLanguage: value });
    }
    // "Automatic" transcription follows the interface language, so either may need the model.
    if (mode !== 'summary') prefetchSpeechModel();
    router.back();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ModalHeader
        variant="close"
        title={mode === 'app' ? t('lang.title.app') : mode === 'transcription' ? t('lang.title.transcription') : t('lang.title.summary')}
      />
      <View style={styles.search}>
        <TextField
          icon="search"
          placeholder={t('common.search')}
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {mode === 'transcription' && <Text style={[styles.note, { color: colors.textMuted }]}>{t('lang.transcriptionNote')}</Text>}
      </View>
      <FlatList
        data={visible}
        keyExtractor={(o) => o.value}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        initialNumToRender={20}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
        renderItem={({ item }) => {
          const isSelected = item.value === selected;
          return (
            <Pressable
              onPress={() => void choose(item.value)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={item.detail ? `${item.label}, ${item.detail}` : item.label}
            >
              <View style={styles.rowText}>
                <Text style={[styles.label, { color: colors.text }]}>{item.label}</Text>
                {item.detail ? <Text style={[styles.detail, { color: colors.textMuted }]}>{item.detail}</Text> : null}
              </View>
              {isSelected && <Ionicons name="checkmark" size={20} color={colors.tint} />}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  search: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.sm, gap: Spacing.sm },
  note: { fontSize: FontSize.xs, lineHeight: 17 },
  list: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: Spacing.sm, borderRadius: 12, gap: Spacing.md },
  rowText: { flex: 1, paddingVertical: Spacing.sm },
  label: { fontSize: FontSize.md, fontWeight: '600' },
  detail: { fontSize: FontSize.sm, marginTop: 1 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.sm },
});
