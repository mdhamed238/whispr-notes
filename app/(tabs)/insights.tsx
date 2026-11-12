/**
 * Insights: what you've captured, when, and how much typing it saved.
 * Computed on this phone from your notes; nothing is sent anywhere.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import BarChart from '@/components/charts/BarChart';
import HourHeatmap from '@/components/charts/HourHeatmap';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import EmptyState from '@/components/ui/EmptyState';
import ScreenHeader from '@/components/ui/ScreenHeader';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius, Shadow } from '@/constants/theme';
import { usePro } from '@/hooks/usePro';
import * as notesRepo from '@/services/db/notesRepo';
import { haptic } from '@/services/haptics';
import { computeInsights, type Insights } from '@/services/insights/stats';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function formatMinutes(m: number): string {
  if (m < 60) return `${Math.round(m)}`;
  return `${(m / 60).toFixed(m < 600 ? 1 : 0)}`;
}

export default function InsightsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { isPro } = usePro();
  const [insights, setInsights] = useState<Insights | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      notesRepo
        .listNotes()
        .then((notes) => !cancelled && setInsights(computeInsights(notes, new Date())))
        .catch((e) => console.warn('Insights failed:', e));
    load();
    const unsubscribe = notesRepo.subscribe(() => load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const bars = useMemo(
    () =>
      (insights?.last14Days ?? []).map((d) => {
        const date = new Date(`${d.date}T12:00:00`);
        return {
          key: d.date,
          value: d.minutes,
          label: WEEKDAYS[date.getDay()],
          detail: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        };
      }),
    [insights]
  );

  if (insights && insights.totalNotes === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.headerPad}>
          <ScreenHeader title="Insights" />
        </View>
        <EmptyState
          icon="stats-chart-outline"
          title="Your insights start here"
          subtitle="Record a few notes and see your streaks, busiest hours and time saved."
        >
          <Button label="Record a note" icon="mic" onPress={() => router.navigate('/')} />
        </EmptyState>
      </SafeAreaView>
    );
  }

  const i = insights;
  const hours = i ? i.totalMinutes >= 60 : false;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Insights" subtitle="Calculated on this phone. Never sent anywhere." />

        {i && (
          <>
            <Animated.View entering={FadeInDown.duration(300)} style={styles.statRow}>
              <Stat styles={styles} value={formatMinutes(i.totalMinutes)} unit={hours ? 'hours' : 'minutes'} label="recorded" />
              <Stat styles={styles} value={i.totalWords >= 10000 ? `${Math.round(i.totalWords / 1000)}k` : `${i.totalWords}`} unit="words" label="captured" />
              <Stat
                styles={styles}
                value={`${i.currentStreak}`}
                unit={i.currentStreak === 1 ? 'day' : 'days'}
                label="streak"
                icon={i.currentStreak > 0 ? 'flame' : undefined}
                iconColor={colors.tint}
              />
            </Animated.View>

            <View>
              <Animated.View entering={FadeInDown.delay(80).duration(300)} style={[styles.card, !isPro && styles.locked]} pointerEvents={isPro ? 'auto' : 'none'}>
                <Text style={styles.cardTitle}>Last 14 days</Text>
                <BarChart
                  bars={bars}
                  color={colors.tint}
                  mutedColor={colors.textMuted}
                  textColor={colors.text}
                  gridColor={colors.border}
                  unit="min"
                />
              </Animated.View>

              <Animated.View entering={FadeInDown.delay(140).duration(300)} style={[styles.twoUp, !isPro && styles.locked]} pointerEvents={isPro ? 'auto' : 'none'}>
                <View style={[styles.card, styles.half]}>
                  <Ionicons name="time-outline" size={18} color={colors.tint} />
                  <Text style={styles.bigNumber}>{i.minutesSaved}</Text>
                  <Text style={styles.cardCaption}>minutes of typing saved</Text>
                </View>
                <View style={[styles.card, styles.half]}>
                  <Ionicons name="speedometer-outline" size={18} color={colors.tint} />
                  <Text style={styles.bigNumber}>{i.avgWordsPerMinute ?? '—'}</Text>
                  <Text style={styles.cardCaption}>words per minute</Text>
                </View>
              </Animated.View>

              <Animated.View entering={FadeInDown.delay(200).duration(300)} style={[styles.card, !isPro && styles.locked]} pointerEvents={isPro ? 'auto' : 'none'}>
                <Text style={styles.cardTitle}>When you record</Text>
                <HourHeatmap byHour={i.byHour} color={colors.tint} emptyColor={colors.surface} mutedColor={colors.textMuted} />
              </Animated.View>

              <Animated.View entering={FadeInDown.delay(260).duration(300)} style={[styles.card, !isPro && styles.locked]} pointerEvents={isPro ? 'auto' : 'none'}>
                <Text style={styles.cardTitle}>At a glance</Text>
                <View style={styles.glance}>
                  <Glance styles={styles} label="Notes" value={i.totalNotes} />
                  <Glance styles={styles} label="Recordings" value={i.recordedNotes} />
                  <Glance styles={styles} label="Summaries" value={i.summariesGenerated} />
                  <Glance styles={styles} label="Best streak" value={i.longestStreak} />
                </View>
                {i.topTags.length > 0 && (
                  <View style={styles.tags}>
                    {i.topTags.map((t) => (
                      <Chip key={t.tag} label={`#${t.tag} · ${t.count}`} tone="tint" onPress={() => router.navigate('/notes')} />
                    ))}
                  </View>
                )}
              </Animated.View>

              {!isPro && (
                <Pressable
                  style={styles.lockOverlay}
                  onPress={() => {
                    void haptic('selection');
                    router.push('/paywall');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Unlock Insights with Pro"
                >
                  <View style={styles.lockCard}>
                    <Ionicons name="lock-closed" size={20} color={colors.tint} />
                    <Text style={styles.lockTitle}>Unlock Insights</Text>
                    <Text style={styles.lockBody}>Charts, time saved, speaking pace and your recording habits.</Text>
                    <Text style={styles.lockCta}>See Pro plans →</Text>
                  </View>
                </Pressable>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({
  styles,
  value,
  unit,
  label,
  icon,
  iconColor,
}: {
  styles: ReturnType<typeof createStyles>;
  value: string;
  unit: string;
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
}) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${unit} ${label}`}>
      <View style={styles.statValueRow}>
        {icon && <Ionicons name={icon} size={18} color={iconColor} />}
        <Text style={styles.statValue}>{value}</Text>
      </View>
      <Text style={styles.statUnit}>
        {unit} {label}
      </Text>
    </View>
  );
}

function Glance({ styles, label, value }: { styles: ReturnType<typeof createStyles>; label: string; value: number }) {
  return (
    <View style={styles.glanceItem}>
      <Text style={styles.glanceValue}>{value}</Text>
      <Text style={styles.cardCaption}>{label}</Text>
    </View>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerPad: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg },
    content: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: 140, gap: Spacing.md },
    statRow: { flexDirection: 'row', gap: Spacing.sm },
    stat: { flex: 1, backgroundColor: colors.card, borderRadius: Radius.lg, padding: Spacing.md, ...Shadow.sm },
    statValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    statValue: { fontSize: 26, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
    statUnit: { fontSize: FontSize.xs, color: colors.textMuted, marginTop: 2 },
    card: { backgroundColor: colors.card, borderRadius: Radius.lg, padding: Spacing.lg, marginBottom: Spacing.md, ...Shadow.sm },
    cardTitle: { fontSize: FontSize.xs, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: Spacing.md },
    twoUp: { flexDirection: 'row', gap: Spacing.md },
    half: { flex: 1, gap: 4 },
    bigNumber: { fontSize: 28, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
    cardCaption: { fontSize: FontSize.xs, color: colors.textMuted },
    glance: { flexDirection: 'row', justifyContent: 'space-between' },
    glanceItem: { alignItems: 'center', flex: 1 },
    glanceValue: { fontSize: FontSize.lg, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.lg },
    locked: { opacity: 0.25 },
    lockOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', paddingTop: 80 },
    lockCard: {
      backgroundColor: colors.card,
      borderRadius: Radius.xl,
      padding: Spacing.xl,
      alignItems: 'center',
      gap: Spacing.sm,
      marginHorizontal: Spacing.lg,
      ...Shadow.lg,
    },
    lockTitle: { fontSize: FontSize.lg, fontWeight: '800', color: colors.text },
    lockBody: { fontSize: FontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
    lockCta: { fontSize: FontSize.md, fontWeight: '700', color: colors.tint, marginTop: Spacing.xs },
  });
}
