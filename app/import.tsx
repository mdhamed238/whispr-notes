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
import { usePro } from '@/hooks/usePro';
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

export default function ImportScreen() {
  const params = useLocalSearchParams<{ report?: string; uri?: string }>();
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { isPro, loading: proLoading } = usePro();
  const [report, setReport] = useState<ImportReport | null>(() => parseReport(params.report));
  const [running, setRunning] = useState(false);
  const incoming = params.uri && !params.report ? params.uri : null;
  const incomingOk = incoming ? isAcceptableIncomingUri(incoming, Paths.document.uri) : false;
  const incomingName = incoming ? incomingFileName(incoming) : '';

  // A file from another app is only imported after the user confirms it.
  const confirmIncoming = async () => {
    if (!incoming || !incomingOk) return;
    if (!isPro) {
      router.replace('/paywall');
      return;
    }
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
      <ModalHeader title="Import" variant="close" />
      <ScrollView contentContainerStyle={styles.content}>
        {incoming && !report && !running ? (
          <View style={{ gap: Spacing.lg }}>
            <View style={[styles.hero, { backgroundColor: colors.card }]}>
              <Ionicons name={incomingOk ? 'document-text-outline' : 'alert-circle-outline'} size={40} color={incomingOk ? colors.tint : colors.danger} />
              <Text style={styles.heroTitle}>{incomingOk ? `Import “${incomingName}”?` : "This file can't be imported"}</Text>
              <Text style={styles.muted}>
                {incomingOk
                  ? 'Its notes are added to WhisprNotes on this phone. Nothing is uploaded.'
                  : 'Open a Markdown, text, Evernote or zip file shared from another app.'}
              </Text>
            </View>
            {incomingOk && (
              <Button label={isPro || proLoading ? 'Import' : 'Import with Pro'} icon="download-outline" onPress={confirmIncoming} />
            )}
            <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
          </View>
        ) : running || !report ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.tint} />
            <Text style={styles.muted}>Importing…</Text>
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
                {report.imported > 0
                  ? `${report.imported} note${report.imported === 1 ? '' : 's'} imported`
                  : 'Nothing new to import'}
              </Text>
              {report.duplicates > 0 && (
                <Text style={styles.muted}>
                  {report.duplicates} already in WhisprNotes, skipped.
                </Text>
              )}
            </View>

            {report.failed.length > 0 && (
              <View style={styles.failures}>
                <Text style={styles.sectionTitle}>Couldn't import</Text>
                {report.failed.map((f, i) => (
                  <View key={`${f.name}-${i}`} style={styles.failRow}>
                    <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.failName} numberOfLines={1}>
                        {f.name}
                      </Text>
                      <Text style={styles.failReason}>{f.reason}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.muted}>
              Supported: Markdown (.md), text (.txt), Evernote (.enex) and .zip exports from Notion, Obsidian or Bear.
            </Text>

            <Button
              label="View notes"
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
