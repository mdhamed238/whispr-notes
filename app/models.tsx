/**
 * AI models: this phone's tier, which models it uses, and download control
 * for the large transcription model.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActionSheet } from '@/components/ui/ActionSheet';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ModalHeader from '@/components/ui/ModalHeader';
import { SettingsRow, SettingsSection } from '@/components/ui/SettingsList';
import { useToast } from '@/components/ui/Toast';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { useDeviceTier } from '@/hooks/useDeviceTier';
import { usePro } from '@/hooks/usePro';
import { MODEL_CATALOG, ModelId, formatBytes } from '@/services/ai/modelCatalog';
import * as modelManager from '@/services/ai/modelManager';
import type { DeviceTier } from '@/services/ai/tiers';
import { haptic } from '@/services/haptics';
import { useSettings } from '@/services/settings';

const TIER_COPY: Record<DeviceTier, { label: string; detail: string }> = {
  flagship: { label: 'Flagship', detail: 'Runs Whisper Large-v3 Turbo and the larger summary model.' },
  standard: { label: 'Standard', detail: 'Runs Whisper Small and the compact summary model.' },
  lite: { label: 'Lite', detail: 'Runs Whisper Base and the compact summary model.' },
};

export default function ModelsScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const sheet = useActionSheet();
  const toast = useToast();
  const { isPro } = usePro();
  const [settings, update] = useSettings();
  const { detected, tier, engine, llm } = useDeviceTier();
  const [, force] = useState(0);

  useEffect(() => modelManager.subscribeModels(() => force((n) => n + 1)), []);

  const turbo: ModelId = 'whisper-large-v3-turbo';
  const turboStatus = modelManager.status(turbo);
  const turboProgress = modelManager.progress(turbo);
  const usage = modelManager.diskUsage();

  const startDownload = async () => {
    if (!isPro) {
      router.push('/paywall');
      return;
    }
    try {
      void haptic('selection');
      await modelManager.download(turbo);
      void haptic('success');
      toast.show({ message: 'Large-v3 Turbo is ready.', tone: 'success' });
    } catch (error) {
      console.warn('Model download failed:', error);
      toast.show({ message: 'Download stopped. Check your connection and try again.', tone: 'error' });
    }
  };

  const pickTier = () =>
    sheet.open({
      title: 'Model size',
      message: 'Smaller models are faster and use less storage and battery.',
      actions: [
        {
          label: `Automatic (${TIER_COPY[detected].label})`,
          icon: settings.tierOverride === null ? 'checkmark' : undefined,
          onPress: () => update({ tierOverride: null }),
        },
        ...(['flagship', 'standard', 'lite'] as DeviceTier[]).map((t) => ({
          label: TIER_COPY[t].label,
          icon: settings.tierOverride === t ? ('checkmark' as const) : undefined,
          onPress: () => update({ tierOverride: t, failedEngines: [] }),
        })),
      ],
    });

  return (
    <SafeAreaView style={styles.container}>
      <ModalHeader title="AI models" />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.hero} elevation="none">
          <View style={[styles.heroIcon, { backgroundColor: `${colors.tint}1F` }]}>
            <Ionicons name="hardware-chip" size={22} color={colors.tint} />
          </View>
          <Text style={styles.heroTitle}>Your phone: {TIER_COPY[detected].label}</Text>
          <Text style={styles.heroBody}>{TIER_COPY[tier].detail}</Text>
          <Text style={styles.heroBody}>
            Everything runs on this phone. The internet is used only to download a model the first time.
          </Text>
        </Card>

        <SettingsSection title="In use">
          <SettingsRow icon="mic-outline" label="Live transcript" value="Whisper Base" chevron={false} />
          <SettingsRow icon="sparkles-outline" label="Final transcript" value={MODEL_CATALOG[engine].name.replace('Whisper ', '')} chevron={false} />
          <SettingsRow icon="reader-outline" label="Summaries & titles" value={MODEL_CATALOG[llm].name} chevron={false} />
          <SettingsRow
            icon="options-outline"
            label="Model size"
            value={settings.tierOverride ? TIER_COPY[settings.tierOverride].label : 'Automatic'}
            onPress={pickTier}
          />
        </SettingsSection>

        <Text style={styles.sectionTitle}>Large-v3 Turbo</Text>
        <Card style={styles.modelCard} elevation="none">
          <View style={styles.modelHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modelName}>{MODEL_CATALOG[turbo].name}</Text>
              <Text style={styles.modelPurpose}>
                {MODEL_CATALOG[turbo].purpose} · {formatBytes(MODEL_CATALOG[turbo].approxBytes)}
              </Text>
            </View>
            {!isPro && <Text style={[styles.badge, { color: colors.tint, borderColor: colors.tint }]}>PRO</Text>}
          </View>

          {turboStatus === 'downloading' ? (
            <View style={{ gap: Spacing.sm }}>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(turboProgress * 100)}%` }]} />
              </View>
              <View style={styles.row}>
                <Text style={styles.modelPurpose}>Downloading… {Math.round(turboProgress * 100)}%</Text>
                <Button label="Cancel" variant="ghost-destructive" onPress={() => modelManager.cancelDownload(turbo)} />
              </View>
            </View>
          ) : turboStatus === 'ready' ? (
            <View style={styles.row}>
              <View style={styles.readyRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={[styles.modelPurpose, { color: colors.success }]}>Installed</Text>
              </View>
              <Button
                label="Remove"
                variant="ghost-destructive"
                onPress={() =>
                  sheet.open({
                    title: 'Remove Large-v3 Turbo?',
                    message: 'Frees storage. You can download it again any time.',
                    actions: [{ label: 'Remove model', icon: 'trash-outline', destructive: true, onPress: () => modelManager.remove(turbo) }],
                  })
                }
              />
            </View>
          ) : (
            <Button
              label={isPro ? `Download (${formatBytes(MODEL_CATALOG[turbo].approxBytes)})` : 'Unlock with Pro'}
              icon={isPro ? 'cloud-download-outline' : 'diamond-outline'}
              onPress={startDownload}
            />
          )}
          <Text style={styles.hint}>Wi-Fi recommended. Downloads continue in the background.</Text>
        </Card>

        <SettingsSection title="Storage" footer="Live-transcript and summary models are fetched automatically the first time they're used.">
          <SettingsRow icon="server-outline" label="Downloaded by WhisprNotes" value={formatBytes(usage)} chevron={false} />
        </SettingsSection>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl },
    hero: { backgroundColor: colors.card, gap: Spacing.sm, marginBottom: Spacing.xl },
    heroIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    heroTitle: { fontSize: FontSize.lg, fontWeight: '800', color: colors.text },
    heroBody: { fontSize: FontSize.sm, color: colors.textMuted, lineHeight: 20 },
    sectionTitle: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: Spacing.sm,
      marginLeft: Spacing.sm,
      color: colors.textMuted,
    },
    modelCard: { backgroundColor: colors.card, gap: Spacing.md, marginBottom: Spacing.xl },
    modelHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    modelName: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    modelPurpose: { fontSize: FontSize.sm, color: colors.textMuted },
    badge: { fontSize: 10, fontWeight: '800', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    track: { height: 6, borderRadius: Radius.pill, backgroundColor: colors.surface, overflow: 'hidden' },
    fill: { height: 6, borderRadius: Radius.pill, backgroundColor: colors.tint },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    readyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    hint: { fontSize: FontSize.xs, color: colors.textMuted },
  });
}
