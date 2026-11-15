/**
 * Import results. Opened after picking files in Settings/Notes, or when
 * another app hands a file to WhisprNotes ("Open in WhisprNotes"), in which
 * case the import runs here.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '@/components/ui/Button';
import ModalHeader from '@/components/ui/ModalHeader';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { useI18n, type TKey } from '@/i18n';
import { haptic } from '@/services/haptics';
import { Paths } from 'expo-file-system';

import { importFiles, type ImportReport } from '@/services/import/importer';
import { incomingFileName, isAcceptableIncomingUri } from '@/services/import/incoming';

function parseReport(raw: string | undefined): ImportReport | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    return typeof r?.imported === 'number' ? (r as ImportReport) : null;
  } catch {
    return null;
  }
}

/**
 * The importer reports problems in English (its messages are pinned by
 * tests); known ones are shown translated, anything else as written.
 */
const REASONS: [RegExp, TKey][] = [
  [/unsupported file type/i, 'import.reason.unsupported'],
  [/could not read/i, 'import.reason.unreadable'],
  [/more than \d+ notes/i, 'import.reason.tooMany'],
  [/50 MB import limit/i, 'import.reason.archiveBudget'],
  [/larger than 100 MB/i, 'import.reason.archiveTooLarge'],
  [/too large|larger than 10 MB/i, 'import.reason.fileTooLarge'],
];

export default function ImportScreen() {
  const params = useLocalSearchParams<{ report?: string; uri?: string }>();
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { t, tp } = useI18n();
  const reasonText = (reason: string) => {
    const known = REASONS.find(([pattern]) => pattern.test(reason));
    return known ? t(known[1]) : reason;
  };
  const [report, setReport] = useState<ImportReport | null>(() => parseReport(params.report));
  const [running, setRunning] = useState(false);
  const incoming = params.uri && !params.report ? params.uri : null;
  const incomingOk = incoming ? isAcceptableIncomingUri(incoming, Paths.document.uri) : false;
  const incomingName = incoming ? incomingFileName(incoming) : '';

  // A file from another app is only imported after the user confirms it.
  const confirmIncoming = async () => {
    if (!incoming || !incomingOk) return;
    setRunning(true);
    try {
      setReport(await importFiles([{ uri: incoming, name: incomingName }]));
    } catch {
      setReport({ imported: 0, duplicates: 0, failed: [{ name: incomingName, reason: 'Could not read this file' }] });
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (report) void haptic(report.imported > 0 ? 'success' : report.failed.length ? 'error' : 'warning');
  }, [report]);

  return (
    <SafeAreaView style={styles.container}>
      <ModalHeader title={t('import.title')} variant="close" />
      <ScrollView contentContainerStyle={styles.content}>
        {incoming && !report && !running ? (
          <View style={{ gap: Spacing.lg }}>
            <View style={[styles.hero, { backgroundColor: colors.card }]}>
              <Ionicons name={incomingOk ? 'document-text-outline' : 'alert-circle-outline'} size={40} color={incomingOk ? colors.tint : colors.danger} />
              <Text style={styles.heroTitle}>{incomingOk ? t('import.confirmTitle', { name: incomingName }) : t('import.cantTitle')}</Text>
              <Text style={styles.muted}>{incomingOk ? t('import.confirmBody') : t('import.cantBody')}</Text>
            </View>
            {incomingOk && <Button label={t('import.action')} icon="download-outline" onPress={confirmIncoming} />}
            <Button label={t('common.cancel')} variant="secondary" onPress={() => router.back()} />
          </View>
        ) : running || !report ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.tint} />
            <Text style={styles.muted}>{t('import.running')}</Text>
          </View>
        ) : (
          <Animated.View entering={FadeInDown.duration(300)} style={{ gap: Spacing.lg }}>
            <View style={[styles.hero, { backgroundColor: `${colors.success}14` }]}>
              <Ionicons
                name={report.imported > 0 ? 'checkmark-circle' : 'information-circle'}
                size={40}
                color={report.imported > 0 ? colors.success : colors.textMuted}
              />
              <Text style={styles.heroTitle}>
                {report.imported > 0 ? tp('import.imported', report.imported) : t('import.nothingNew')}
              </Text>
              {report.duplicates > 0 && <Text style={styles.muted}>{tp('import.duplicates', report.duplicates)}</Text>}
            </View>

            {report.failed.length > 0 && (
              <View style={styles.failures}>
                <Text style={styles.sectionTitle}>{t('import.failedTitle')}</Text>
                {report.failed.map((f, i) => (
                  <View key={`${f.name}-${i}`} style={styles.failRow}>
                    <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.failName} numberOfLines={1}>
                        {f.name}
                      </Text>
                      <Text style={styles.failReason}>{reasonText(f.reason)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.muted}>{t('import.supported')}</Text>

            <Button
              label={t('import.viewNotes')}
              icon="document-text-outline"
              onPress={() => {
                router.dismissAll();
                router.navigate('/notes');
              }}
            />
          </Animated.View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: Spacing.xl },
    center: { alignItems: 'center', gap: Spacing.md, paddingTop: 80 },
    hero: { borderRadius: Radius.xl, padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm },
    heroTitle: { fontSize: FontSize.lg, fontWeight: '800', color: colors.text, textAlign: 'center' },
    muted: { fontSize: FontSize.sm, color: colors.textMuted, lineHeight: 20, textAlign: 'center' },
    failures: { backgroundColor: colors.card, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md },
    sectionTitle: { fontSize: FontSize.xs, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
    failRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
    failReason: { fontSize: FontSize.sm, color: colors.textMuted },
    failName: { fontSize: FontSize.sm, fontWeight: '600', color: colors.text },
  });
}
