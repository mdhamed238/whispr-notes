/**
 * First launch: what WhisprNotes does, the privacy promise (nothing leaves
 * the phone), what downloads once, and microphone access.
 *
 * Pages are shown one at a time rather than in a horizontal pager, so the
 * flow reads the same in left-to-right and right-to-left languages.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AudioManager } from 'react-native-audio-api';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import LogoMark from '@/components/brand/LogoMark';
import AnimatedPressable from '@/components/ui/AnimatedPressable';
import Button from '@/components/ui/Button';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { languageLabel } from '@/constants/languages';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { useI18n } from '@/i18n';
import { detectTier } from '@/services/ai/device';
import { effectiveLanguage } from '@/services/ai/language';
import { MODEL_CATALOG, formatBytes } from '@/services/ai/modelCatalog';
import { prefetchSpeechModel } from '@/services/ai/modelPrefetch';
import { chooseLlm } from '@/services/ai/tiers';
import { haptic } from '@/services/haptics';
import { updateSettings, useSettings } from '@/services/settings';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const PAGES = 4;

export default function Onboarding() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { t, language } = useI18n();
  const [settings] = useSettings();
  const [page, setPage] = useState(0);
  const tier = detectTier();
  const llm = MODEL_CATALOG[chooseLlm(tier)];
  const spoken = effectiveLanguage(settings.transcriptionLanguage, language);
  // English records with the live-preview model; other languages with the multilingual one.
  const speech = MODEL_CATALOG[spoken === 'en' ? 'whisper-base-en' : 'whisper-base'];

  const goTo = (next: number) => {
    setPage(Math.max(0, Math.min(PAGES - 1, next)));
    void haptic('selection');
  };

  const finish = async () => {
    try {
      await AudioManager.requestRecordingPermissions();
    } catch (error) {
      console.warn('Microphone permission request failed:', error);
    }
    await updateSettings({ onboardingCompleted: true });
    // Start fetching the speech model for this language while the user looks around.
    prefetchSpeechModel();
    void haptic('success');
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <AnimatedPressable
          haptic="selection"
          onPress={() => router.push({ pathname: '/language', params: { kind: 'app' } })}
          style={styles.languageChip}
          accessibilityRole="button"
          accessibilityLabel={`${t('lang.title.app')}: ${languageLabel(language)}`}
        >
          <Ionicons name="globe-outline" size={15} color={colors.tint} />
          <Text style={styles.languageChipText}>{languageLabel(language)}</Text>
          <Ionicons name="chevron-down" size={13} color={colors.textMuted} />
        </AnimatedPressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View key={page} entering={FadeIn.duration(220)} style={styles.page}>
          {page === 0 && (
            <>
              <LogoMark size={88} />
              <LiveWave color={colors.tint} />
              <Text style={styles.title}>{t('onboarding.welcomeTitle')}</Text>
              <Text style={styles.body}>{t('onboarding.welcomeBody')}</Text>
            </>
          )}

          {page === 1 && (
            <>
              <View style={styles.iconHero}>
                <Ionicons name="shield-checkmark" size={44} color={colors.tint} />
              </View>
              <Text style={styles.title}>{t('onboarding.privacyTitle')}</Text>
              <View style={styles.points}>
                <Point styles={styles} color={colors.tint} icon="phone-portrait-outline" text={t('onboarding.privacyOnDevice')} />
                <Point styles={styles} color={colors.tint} icon="person-remove-outline" text={t('onboarding.privacyNoAccount')} />
                <Point styles={styles} color={colors.tint} icon="lock-closed-outline" text={t('onboarding.privacyShare')} />
              </View>
            </>
          )}

          {page === 2 && (
            <>
              <View style={styles.iconHero}>
                <Ionicons name="cloud-download-outline" size={44} color={colors.tint} />
              </View>
              <Text style={styles.title}>{t('onboarding.modelsTitle')}</Text>
              <Text style={styles.body}>{t('onboarding.modelsBody')}</Text>
              <View style={styles.modelList}>
                <ModelRow
                  styles={styles}
                  name={t('onboarding.modelSpeech', { language: languageLabel(spoken) })}
                  size={formatBytes(speech.approxBytes)}
                  when={t('onboarding.whenNow')}
                />
                <ModelRow
                  styles={styles}
                  name={t('onboarding.modelSummaries')}
                  size={formatBytes(llm.approxBytes)}
                  when={t('onboarding.whenFirstSummary')}
                />
                {tier === 'flagship' && (
                  <ModelRow
                    styles={styles}
                    name={t('onboarding.modelTurbo')}
                    size={formatBytes(MODEL_CATALOG['whisper-large-v3-turbo'].approxBytes)}
                    when={t('onboarding.whenYouChoose')}
                  />
                )}
              </View>
              <Text style={styles.fine}>{t('onboarding.modelsFine')}</Text>
            </>
          )}

          {page === 3 && (
            <>
              <View style={styles.iconHero}>
                <Ionicons name="mic" size={44} color={colors.tint} />
              </View>
              <Text style={styles.title}>{t('onboarding.micTitle')}</Text>
              <Text style={styles.body}>{t('onboarding.micBody')}</Text>
              <View style={styles.consent}>
                <Ionicons name="people-outline" size={18} color={colors.textMuted} />
                <Text style={styles.consentText}>{t('onboarding.consent')}</Text>
              </View>
            </>
          )}
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots} accessibilityLabel={t('onboarding.pageOf', { page: page + 1, total: PAGES })}>
          {Array.from({ length: PAGES }, (_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        {page < PAGES - 1 ? (
          <View style={styles.footerButtons}>
            {page === 0 ? (
              <Button label={t('onboarding.skip')} variant="ghost" onPress={() => goTo(PAGES - 1)} style={{ flex: 1 }} />
            ) : (
              <Button label={t('common.back')} variant="ghost" onPress={() => goTo(page - 1)} style={{ flex: 1 }} />
            )}
            <Button label={t('onboarding.next')} onPress={() => goTo(page + 1)} style={{ flex: 2 }} />
          </View>
        ) : (
          <View style={styles.footerButtons}>
            <Button label={t('common.back')} variant="ghost" onPress={() => goTo(page - 1)} style={{ flex: 1 }} />
            <Button label={t('onboarding.start')} icon="mic" onPress={finish} haptic="medium" style={{ flex: 2 }} />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function Point({ styles, color, icon, text }: { styles: ReturnType<typeof createStyles>; color: string; icon: IconName; text: string }) {
  return (
    <View style={styles.point}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={styles.pointText}>{text}</Text>
    </View>
  );
}

function ModelRow({ styles, name, size, when }: { styles: ReturnType<typeof createStyles>; name: string; size: string; when: string }) {
  return (
    <View style={styles.modelRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.modelName}>{name}</Text>
        <Text style={styles.modelWhen}>{when}</Text>
      </View>
      <Text style={styles.modelSize}>{size}</Text>
    </View>
  );
}

const WAVE = [0.35, 0.7, 0.5, 1, 0.6, 0.85, 0.4];

function LiveWave({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', height: 48, marginVertical: Spacing.lg }}>
      {WAVE.map((h, i) => (
        <WaveBar key={i} height={h} delay={i * 90} color={color} />
      ))}
    </View>
  );
}

function WaveBar({ height, delay, color }: { height: number; delay: number; color: string }) {
  const reduceMotion = useReducedMotion();
  const v = useSharedValue(reduceMotion ? height : 0.3);
  useEffect(() => {
    if (reduceMotion) return;
    v.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(height, { duration: 420, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 420, easing: Easing.inOut(Easing.ease) })
        ),
        -1
      )
    );
  }, [v, height, delay, reduceMotion]);
  const style = useAnimatedStyle(() => ({ height: 8 + v.value * 40 }));
  return <Animated.View style={[{ width: 7, borderRadius: 4, backgroundColor: color }, style]} />;
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm },
    languageChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.surface,
      borderRadius: Radius.pill,
      paddingHorizontal: Spacing.md,
      minHeight: 36,
    },
    languageChipText: { fontSize: FontSize.sm, fontWeight: '700', color: colors.text },
    scroll: { flexGrow: 1, justifyContent: 'center' },
    page: { alignItems: 'center', paddingHorizontal: Spacing.xxl, paddingVertical: Spacing.xl, gap: Spacing.md },
    iconHero: {
      width: 96,
      height: 96,
      borderRadius: 30,
      backgroundColor: `${colors.tint}1A`,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.md,
    },
    title: { fontSize: 28, fontWeight: '800', color: colors.text, textAlign: 'center', lineHeight: 34 },
    body: { fontSize: FontSize.md, color: colors.textMuted, textAlign: 'center', lineHeight: 23 },
    fine: { fontSize: FontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 19, marginTop: Spacing.sm },
    points: { gap: Spacing.md, marginTop: Spacing.md, alignSelf: 'stretch' },
    point: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
    pointText: { flex: 1, fontSize: FontSize.md, color: colors.text, lineHeight: 22 },
    modelList: { alignSelf: 'stretch', backgroundColor: colors.card, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md, marginTop: Spacing.sm },
    modelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    modelName: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    modelWhen: { fontSize: FontSize.xs, color: colors.textMuted },
    modelSize: { fontSize: FontSize.sm, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
    consent: {
      flexDirection: 'row',
      gap: Spacing.sm,
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      padding: Spacing.md,
      marginTop: Spacing.md,
    },
    consentText: { flex: 1, fontSize: FontSize.sm, color: colors.textMuted, lineHeight: 19 },
    footer: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.lg, gap: Spacing.lg },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
    dotActive: { width: 22, backgroundColor: colors.tint },
    footerButtons: { flexDirection: 'row', gap: Spacing.md },
  });
}
