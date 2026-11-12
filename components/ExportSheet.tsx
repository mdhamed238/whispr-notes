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
import { exportAndShare, type ExportFormat } from '@/services/export/exporter';
import type { ExportScope } from '@/services/export/generators';
import { haptic } from '@/services/haptics';
import type { Note } from '@/types';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const FORMATS: { format: ExportFormat; label: string; hint: string; icon: IconName; pro: boolean }[] = [
  { format: 'pdf', label: 'PDF', hint: 'Branded, ready to send', icon: 'document-outline', pro: true },
  { format: 'md', label: 'Markdown', hint: 'Notion, Obsidian, docs', icon: 'logo-markdown', pro: true },
  { format: 'txt', label: 'Text', hint: 'Email or chat', icon: 'document-text-outline', pro: false },
  { format: 'srt', label: 'Subtitles', hint: '.srt with timings', icon: 'film-outline', pro: true },
  { format: 'audio', label: 'Audio', hint: 'Original recording', icon: 'musical-notes-outline', pro: true },
];

export function ExportPanel({ note, isPro, hasTimeline }: { note: Note; isPro: boolean; hasTimeline: boolean }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const sheet = useActionSheet();
  const toast = useToast();
  const router = useRouter();
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
      toast.show({ message: error instanceof Error ? error.message : 'Export failed.', tone: 'error' });
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
            { value: 'full', label: 'Summary + transcript' },
            { value: 'summary', label: 'Summary only' },
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
              accessibilityLabel={`${f.label}${locked ? ', requires Pro' : ''}`}
            >
              <View style={styles.tileTop}>
                {busy === f.format ? (
                  <ActivityIndicator color={colors.tint} />
                ) : (
                  <Ionicons name={f.icon} size={22} color={colors.tint} />
                )}
                {locked && <Ionicons name="lock-closed" size={13} color={colors.textMuted} />}
              </View>
              <Text style={[styles.tileLabel, { color: colors.text }]}>{f.label}</Text>
              <Text style={[styles.tileHint, { color: colors.textMuted }]} numberOfLines={1}>
                {f.hint}
              </Text>
            </AnimatedPressable>
          );
        })}
      </View>

      {hasTimeline && (
        <View style={styles.toggleRow}>
          <Text style={[styles.toggleLabel, { color: colors.text }]}>Include timestamps</Text>
          <Switch
            value={timestamps}
            onValueChange={(v) => {
              void haptic('selection');
              setTimestamps(v);
            }}
            trackColor={{ true: colors.tint, false: colors.border }}
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
