/**
 * Export & share panel, shown inside the action sheet: pick a format, what to
 * include, and whether to stamp times. Pro formats show a lock and open the
 * paywall.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';

import { useActionSheet } from '@/components/ui/ActionSheet';
import AnimatedPressable from '@/components/ui/AnimatedPressable';
import SegmentedControl from '@/components/ui/SegmentedControl';
import { useToast } from '@/components/ui/Toast';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { useI18n, type TKey } from '@/i18n';
import { exportAndShare, type ExportFormat } from '@/services/export/exporter';
import type { ExportScope } from '@/services/export/generators';
import { haptic } from '@/services/haptics';
import type { Note } from '@/types';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Text and Markdown are free: a note should never be stuck in the app.
const FORMATS: { format: ExportFormat; label: TKey; hint: TKey; icon: IconName; pro: boolean }[] = [
  { format: 'txt', label: 'export.format.text', hint: 'export.hint.text', icon: 'document-text-outline', pro: false },
  { format: 'md', label: 'export.format.markdown', hint: 'export.hint.markdown', icon: 'logo-markdown', pro: false },
  { format: 'pdf', label: 'export.format.pdf', hint: 'export.hint.pdf', icon: 'document-outline', pro: true },
  { format: 'srt', label: 'export.format.subtitles', hint: 'export.hint.subtitles', icon: 'film-outline', pro: true },
  { format: 'audio', label: 'export.format.audio', hint: 'export.hint.audio', icon: 'musical-notes-outline', pro: true },
];

export function ExportPanel({ note, isPro, hasTimeline }: { note: Note; isPro: boolean; hasTimeline: boolean }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const sheet = useActionSheet();
  const toast = useToast();
  const router = useRouter();
  const { t } = useI18n();
  const [scope, setScope] = useState<ExportScope>('full');
  const [timestamps, setTimestamps] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const run = async (format: ExportFormat, locked: boolean) => {
    if (busy) return;
    if (locked) {
      sheet.close();
      router.push('/paywall');
      return;
    }
    setBusy(format);
    try {
      await exportAndShare(note, format, { scope, timestamps });
      void haptic('success');
      sheet.close();
    } catch (error) {
      console.error('Export failed:', error);
      toast.show({ message: t('export.failed'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const formats = FORMATS.filter((f) => f.format !== 'audio' || note.audioUri);

  return (
    <View style={styles.wrap}>
      {note.summary && (
        <SegmentedControl
          options={[
            { value: 'full', label: t('export.scopeFull') },
            { value: 'summary', label: t('export.scopeSummary') },
          ]}
          value={scope}
          onChange={setScope}
        />
      )}

      <View style={styles.grid}>
        {formats.map((f) => {
          const locked = f.pro && !isPro;
          return (
            <AnimatedPressable
              key={f.format}
              haptic="selection"
              scaleTo={0.96}
              onPress={() => run(f.format, locked)}
              style={[styles.tile, { backgroundColor: colors.surface }]}
              accessibilityRole="button"
              accessibilityLabel={locked ? t('export.lockedA11y', { format: t(f.label) }) : t(f.label)}
            >
              <View style={styles.tileTop}>
                {busy === f.format ? (
                  <ActivityIndicator color={colors.tint} />
                ) : (
                  <Ionicons name={f.icon} size={22} color={colors.tint} />
                )}
                {locked && <Ionicons name="lock-closed" size={13} color={colors.textMuted} />}
              </View>
              <Text style={[styles.tileLabel, { color: colors.text }]} numberOfLines={1}>
                {t(f.label)}
              </Text>
              <Text style={[styles.tileHint, { color: colors.textMuted }]} numberOfLines={2}>
                {t(f.hint)}
              </Text>
            </AnimatedPressable>
          );
        })}
      </View>

      {hasTimeline && (
        <View style={styles.toggleRow}>
          <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('export.timestamps')}</Text>
          <Switch
            value={timestamps}
            onValueChange={(v) => {
              void haptic('selection');
              setTimestamps(v);
            }}
            trackColor={{ true: colors.tint, false: colors.border }}
            accessibilityLabel={t('export.timestamps')}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.lg, paddingHorizontal: Spacing.sm, paddingBottom: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { width: '31.5%', flexGrow: 1, borderRadius: Radius.md, padding: Spacing.md, gap: 4, minHeight: 92 },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 24 },
  tileLabel: { fontSize: FontSize.md, fontWeight: '700' },
  tileHint: { fontSize: 11 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { fontSize: FontSize.md, fontWeight: '500' },
});
