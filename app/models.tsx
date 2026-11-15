/**
 * AI models: this phone's tier, which models it uses for the current
 * language, and download control for the models WhisprNotes hosts itself.
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
import { languageLabel } from '@/constants/languages';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { useDeviceTier } from '@/hooks/useDeviceTier';
import { usePro } from '@/hooks/usePro';
import { useI18n, type TKey } from '@/i18n';
import { MODEL_CATALOG, ModelId, formatBytes } from '@/services/ai/modelCatalog';
import { livePreviewEngine } from '@/services/ai/language';
import * as modelManager from '@/services/ai/modelManager';
import type { DeviceTier } from '@/services/ai/tiers';
import { haptic } from '@/services/haptics';
import { useSettings } from '@/services/settings';

const TIER_COPY: Record<DeviceTier, { label: TKey; detail: TKey }> = {
  flagship: { label: 'models.tier.flagship', detail: 'models.tier.flagshipDetail' },
  standard: { label: 'models.tier.standard', detail: 'models.tier.standardDetail' },
  lite: { label: 'models.tier.lite', detail: 'models.tier.liteDetail' },
};

/** Models the user can install or remove here, with what each is for. */
const DOWNLOADABLE: { id: ModelId; purpose: TKey }[] = [
  { id: 'whisper-base', purpose: 'models.purpose.base' },
  { id: 'whisper-large-v3-turbo', purpose: 'models.purpose.turbo' },
];

const shortName = (id: ModelId) => MODEL_CATALOG[id].name.replace(/^Whisper /, '');

export default function ModelsScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const sheet = useActionSheet();
  const toast = useToast();
  const { t, language: appLanguage } = useI18n();
  const { isPro } = usePro();
  const [settings, update] = useSettings();
  const { detected, tier, engine, llm, spokenLanguage } = useDeviceTier();
  const [, force] = useState(0);

  useEffect(() => modelManager.subscribeModels(() => force((n) => n + 1)), []);

  const usage = modelManager.diskUsage();

  const startDownload = async (id: ModelId) => {
    if (MODEL_CATALOG[id].pro && !isPro) {
      router.push('/paywall');
      return;
    }
    try {
      void haptic('selection');
      await modelManager.download(id);
      void haptic('success');
      toast.show({ message: t('models.ready', { model: shortName(id) }), tone: 'success' });
    } catch (error) {
      // Cancelling rejects the download too; that isn't a failure to report.
      if (error instanceof Error && /cancelled/i.test(error.message)) return;
      console.warn('Model download failed:', error);
      toast.show({ message: t('models.downloadFailed'), tone: 'error' });
    }
  };

  const cancelDownload = (id: ModelId) => void modelManager.cancelDownload(id);

  const confirmRemove = (id: ModelId) =>
    sheet.open({
      title: t('models.removeTitle', { model: shortName(id) }),
      message: t('models.removeBody'),
      actions: [{ label: t('models.remove'), icon: 'trash-outline', destructive: true, onPress: () => modelManager.remove(id) }],
    });

  const pickTier = () =>
    sheet.open({
      title: t('models.size'),
      message: t('models.sizeBody'),
      actions: [
        {
          label: t('models.sizeAutomatic', { tier: t(TIER_COPY[detected].label) }),
          icon: settings.tierOverride === null ? 'checkmark' : undefined,
          onPress: () => update({ tierOverride: null }),
        },
        ...(['flagship', 'standard', 'lite'] as DeviceTier[]).map((option) => ({
          label: t(TIER_COPY[option].label),
          icon: settings.tierOverride === option ? ('checkmark' as const) : undefined,
          onPress: () => update({ tierOverride: option, failedEngines: [] }),
        })),
      ],
    });

  return (
    <SafeAreaView style={styles.container}>
      <ModalHeader title={t('settings.section.models')} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.hero} elevation="none">
          <View style={[styles.heroIcon, { backgroundColor: `${colors.tint}1F` }]}>
            <Ionicons name="hardware-chip" size={22} color={colors.tint} />
          </View>
          <Text style={styles.heroTitle}>{t('models.yourPhone', { tier: t(TIER_COPY[detected].label) })}</Text>
          <Text style={styles.heroBody}>{t(TIER_COPY[tier].detail)}</Text>
          <Text style={styles.heroBody}>{t('models.onDevice')}</Text>
        </Card>

        <SettingsSection title={t('models.inUse')} footer={t('models.inUseFooter', { language: languageLabel(spokenLanguage) })}>
          <SettingsRow
            icon="mic-outline"
            label={t('models.live')}
            value={shortName(livePreviewEngine(settings.transcriptionLanguage, appLanguage))}
            chevron={false}
          />
          <SettingsRow icon="sparkles-outline" label={t('models.final')} value={shortName(engine)} chevron={false} />
          <SettingsRow icon="reader-outline" label={t('onboarding.modelSummaries')} value={MODEL_CATALOG[llm].name} chevron={false} />
          <SettingsRow
            icon="options-outline"
            label={t('models.size')}
            value={settings.tierOverride ? t(TIER_COPY[settings.tierOverride].label) : t('common.automatic')}
            onPress={pickTier}
          />
        </SettingsSection>

        <Text style={styles.sectionTitle}>{t('models.downloads')}</Text>
        {DOWNLOADABLE.map(({ id, purpose }) => {
          const info = MODEL_CATALOG[id];
          const status = modelManager.status(id);
          const percent = Math.round(modelManager.progress(id) * 100);
          const locked = info.pro && !isPro;
          return (
            <Card key={id} style={styles.modelCard} elevation="none">
              <View style={styles.modelHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modelName}>{info.name}</Text>
                  <Text style={styles.modelPurpose}>
                    {t(purpose)} · {formatBytes(info.approxBytes)}
                  </Text>
                </View>
                {locked && <Text style={[styles.badge, { color: colors.tint, borderColor: colors.tint }]}>{t('common.pro')}</Text>}
              </View>

              {status === 'downloading' ? (
                <View style={{ gap: Spacing.sm }}>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${percent}%` }]} />
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.modelPurpose} accessibilityLiveRegion="polite">
                      {t('models.downloading', { percent })}
                    </Text>
                    <Button label={t('common.cancel')} variant="ghost-destructive" onPress={() => cancelDownload(id)} />
                  </View>
                </View>
              ) : status === 'ready' ? (
                <View style={styles.row}>
                  <View style={styles.readyRow}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                    <Text style={[styles.modelPurpose, { color: colors.success }]}>{t('models.installed')}</Text>
                  </View>
                  <Button label={t('models.remove')} variant="ghost-destructive" onPress={() => confirmRemove(id)} />
                </View>
              ) : (
                <Button
                  label={locked ? t('models.unlock') : t('models.download', { size: formatBytes(info.approxBytes) })}
                  icon={locked ? 'diamond-outline' : 'cloud-download-outline'}
                  variant={id === 'whisper-base' ? 'secondary' : 'primary'}
                  onPress={() => void startDownload(id)}
                />
              )}
            </Card>
          );
        })}
        <Text style={styles.hint}>{t('models.downloadHint')}</Text>

        <SettingsSection title={t('models.storage')} footer={t('models.storageFooter')}>
          <SettingsRow icon="server-outline" label={t('models.storageUsed')} value={formatBytes(usage)} chevron={false} />
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
    modelCard: { backgroundColor: colors.card, gap: Spacing.md, marginBottom: Spacing.md },
    modelHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    modelName: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    modelPurpose: { fontSize: FontSize.sm, color: colors.textMuted, lineHeight: 19 },
    badge: { fontSize: 10, fontWeight: '800', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    track: { height: 6, borderRadius: Radius.pill, backgroundColor: colors.surface, overflow: 'hidden' },
    fill: { height: 6, borderRadius: Radius.pill, backgroundColor: colors.tint },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    readyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    hint: { fontSize: FontSize.xs, color: colors.textMuted, marginBottom: Spacing.xl, marginHorizontal: Spacing.sm },
  });
}
