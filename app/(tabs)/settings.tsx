/**
 * Settings: AI models, transcription, feedback, Pro, data and about.
 */

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import ScreenHeader from '@/components/ui/ScreenHeader';
import { SettingsRow, SettingsSection } from '@/components/ui/SettingsList';
import { useActionSheet } from '@/components/ui/ActionSheet';
import { useToast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { CONTACT_EMAIL } from '@/constants/config';
import { TRANSCRIPTION_LANGUAGES, languageLabel } from '@/constants/languages';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { usePro } from '@/hooks/usePro';
import { useDeviceTier } from '@/hooks/useDeviceTier';
import * as notesRepo from '@/services/db/notesRepo';
import { haptic } from '@/services/haptics';
import { resetSettings, useSettings } from '@/services/settings';
import { runImportFlow } from '@/services/import/importFlow';
import { backupAllNotes } from '@/services/export/backup';

const TIER_LABEL = { flagship: 'Flagship', standard: 'Standard', lite: 'Lite' } as const;

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const sheet = useActionSheet();
  const toast = useToast();
  const [settings, update] = useSettings();
  const { isPro } = usePro();
  const { tier, engineLabel } = useDeviceTier();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const requirePro = (action: () => void) => {
    if (isPro) action();
    else router.push('/paywall');
  };

  const pickLanguage = () =>
    sheet.open({
      title: 'Transcription language',
      message: 'Used by the enhanced transcript after you stop recording. The live preview is English-only.',
      actions: TRANSCRIPTION_LANGUAGES.map((l) => ({
        label: l.label,
        icon: settings.transcriptionLanguage === l.code ? 'checkmark' : undefined,
        onPress: () => update({ transcriptionLanguage: l.code }),
      })),
    });

  const handleImport = () =>
    requirePro(async () => {
      const report = await runImportFlow();
      if (report) router.push({ pathname: '/import', params: { report: JSON.stringify(report) } });
    });

  const handleBackup = () =>
    requirePro(async () => {
      try {
        await backupAllNotes();
        void haptic('success');
      } catch (error) {
        console.error('Backup failed:', error);
        toast.show({ message: 'Backup failed. Check free storage and try again.', tone: 'error' });
      }
    });

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Settings" />

        <Animated.View entering={FadeIn.duration(250)}>
          {!isPro && (
            <Pressable
              onPress={() => {
                void haptic('selection');
                router.push('/paywall');
              }}
              style={({ pressed }) => [styles.proCard, pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
            >
              <Text style={styles.proEyebrow}>WhisprNotes Pro</Text>
              <Text style={styles.proTitle}>Large-v3 accuracy, unlimited summaries, every export.</Text>
              <Text style={styles.proCta}>See plans →</Text>
            </Pressable>
          )}

          <SettingsSection
            title="AI models"
            footer="All models run on this phone. They download once, then work offline."
          >
            <SettingsRow icon="hardware-chip-outline" label="Your phone" value={TIER_LABEL[tier]} onPress={() => router.push('/models')} />
            <SettingsRow icon="sparkles-outline" label="Transcription engine" value={engineLabel} onPress={() => router.push('/models')} />
          </SettingsSection>

          <SettingsSection title="Transcription">
            <SettingsRow
              icon="language-outline"
              label="Language"
              value={languageLabel(settings.transcriptionLanguage)}
              badge={isPro ? undefined : 'PRO'}
              onPress={() => requirePro(pickLanguage)}
            />
            <SettingsRow
              icon="reader-outline"
              label="Summarize automatically"
              toggle={{ value: settings.autoSummarize, onChange: (v) => update({ autoSummarize: v }) }}
            />
          </SettingsSection>

          <SettingsSection title="Feedback">
            <SettingsRow
              icon="pulse-outline"
              label="Haptic feedback"
              toggle={{ value: settings.hapticsEnabled, onChange: (v) => update({ hapticsEnabled: v }) }}
            />
          </SettingsSection>

          <SettingsSection title="WhisprNotes Pro">
            <SettingsRow
              icon="diamond-outline"
              label={isPro ? 'Pro is active' : 'Upgrade to Pro'}
              onPress={() => router.push('/paywall')}
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

          <SettingsSection title="Your data" footer="Your notes never leave this phone unless you share or export them.">
            <SettingsRow icon="download-outline" label="Import notes" badge={isPro ? undefined : 'PRO'} onPress={handleImport} />
            <SettingsRow icon="archive-outline" label="Back up all notes" badge={isPro ? undefined : 'PRO'} onPress={handleBackup} />
            <SettingsRow icon="shield-checkmark-outline" label="What's stored and where" onPress={() => router.push('/legal/data')} />
            <SettingsRow
              icon="trash-outline"
              label="Delete all data"
              destructive
              onPress={() => {
                void haptic('warning');
                setConfirmingDelete(true);
              }}
            />
          </SettingsSection>

          <SettingsSection title="About">
            <SettingsRow icon="lock-closed-outline" label="Privacy Policy" onPress={() => router.push('/legal/privacy')} />
            <SettingsRow icon="document-text-outline" label="Terms of Use" onPress={() => router.push('/legal/terms')} />
            <SettingsRow icon="mail-outline" label="Contact" value={CONTACT_EMAIL} chevron={false} />
            <SettingsRow icon="information-circle-outline" label="Version" value={version} chevron={false} />
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
            toast.show({ message: 'All notes and recordings were deleted.', tone: 'success' });
          } catch (error) {
            console.error('Delete all data failed:', error);
            toast.show({ message: 'Some data could not be deleted. Try again.', tone: 'error' });
          }
        }}
      />
    </SafeAreaView>
  );
}

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
  const [text, setText] = useState('');
  const matches = text.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} onShow={() => setText('')}>
      <View style={modalStyles.backdrop}>
        <View style={[modalStyles.card, { backgroundColor: colors.card }]}>
          <Text style={[modalStyles.title, { color: colors.text }]}>Delete all data?</Text>
          <Text style={[modalStyles.body, { color: colors.textMuted }]}>
            Every note, recording, summary and export on this phone will be erased. This can't be undone. Downloaded AI
            models are kept.
          </Text>
          <Text style={[modalStyles.body, { color: colors.text }]}>Type {CONFIRM_WORD} to confirm.</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={CONFIRM_WORD}
            placeholderTextColor={colors.textMuted}
            style={[modalStyles.input, { color: colors.text, backgroundColor: colors.surface }]}
            accessibilityLabel={`Type ${CONFIRM_WORD} to confirm`}
          />
          <View style={modalStyles.buttons}>
            <Button label="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
            <Button
              label="Delete"
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
  buttons: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm },
});

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: 140 },
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
