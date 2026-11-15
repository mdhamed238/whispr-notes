/**
 * WhisprNotes Pro paywall. Prices come from the store (RevenueCat
 * offering); clear terms, restore, no dark patterns.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PurchasesOffering } from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';

import LogoMark from '@/components/brand/LogoMark';
import Button from '@/components/ui/Button';
import ModalHeader from '@/components/ui/ModalHeader';
import { useToast } from '@/components/ui/Toast';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { LANGUAGES } from '@/constants/languages';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { usePro } from '@/hooks/usePro';
import { useI18n, type TKey } from '@/i18n';
import { lifetimePlanFromOffering } from '@/services/billing/plans';
import { FREE_SUMMARIES_PER_WEEK } from '@/services/billing/quota';
import { getCurrentOffering, isStoreConfigured, peekCurrentOffering, purchase, restore } from '@/services/billing/purchases';
import { haptic } from '@/services/haptics';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const BENEFITS: { icon: IconName; title: TKey; body: TKey }[] = [
  { icon: 'sparkles', title: 'paywall.benefit.accuracy.title', body: 'paywall.benefit.accuracy.body' },
  { icon: 'reader', title: 'paywall.benefit.summaries.title', body: 'paywall.benefit.summaries.body' },
  { icon: 'chatbubble-ellipses', title: 'paywall.benefit.ask.title', body: 'paywall.benefit.ask.body' },
  { icon: 'musical-notes', title: 'paywall.benefit.audio.title', body: 'paywall.benefit.audio.body' },
  { icon: 'share', title: 'paywall.benefit.export.title', body: 'paywall.benefit.export.body' },
  { icon: 'stats-chart', title: 'paywall.benefit.insights.title', body: 'paywall.benefit.insights.body' },
];

export default function PaywallScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const { isPro } = usePro();
  // The offering is fetched at launch, so the price is usually here already.
  const [offering, setOffering] = useState<PurchasesOffering | null>(() => peekCurrentOffering());
  const [loading, setLoading] = useState(() => peekCurrentOffering() === null);
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);

  useEffect(() => {
    if (offering) return;
    getCurrentOffering()
      .then(setOffering)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const plan = lifetimePlanFromOffering(offering);

  const handleBuy = async () => {
    if (!plan.pkg) {
      toast.show({ message: t('paywall.unavailable'), tone: 'error' });
      return;
    }
    setBusy('buy');
    try {
      const ok = await purchase(plan.pkg);
      if (ok) {
        void haptic('success');
        toast.show({ message: t('paywall.welcome'), tone: 'success' });
        router.back();
      }
    } catch (error) {
      console.warn('Purchase failed:', error);
      toast.show({ message: t('paywall.failed'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async () => {
    setBusy('restore');
    try {
      const ok = await restore();
      void haptic(ok ? 'success' : 'warning');
      toast.show({ message: ok ? t('paywall.restored') : t('paywall.nothingToRestore'), tone: ok ? 'success' : 'default' });
      if (ok) router.back();
    } catch (error) {
      console.warn('Restore failed:', error);
      toast.show({ message: t('paywall.restoreFailed'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (isPro) {
    return (
      <SafeAreaView style={styles.container}>
        <ModalHeader variant="close" />
        <View style={styles.center}>
          <LogoMark size={72} />
          <Text style={styles.headline}>{t('paywall.activeTitle')}</Text>
          <Text style={styles.sub}>{t('paywall.activeBody')}</Text>
          <Text style={styles.fine}>{t('paywall.activeFine')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ModalHeader variant="close" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <LogoMark size={64} />
          <Text style={styles.eyebrow}>{t('paywall.eyebrow')}</Text>
          <Text style={styles.headline}>{t('paywall.headline')}</Text>
        </View>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b.title} style={styles.benefit}>
              <View style={styles.benefitIcon}>
                <Ionicons name={b.icon} size={18} color={colors.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{t(b.title)}</Text>
                <Text style={styles.benefitBody}>{t(b.body)}</Text>
              </View>
            </View>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.tint} style={{ marginVertical: Spacing.xl }} />
        ) : (
          <View style={styles.plan}>
            <View style={{ flex: 1 }}>
              <Text style={styles.planTitle}>{t('paywall.planTitle')}</Text>
              <Text style={styles.planPeriod}>{t('paywall.planBody')}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.planPrice}>{plan.price}</Text>
              <Text style={styles.planPeriod}>{t('paywall.oneTime')}</Text>
            </View>
          </View>
        )}

        <Button
          label={!loading && !plan.pkg ? t('paywall.buyUnavailable') : t('paywall.buy')}
          loading={busy === 'buy'}
          disabled={busy !== null || loading || !plan.pkg}
          onPress={handleBuy}
          haptic="medium"
        />

        <Text style={styles.fine}>{t('paywall.terms')}</Text>
        {!loading && !plan.pkg && <Text style={styles.fine}>{t('paywall.unavailableDetail')}</Text>}
        {!isStoreConfigured() && __DEV__ && (
          <Text style={[styles.fine, { color: colors.warning }]}>Developer: the store isn't configured. Use Settings → Developer: unlock Pro.</Text>
        )}

        <View style={styles.links}>
          <Pressable onPress={handleRestore} disabled={busy !== null} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>{busy === 'restore' ? t('paywall.restoring') : t('paywall.restore')}</Text>
          </Pressable>
          <Text style={styles.dot}>·</Text>
          <Pressable onPress={() => router.push('/legal/terms')} hitSlop={8} accessibilityRole="link">
            <Text style={styles.link}>{t('paywall.termsLink')}</Text>
          </Pressable>
          <Text style={styles.dot}>·</Text>
          <Pressable onPress={() => router.push('/legal/privacy')} hitSlop={8} accessibilityRole="link">
            <Text style={styles.link}>{t('paywall.privacyLink')}</Text>
          </Pressable>
        </View>

        <View style={styles.freeBox}>
          <Text style={styles.freeTitle}>{t('paywall.freeTitle')}</Text>
          <Text style={styles.freeBody}>
            {t('paywall.freeBody', { languages: LANGUAGES.length, summaries: FREE_SUMMARIES_PER_WEEK })}
          </Text>
        </View>
        <Text style={styles.fine}>{t('paywall.privacyNote')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl, gap: Spacing.lg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
    hero: { alignItems: 'center', gap: Spacing.sm },
    eyebrow: { color: colors.tint, fontSize: FontSize.xs, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: Spacing.sm },
    headline: { fontSize: FontSize.xl, fontWeight: '800', color: colors.text, textAlign: 'center', lineHeight: 32 },
    sub: { fontSize: FontSize.md, color: colors.textMuted, textAlign: 'center' },
    benefits: { gap: Spacing.md },
    benefit: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
    benefitIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: `${colors.tint}1A`, alignItems: 'center', justifyContent: 'center' },
    benefitTitle: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    benefitBody: { fontSize: FontSize.sm, color: colors.textMuted, lineHeight: 19 },
    plan: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      borderRadius: Radius.lg,
      borderWidth: 1.5,
      borderColor: colors.tint,
      backgroundColor: `${colors.tint}0D`,
      padding: Spacing.lg,
    },
    planTitle: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    planPrice: { fontSize: FontSize.md, fontWeight: '800', color: colors.text },
    planPeriod: { fontSize: FontSize.xs, color: colors.textMuted },
    fine: { fontSize: FontSize.xs, color: colors.textMuted, textAlign: 'center', lineHeight: 17 },
    links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm },
    link: { fontSize: FontSize.sm, color: colors.tint, fontWeight: '600' },
    dot: { color: colors.textMuted },
    freeBox: { backgroundColor: colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs },
    freeTitle: { fontSize: FontSize.sm, fontWeight: '800', color: colors.text },
    freeBody: { fontSize: FontSize.sm, color: colors.textMuted, lineHeight: 19 },
  });
}
