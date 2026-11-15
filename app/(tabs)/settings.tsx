/**
 * Settings: language, AI models, transcription and summaries, feedback, Pro,
 * data, privacy and about.
 */

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import LogoMark from '@/components/brand/LogoMark';
import ScreenHeader from '@/components/ui/ScreenHeader';
import { SettingsRow, SettingsSection } from '@/components/ui/SettingsList';
import { useActionSheet } from '@/components/ui/ActionSheet';
import { useToast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { CONTACT_EMAIL, WEBSITE_URL } from '@/constants/config';
import { AUTO_LANGUAGE, languageLabel } from '@/constants/languages';
import { FontSize, Spacing } from '@/constants/Spacing';
import { STYLE_LABELS } from '@/constants/summaryStyleLabels';
import { Radius } from '@/constants/theme';
import { usePro } from '@/hooks/usePro';
import { useDeviceTier } from '@/hooks/useDeviceTier';
import { useI18n } from '@/i18n';
import { MAX_INSTRUCTIONS_CHARS, SUMMARY_STYLES, isProStyle } from '@/services/ai/summaryStyles';
import * as notesRepo from '@/services/db/notesRepo';
import { haptic } from '@/services/haptics';
import { resetSettings, useSettings } from '@/services/settings';
import { SUMMARY_LANGUAGE_APP, SUMMARY_LANGUAGE_TRANSCRIPT } from '@/services/settingsModel';
import { runImportFlow } from '@/services/import/importer';
import { NothingToBackUpError, backupAllNotes } from '@/services/export/backup';

const TIER_LABEL = { flagship: 'models.tier.flagship', standard: 'models.tier.standard', lite: 'models.tier.lite' } as const;

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const sheet = useActionSheet();
  const toast = useToast();
  const { t, tp, language } = useI18n();
  const [settings, update] = useSettings();
  const { isPro } = usePro();
  const { tier, engineLabel } = useDeviceTier();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingInstructions, setEditingInstructions] = useState(false);

  const paywall = () => router.push('/paywall');
  /** Runs the action for Pro users; shows the paywall otherwise. */
  const pro = (action: () => void) => () => (isPro ? action() : paywall());

  const pickStyle = () =>
    sheet.open({
      title: t('settings.summaryStyle'),
      message: t('summary.styleBody'),
      actions: SUMMARY_STYLES.map((style) => ({
        label: t(STYLE_LABELS[style]),
        icon: settings.summaryStyle === style ? ('checkmark' as const) : undefined,
        badge: !isPro && isProStyle(style) ? t('common.pro') : undefined,
        onPress: () => (!isPro && isProStyle(style) ? paywall() : update({ summaryStyle: style })),
      })),
    });

  const handleImport = async () => {
    const report = await runImportFlow();
    if (report) router.push({ pathname: '/import', params: { report: JSON.stringify(report) } });
  };

  const handleBackup = async () => {
    try {
      const count = await backupAllNotes();
      void haptic('success');
      toast.show({ message: tp('settings.backedUp', count), tone: 'success' });
    } catch (error) {
      if (!(error instanceof NothingToBackUpError)) console.error('Backup failed:', error);
      toast.show({
        message: error instanceof NothingToBackUpError ? t('settings.backupEmpty') : t('settings.backupFailed'),
        tone: 'error',
      });
    }
  };

  const version = Constants.expoConfig?.version ?? '1.0.0';
  const appLanguageValue = settings.appLanguage === 'system' ? t('lang.system') : languageLabel(settings.appLanguage);
  const transcriptionValue =
    settings.transcriptionLanguage === AUTO_LANGUAGE ? t('common.automatic') : languageLabel(settings.transcriptionLanguage);
  const summaryLanguageValue =
    !isPro || settings.summaryLanguage === SUMMARY_LANGUAGE_TRANSCRIPT
      ? t('lang.sameAsTranscript')
      : settings.summaryLanguage === SUMMARY_LANGUAGE_APP
        ? languageLabel(language)
        : languageLabel(settings.summaryLanguage);
  const proBadge = isPro ? undefined : t('common.pro');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader title={t('settings.title')} />

        <Animated.View entering={FadeIn.duration(250)}>
          {!isPro && (
            <Pressable
              onPress={() => {
                void haptic('selection');
                paywall();
              }}
              style={({ pressed }) => [styles.proCard, pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
            >
              <Text style={styles.proEyebrow}>{t('paywall.eyebrow')}</Text>
              <Text style={styles.proTitle}>{t('settings.proCardTitle')}</Text>
              <Text style={styles.proCta}>{t('settings.proCardCta')}</Text>
            </Pressable>
          )}

          <SettingsSection title={t('settings.section.language')} footer={t('settings.languageFooter')}>
            <SettingsRow
              icon="globe-outline"
              label={t('lang.title.app')}
              value={appLanguageValue}
              onPress={() => router.push({ pathname: '/language', params: { kind: 'app' } })}
            />
            <SettingsRow
              icon="language-outline"
              label={t('settings.transcriptionLanguage')}
              value={transcriptionValue}
              onPress={() => router.push({ pathname: '/language', params: { kind: 'transcription' } })}
            />
          </SettingsSection>

          <SettingsSection title={t('settings.section.summaries')} footer={t('settings.summariesFooter')}>
            <SettingsRow
              icon="reader-outline"
              label={t('settings.autoSummarize')}
              toggle={{ value: settings.autoSummarize, onChange: (v) => update({ autoSummarize: v }) }}
            />
            <SettingsRow
              icon="options-outline"
              label={t('settings.summaryStyle')}
              value={t(STYLE_LABELS[isPro ? settings.summaryStyle : 'meeting'])}
              badge={proBadge}
              onPress={pickStyle}
            />
            <SettingsRow
              icon="chatbox-ellipses-outline"
              label={t('lang.title.summary')}
              value={summaryLanguageValue}
              badge={proBadge}
              onPress={pro(() => router.push({ pathname: '/language', params: { kind: 'summary' } }))}
            />
            <SettingsRow
              icon="create-outline"
              label={t('settings.summaryInstructions')}
              value={isPro && settings.summaryInstructions ? t('settings.instructionsOn') : undefined}
              badge={proBadge}
              onPress={pro(() => setEditingInstructions(true))}
            />
          </SettingsSection>

          <SettingsSection title={t('settings.section.models')} footer={t('settings.modelsFooter')}>
            <SettingsRow icon="hardware-chip-outline" label={t('settings.yourPhone')} value={t(TIER_LABEL[tier])} onPress={() => router.push('/models')} />
            <SettingsRow icon="sparkles-outline" label={t('settings.engine')} value={engineLabel} onPress={() => router.push('/models')} />
          </SettingsSection>

          <SettingsSection title={t('settings.section.feedback')}>
            <SettingsRow
              icon="pulse-outline"
              label={t('settings.haptics')}
              toggle={{ value: settings.hapticsEnabled, onChange: (v) => update({ hapticsEnabled: v }) }}
            />
          </SettingsSection>

          <SettingsSection title={t('paywall.eyebrow')}>
            <SettingsRow
              icon="diamond-outline"
              label={isPro ? t('settings.proActive') : t('settings.upgrade')}
              onPress={() => paywall()}
            />
            {__DEV__ && (
              <SettingsRow
                icon="construct-outline"
                iconColor={colors.warning}
                label="Developer: unlock Pro"
                toggle={{ value: settings.devProOverride, onChange: (v) => update({ devProOverride: v }) }}
              />
            )}
          </SettingsSection>

          <SettingsSection title={t('settings.section.data')} footer={t('settings.dataFooter')}>
            <SettingsRow icon="download-outline" label={t('notes.importNotes')} onPress={() => void handleImport()} />
            <SettingsRow icon="archive-outline" label={t('settings.backup')} onPress={() => void handleBackup()} />
            <SettingsRow icon="shield-checkmark-outline" label={t('settings.whatsStored')} onPress={() => router.push('/legal/data')} />
            <SettingsRow
              icon="trash-outline"
              label={t('settings.deleteAll')}
              destructive
              onPress={() => {
                void haptic('warning');
                setConfirmingDelete(true);
              }}
            />
          </SettingsSection>

          <View style={styles.about}>
            <LogoMark size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.aboutName}>WhisprNotes</Text>
              <Text style={styles.aboutTag}>{t('settings.tagline')}</Text>
            </View>
          </View>
          <SettingsSection title={t('settings.section.about')} footer={t('settings.legalFooter')}>
            <SettingsRow icon="lock-closed-outline" label={t('legal.privacy')} onPress={() => router.push('/legal/privacy')} />
            <SettingsRow icon="document-text-outline" label={t('legal.terms')} onPress={() => router.push('/legal/terms')} />
            <SettingsRow icon="help-buoy-outline" label={t('settings.support')} onPress={() => void WebBrowser.openBrowserAsync(`${WEBSITE_URL}/support`)} />
            {/* Opens the website's feedback form in the browser. The app itself sends nothing. */}
            <SettingsRow icon="chatbubble-ellipses-outline" label={t('settings.feedback')} onPress={() => void WebBrowser.openBrowserAsync(`${WEBSITE_URL}/feedback`)} />
            <SettingsRow icon="mail-outline" label={t('settings.contact')} value={CONTACT_EMAIL} chevron={false} />
            <SettingsRow icon="information-circle-outline" label={t('settings.version')} value={version} chevron={false} />
          </SettingsSection>
        </Animated.View>
      </ScrollView>

      <DeleteAllDataModal
        visible={confirmingDelete}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={async () => {
          setConfirmingDelete(false);
          try {
            await notesRepo.deleteAllData();
            await resetSettings();
            void haptic('success');
            toast.show({ message: t('settings.deletedAll'), tone: 'success' });
          } catch (error) {
            console.error('Delete all data failed:', error);
            toast.show({ message: t('settings.deleteAllFailed'), tone: 'error' });
          }
        }}
      />

      <InstructionsModal
        visible={editingInstructions}
        initial={settings.summaryInstructions}
        onCancel={() => setEditingInstructions(false)}
        onSave={(text) => {
          update({ summaryInstructions: text });
          setEditingInstructions(false);
        }}
      />
    </SafeAreaView>
  );
}

/** Standing instructions for every summary, e.g. "Use British spelling" (Pro). */
function InstructionsModal({
  visible,
  initial,
  onCancel,
  onSave,
}: {
  visible: boolean;
  initial: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const { t } = useI18n();
  const [text, setText] = useState(initial);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} onShow={() => setText(initial)}>
      <View style={modalStyles.backdrop}>
        <View style={[modalStyles.card, { backgroundColor: colors.card }]}>
          <Text style={[modalStyles.title, { color: colors.text }]}>{t('settings.summaryInstructions')}</Text>
          <Text style={[modalStyles.body, { color: colors.textMuted }]}>{t('settings.instructionsBody')}</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            maxLength={MAX_INSTRUCTIONS_CHARS}
            placeholder={t('settings.instructionsPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={[modalStyles.multiline, { color: colors.text, backgroundColor: colors.surface }]}
            accessibilityLabel={t('settings.summaryInstructions')}
            textAlignVertical="top"
          />
          <Text style={[modalStyles.counter, { color: colors.textMuted }]}>
            {text.length}/{MAX_INSTRUCTIONS_CHARS}
          </Text>
          <View style={modalStyles.buttons}>
            <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
            <Button label={t('common.save')} onPress={() => onSave(text.trim())} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The word typed to confirm stays "DELETE" in every language: it is shown in
 * the prompt, and a fixed Latin word can be typed on any keyboard.
 */
const CONFIRM_WORD = 'DELETE';

function DeleteAllDataModal({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const { t } = useI18n();
  const [text, setText] = useState('');
  const matches = text.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} onShow={() => setText('')}>
      <View style={modalStyles.backdrop}>
        <View style={[modalStyles.card, { backgroundColor: colors.card }]}>
          <Text style={[modalStyles.title, { color: colors.text }]}>{t('settings.deleteAllTitle')}</Text>
          <Text style={[modalStyles.body, { color: colors.textMuted }]}>{t('settings.deleteAllBody')}</Text>
          <Text style={[modalStyles.body, { color: colors.text }]}>{t('settings.deleteAllType', { word: CONFIRM_WORD })}</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={CONFIRM_WORD}
            placeholderTextColor={colors.textMuted}
            style={[modalStyles.input, { color: colors.text, backgroundColor: colors.surface }]}
            accessibilityLabel={t('settings.deleteAllType', { word: CONFIRM_WORD })}
          />
          <View style={modalStyles.buttons}>
            <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
            <Button
              label={t('common.delete')}
              variant="destructive"
              haptic="heavy"
              disabled={!matches}
              onPress={onConfirm}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,6,16,0.5)', justifyContent: 'center', padding: Spacing.xl },
  card: { borderRadius: Radius.xl, padding: Spacing.xl, gap: Spacing.md },
  title: { fontSize: FontSize.lg, fontWeight: '800' },
  body: { fontSize: FontSize.sm, lineHeight: 20 },
  input: { borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, fontSize: FontSize.md, fontWeight: '700', letterSpacing: 2 },
  multiline: { borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, fontSize: FontSize.md, minHeight: 110 },
  counter: { fontSize: FontSize.xs, alignSelf: 'flex-end', marginTop: -Spacing.sm },
  buttons: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm },
});

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: Spacing.xxl },
    about: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md, marginLeft: Spacing.sm },
    aboutName: { fontSize: FontSize.md, fontWeight: '800', color: colors.text },
    aboutTag: { fontSize: FontSize.xs, color: colors.textMuted },
    proCard: {
      backgroundColor: colors.navBackground,
      borderRadius: Radius.xl,
      padding: Spacing.xl,
      marginBottom: Spacing.xl,
      gap: Spacing.sm,
    },
    proEyebrow: { color: '#FFC9BB', fontSize: FontSize.xs, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
    proTitle: { color: '#FFFFFF', fontSize: FontSize.lg, fontWeight: '800', lineHeight: 26 },
    proCta: { color: '#FF8E75', fontSize: FontSize.md, fontWeight: '700' },
  });
}
