/**
 * First launch: what WhisprNotes does, the privacy promise, what downloads
 * once (and that the internet is used only for that and purchases), and
 * microphone access.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AudioManager } from 'react-native-audio-api';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import LogoMark from '@/components/brand/LogoMark';
import Button from '@/components/ui/Button';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { MODEL_CATALOG, formatBytes } from '@/services/ai/modelCatalog';
import { detectTier } from '@/services/ai/device';
import { chooseLlm } from '@/services/ai/tiers';
import { haptic } from '@/services/haptics';
import { updateSettings } from '@/services/settings';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const PAGES = 4;

export default function Onboarding() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const tier = detectTier();
  const llm = MODEL_CATALOG[chooseLlm(tier)];
  const base = MODEL_CATALOG['whisper-base-en'];

  const goTo = (next: number) => {
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) {
      setPage(next);
      void haptic('selection');
    }
  };

  const finish = async () => {
    try {
      await AudioManager.requestRecordingPermissions();
    } catch (error) {
      console.warn('Microphone permission request failed:', error);
    }
    await updateSettings({ onboardingCompleted: true });
    void haptic('success');
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        bounces={false}
      >
        <Page width={width} styles={styles}>
          <LogoMark size={88} />
          <LiveWave color={colors.tint} />
          <Text style={styles.title}>Speak. It's written.</Text>
          <Text style={styles.body}>
            Record meetings, ideas and memos. WhisprNotes turns them into accurate transcripts, summaries and action items.
          </Text>
        </Page>

        <Page width={width} styles={styles}>
          <View style={styles.iconHero}>
            <Ionicons name="shield-checkmark" size={44} color={colors.tint} />
          </View>
          <Text style={styles.title}>Your voice never leaves this phone.</Text>
          <View style={styles.points}>
            <Point styles={styles} color={colors.tint} icon="phone-portrait-outline" text="Transcription and AI summaries run on your phone, even in airplane mode." />
            <Point styles={styles} color={colors.tint} icon="person-remove-outline" text="No account. No analytics. No ads. No tracking." />
            <Point styles={styles} color={colors.tint} icon="lock-closed-outline" text="Nothing is shared unless you share it." />
          </View>
        </Page>

        <Page width={width} styles={styles}>
          <View style={styles.iconHero}>
            <Ionicons name="cloud-download-outline" size={44} color={colors.tint} />
          </View>
          <Text style={styles.title}>AI models install once.</Text>
          <Text style={styles.body}>
            To work offline, WhisprNotes downloads its AI models the first time they're needed. Wi-Fi recommended.
          </Text>
          <View style={styles.modelList}>
            <ModelRow styles={styles} name="Live transcription" size={formatBytes(base.approxBytes)} when="now" />
            <ModelRow styles={styles} name="Summaries & titles" size={formatBytes(llm.approxBytes)} when="first summary" />
            {tier === 'flagship' && (
              <ModelRow
                styles={styles}
                name="Large-v3 accuracy (Pro)"
                size={formatBytes(MODEL_CATALOG['whisper-large-v3-turbo'].approxBytes)}
                when="when you choose"
              />
            )}
          </View>
          <Text style={styles.fine}>The internet is used only for these downloads and for purchases. Never for your notes.</Text>
        </Page>

        <Page width={width} styles={styles}>
          <View style={styles.iconHero}>
            <Ionicons name="mic" size={44} color={colors.tint} />
          </View>
          <Text style={styles.title}>One last thing: the microphone.</Text>
          <Text style={styles.body}>WhisprNotes listens only while you're recording.</Text>
          <View style={styles.consent}>
            <Ionicons name="people-outline" size={18} color={colors.textMuted} />
            <Text style={styles.consentText}>Make sure everyone agrees to be recorded. Recording laws differ by place.</Text>
          </View>
        </Page>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots} accessibilityLabel={`Page ${page + 1} of ${PAGES}`}>
          {Array.from({ length: PAGES }, (_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        {page < PAGES - 1 ? (
          <View style={styles.footerButtons}>
            <Button label="Skip" variant="ghost" onPress={() => goTo(PAGES - 1)} style={{ flex: 1 }} />
            <Button label="Next" onPress={() => goTo(page + 1)} style={{ flex: 2 }} />
          </View>
        ) : (
          <Button label="Allow microphone & start" icon="mic" onPress={finish} haptic="medium" />
        )}
      </View>
    </SafeAreaView>
  );
}

function Page({ width, styles, children }: { width: number; styles: ReturnType<typeof createStyles>; children: React.ReactNode }) {
  return <View style={[styles.page, { width }]}>{children}</View>;
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
        <Text style={styles.modelWhen}>Downloads {when}</Text>
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
  const v = useSharedValue(0.3);
  useEffect(() => {
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
  }, [v, height, delay]);
  const style = useAnimatedStyle(() => ({ height: 8 + v.value * 40 }));
  return <Animated.View style={[{ width: 7, borderRadius: 4, backgroundColor: color }, style]} />;
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    page: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xxl, gap: Spacing.md },
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
    modelRow: { flexDirection: 'row', alignItems: 'center' },
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
