/**
 * Insights: what you've captured, when, and how much typing it saved.
 * Computed on this phone from your notes; nothing is sent anywhere.
 *
 * Everyone sees totals, the streak and the last two weeks. Pro adds the
 * habit analysis: time saved, pace, when and on which days you record, tags.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { formatDate, formatNumber, getLocaleTag, useI18n } from '@/i18n';
import * as notesRepo from '@/services/db/notesRepo';
import { haptic } from '@/services/haptics';
import { computeInsights, type Insights } from '@/services/insights/stats';

/** Changes arrive in bursts (an import, a summary landing); recompute once they settle. */
const RELOAD_DEBOUNCE_MS = 300;

function formatMinutes(m: number): string {
  if (m < 60) return formatNumber(Math.round(m));
  return formatNumber(Math.round((m / 60) * (m < 600 ? 10 : 1)) / (m < 600 ? 10 : 1));
}

function formatHour(hour: number): string {
  const date = new Date(2000, 0, 1, hour);
  try {
    return date.toLocaleTimeString(getLocaleTag(), { hour: 'numeric' });
  } catch {
    return `${hour}:00`;
  }
}

export default function InsightsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { t, tp, language } = useI18n();
  const { isPro } = usePro();
  const [insights, setInsights] = useState<Insights | null>(null);

  // Tabs stay mounted, so this screen would otherwise recompute on every
  // write anywhere in the app. It reloads only while visible, and only when
  // something changed since it last did.
  const stale = useRef(true);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    stale.current = false;
    notesRepo
      .listNoteItems()
      .then((notes) => setInsights(computeInsights(notes, new Date())))
      .catch((e) => {
        stale.current = true;
        console.warn('Insights failed:', e);
      });
  }, []);

  useEffect(() => {
    const unsubscribe = notesRepo.subscribe(() => {
      stale.current = true;
      if (!focused.current) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, RELOAD_DEBOUNCE_MS);
    });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      unsubscribe();
    };
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (stale.current) load();
      return () => {
        focused.current = false;
      };
    }, [load])
  );

  const bars = useMemo(
    () =>
      (insights?.last14Days ?? []).map((d) => {
        const date = new Date(`${d.date}T12:00:00`);
        return {
          key: d.date,
          value: d.minutes,
          label: formatDate(date, { weekday: 'narrow' }),
          detail: formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' }),
        };
      }),
    // `language` re-labels the days when the interface language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [insights, language]
  );

  const weekdayBars = useMemo(
    () =>
      (insights?.byWeekday ?? []).map((count, day) => {
        // 2 Jan 2000 was a Sunday.
        const date = new Date(2000, 0, 2 + day, 12);
        return {
          key: String(day),
          value: count,
          label: formatDate(date, { weekday: 'narrow' }),
          detail: formatDate(date, { weekday: 'long' }),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [insights, language]
  );

  if (insights && insights.totalNotes === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.headerPad}>
          <ScreenHeader title={t('insights.title')} />
        </View>
        <EmptyState icon="stats-chart-outline" title={t('insights.emptyTitle')} subtitle={t('insights.emptyBody')}>
          <Button label={t('notes.recordNote')} icon="mic" onPress={() => router.navigate('/')} />
        </EmptyState>
      </SafeAreaView>
    );
  }

  const i = insights;
  const hours = i ? i.totalMinutes >= 60 : false;
  const locked = !isPro;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader title={t('insights.title')} subtitle={t('insights.subtitle')} />

        {i && (
          <>
            <Animated.View entering={FadeInDown.duration(300)} style={styles.statRow}>
              <Stat
                styles={styles}
                value={formatMinutes(i.totalMinutes)}
                caption={hours ? t('insights.hoursRecorded') : t('insights.minutesRecorded')}
              />
              <Stat
                styles={styles}
                value={i.totalWords >= 10000 ? `${formatNumber(Math.round(i.totalWords / 1000))}k` : formatNumber(i.totalWords)}
                caption={t('insights.wordsCaptured')}
              />
              <Stat
                styles={styles}
                value={formatNumber(i.currentStreak)}
                caption={tp('insights.dayStreak', i.currentStreak)}
                icon={i.currentStreak > 0 ? 'flame' : undefined}
                iconColor={colors.tint}
              />
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(80).duration(300)} style={styles.card}>
              <Text style={styles.cardTitle}>{t('insights.last14')}</Text>
              <BarChart
                bars={bars}
                color={colors.tint}
                mutedColor={colors.textMuted}
                textColor={colors.text}
                gridColor={colors.border}
                unit={t('insights.minutesUnit')}
              />
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(140).duration(300)} style={styles.card}>
              <Text style={styles.cardTitle}>{t('insights.glance')}</Text>
              <View style={styles.glance}>
                <Glance styles={styles} label={t('insights.notes')} value={formatNumber(i.totalNotes)} />
                <Glance styles={styles} label={t('insights.recordings')} value={formatNumber(i.recordedNotes)} />
                <Glance styles={styles} label={t('insights.summaries')} value={formatNumber(i.summariesGenerated)} />
                <Glance styles={styles} label={t('insights.bestStreak')} value={formatNumber(i.longestStreak)} />
              </View>
            </Animated.View>

            <View>
              <View style={locked ? styles.locked : undefined} pointerEvents={locked ? 'none' : 'auto'}>
                <View style={styles.twoUp}>
                  <View style={[styles.card, styles.half]}>
                    <Ionicons name="time-outline" size={18} color={colors.tint} />
                    <Text style={styles.bigNumber}>{formatNumber(i.minutesSaved)}</Text>
                    <Text style={styles.cardCaption}>{t('insights.typingSaved')}</Text>
                  </View>
                  <View style={[styles.card, styles.half]}>
                    <Ionicons name="speedometer-outline" size={18} color={colors.tint} />
                    <Text style={styles.bigNumber}>{i.avgWordsPerMinute !== null ? formatNumber(i.avgWordsPerMinute) : '—'}</Text>
                    <Text style={styles.cardCaption}>{t('insights.wordsPerMinute')}</Text>
                  </View>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{t('insights.whenYouRecord')}</Text>
                  <HourHeatmap
                    byHour={i.byHour}
                    color={colors.tint}
                    emptyColor={colors.surface}
                    mutedColor={colors.textMuted}
                    formatHour={formatHour}
                    accessibilityLabel={
                      i.peakHour !== null ? t('insights.peakHour', { hour: formatHour(i.peakHour) }) : t('insights.noRecordings')
                    }
                  />
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{t('insights.byWeekday')}</Text>
                  <BarChart
                    bars={weekdayBars}
                    color={colors.tint}
                    mutedColor={colors.textMuted}
                    textColor={colors.text}
                    gridColor={colors.border}
                    unit=""
                  />
                  {i.avgMinutesPerRecording !== null && (
                    <Text style={[styles.cardCaption, { marginTop: Spacing.sm }]}>
                      {t('insights.avgLength', { minutes: formatNumber(i.avgMinutesPerRecording) })}
                    </Text>
                  )}
                </View>

                {i.topTags.length > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>{t('insights.topTags')}</Text>
                    <View style={styles.tags}>
                      {i.topTags.map((item) => (
                        <Chip
                          key={item.tag}
                          label={`#${item.tag} · ${formatNumber(item.count)}`}
                          tone="tint"
                          onPress={() => router.navigate('/notes')}
                        />
                      ))}
                    </View>
                  </View>
                )}
              </View>

              {locked && (
                <Pressable
                  style={styles.lockOverlay}
                  onPress={() => {
                    void haptic('selection');
                    router.push('/paywall');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('insights.lockTitle')}
                >
                  <View style={styles.lockCard}>
                    <Ionicons name="lock-closed" size={20} color={colors.tint} />
                    <Text style={styles.lockTitle}>{t('insights.lockTitle')}</Text>
                    <Text style={styles.lockBody}>{t('insights.lockBody')}</Text>
                    <Text style={styles.lockCta}>{t('insights.lockCta')}</Text>
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
  caption,
  icon,
  iconColor,
}: {
  styles: ReturnType<typeof createStyles>;
  value: string;
  caption: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
}) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${caption}`}>
      <View style={styles.statValueRow}>
        {icon && <Ionicons name={icon} size={18} color={iconColor} />}
        <Text style={styles.statValue}>{value}</Text>
      </View>
      <Text style={styles.statUnit}>{caption}</Text>
    </View>
  );
}

function Glance({ styles, label, value }: { styles: ReturnType<typeof createStyles>; label: string; value: string }) {
  return (
    <View style={styles.glanceItem} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.glanceValue}>{value}</Text>
      <Text style={[styles.cardCaption, { textAlign: 'center' }]}>{label}</Text>
    </View>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerPad: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg },
    content: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.md },
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
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    locked: { opacity: 0.22 },
    lockOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', paddingTop: 56 },
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
