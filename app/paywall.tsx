/**
 * WhisprNotes Pro paywall. Prices come from the store (RevenueCat
 * offering); clear terms, restore, no dark patterns.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';

import LogoMark from '@/components/brand/LogoMark';
import Button from '@/components/ui/Button';
import ModalHeader from '@/components/ui/ModalHeader';
import { useToast } from '@/components/ui/Toast';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { Brand } from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { usePro } from '@/hooks/usePro';
import { FALLBACK_PLANS, PlanId, yearlySavingsPercent } from '@/services/billing/plans';
import { getCurrentOffering, isStoreConfigured, purchase, restore } from '@/services/billing/purchases';
import { haptic } from '@/services/haptics';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const BENEFITS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'sparkles', title: 'Whisper Large-v3 accuracy', body: 'Studio-grade transcripts in 99 languages, on your phone.' },
  { icon: 'reader', title: 'Unlimited AI summaries', body: 'Key points, action items and decisions for every meeting.' },
  { icon: 'share', title: 'Every export', body: 'Branded PDF, Markdown, subtitles and the original audio.' },
  { icon: 'download', title: 'Import & back up', body: 'Bring notes from Notion, Obsidian, Evernote and more.' },
  { icon: 'stats-chart', title: 'Insights', body: 'Your streaks, speaking pace and time saved.' },
];

interface PlanOption {
  id: PlanId;
  title: string;
  price: string;
  period: string;
  badge?: string;
  trial?: string;
  pkg: PurchasesPackage | null;
}

function plansFromOffering(offering: PurchasesOffering | null): PlanOption[] {
  if (!offering) return FALLBACK_PLANS.map((p) => ({ ...p, pkg: null, badge: p.id === 'yearly' ? 'Best value' : undefined }));
  const monthly = offering.monthly;
  const annual = offering.annual;
  const lifetime = offering.lifetime;
  const savings = yearlySavingsPercent(monthly?.product.price ?? null, annual?.product.price ?? null);
  const options: PlanOption[] = [];
  if (annual)
    options.push({
      id: 'yearly',
      title: 'Yearly',
      price: annual.product.priceString,
      period: 'per year',
      badge: savings ? `Save ${savings}%` : 'Best value',
      trial: annual.product.introPrice?.price === 0 ? `${annual.product.introPrice.periodNumberOfUnits}-${annual.product.introPrice.periodUnit.toLowerCase()} free trial` : undefined,
      pkg: annual,
    });
  if (monthly) options.push({ id: 'monthly', title: 'Monthly', price: monthly.product.priceString, period: 'per month', pkg: monthly });
  if (lifetime) options.push({ id: 'lifetime', title: 'Lifetime', price: lifetime.product.priceString, period: 'one time', pkg: lifetime });
  return options;
}

export default function PaywallScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const toast = useToast();
  const { isPro } = usePro();
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PlanId>('yearly');
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);

  useEffect(() => {
    getCurrentOffering()
      .then(setOffering)
      .finally(() => setLoading(false));
  }, []);

  const plans = plansFromOffering(offering);
  const chosen = plans.find((p) => p.id === selected) ?? plans[0];

  const handleBuy = async () => {
    if (!chosen?.pkg) {
      toast.show({ message: 'The store isn\'t reachable right now. Check your connection and try again.', tone: 'error' });
      return;
    }
    setBusy('buy');
    try {
      const ok = await purchase(chosen.pkg);
      if (ok) {
        void haptic('success');
        toast.show({ message: 'Welcome to WhisprNotes Pro.', tone: 'success' });
        router.back();
      }
    } catch (error) {
      console.warn('Purchase failed:', error);
      toast.show({ message: 'The purchase didn\'t go through. You were not charged.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async () => {
    setBusy('restore');
    try {
      const ok = await restore();
      void haptic(ok ? 'success' : 'warning');
      toast.show({ message: ok ? 'Pro restored.' : 'No previous purchase found for this store account.', tone: ok ? 'success' : 'default' });
      if (ok) router.back();
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : 'Restore failed.', tone: 'error' });
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
          <Text style={styles.headline}>You're on Pro</Text>
          <Text style={styles.sub}>Thank you for supporting private, on-device notes.</Text>
          <Text style={styles.fine}>Manage or cancel your subscription in your App Store or Google Play account settings.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ModalHeader variant="close" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(350)} style={styles.hero}>
          <LogoMark size={64} />
          <Text style={styles.eyebrow}>WhisprNotes Pro</Text>
          <Text style={styles.headline}>Your meetings, perfectly captured. Privately.</Text>
        </Animated.View>

        <View style={styles.benefits}>
          {BENEFITS.map((b, i) => (
            <Animated.View key={b.title} entering={FadeInDown.delay(60 + i * 40).duration(300)} style={styles.benefit}>
              <View style={styles.benefitIcon}>
                <Ionicons name={b.icon} size={18} color={colors.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{b.title}</Text>
                <Text style={styles.benefitBody}>{b.body}</Text>
              </View>
            </Animated.View>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.tint} style={{ marginVertical: Spacing.xl }} />
        ) : (
          <View style={styles.plans} accessibilityRole="radiogroup">
            {plans.map((p) => {
              const active = p.id === selected;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    void haptic('selection');
                    setSelected(p.id);
                  }}
                  style={[styles.plan, active && styles.planActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <View style={[styles.radio, active && styles.radioActive]}>{active && <View style={styles.radioDot} />}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planTitle}>{p.title}</Text>
                    {p.trial && <Text style={styles.trial}>{p.trial}</Text>}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.planPrice}>{p.price}</Text>
                    <Text style={styles.planPeriod}>{p.period}</Text>
                  </View>
                  {p.badge && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{p.badge}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        <Button
          label={chosen?.trial ? 'Start free trial' : chosen?.id === 'lifetime' ? 'Buy once' : 'Continue'}
          loading={busy === 'buy'}
          disabled={busy !== null || loading}
          onPress={handleBuy}
          haptic="medium"
        />

        <Text style={styles.fine}>
          {chosen?.id === 'lifetime'
            ? 'One payment, Pro forever on this store account.'
            : `${chosen?.trial ? 'After the trial, ' : ''}${chosen?.price ?? ''} ${chosen?.period ?? ''}. Renews automatically until you cancel; cancel anytime in your store settings at least 24 hours before renewal.`}
        </Text>
        {!isStoreConfigured() && __DEV__ && (
          <Text style={[styles.fine, { color: colors.warning }]}>Developer: the store isn't configured. Use Settings → Developer: unlock Pro.</Text>
        )}

        <View style={styles.links}>
          <Pressable onPress={handleRestore} disabled={busy !== null} hitSlop={8}>
            <Text style={styles.link}>{busy === 'restore' ? 'Restoring…' : 'Restore purchase'}</Text>
          </Pressable>
          <Text style={styles.dot}>·</Text>
          <Pressable onPress={() => router.push('/legal/terms')} hitSlop={8}>
            <Text style={styles.link}>Terms</Text>
          </Pressable>
          <Text style={styles.dot}>·</Text>
          <Pressable onPress={() => router.push('/legal/privacy')} hitSlop={8}>
            <Text style={styles.link}>Privacy</Text>
          </Pressable>
        </View>
        <Text style={styles.fine}>Your recordings and notes stay on this phone, with or without Pro.</Text>
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
    plans: { gap: Spacing.sm },
    plan: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      borderRadius: Radius.lg,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: Spacing.lg,
    },
    planActive: { borderColor: colors.tint, backgroundColor: `${colors.tint}0D` },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    radioActive: { borderColor: colors.tint },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.tint },
    planTitle: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    trial: { fontSize: FontSize.xs, color: colors.success, fontWeight: '700', marginTop: 2 },
    planPrice: { fontSize: FontSize.md, fontWeight: '800', color: colors.text },
    planPeriod: { fontSize: FontSize.xs, color: colors.textMuted },
    badge: { position: 'absolute', top: -10, right: Spacing.lg, backgroundColor: Brand.coral, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
    badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
    fine: { fontSize: FontSize.xs, color: colors.textMuted, textAlign: 'center', lineHeight: 17 },
    links: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm },
    link: { fontSize: FontSize.sm, color: colors.tint, fontWeight: '600' },
    dot: { color: colors.textMuted },
  });
}
