/**
 * When you record: 24 hourly cells, shaded by how many recordings started
 * in that hour.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing } from '@/constants/Spacing';

export default function HourHeatmap({
  byHour,
  color,
  emptyColor,
  mutedColor,
  formatHour,
  accessibilityLabel,
}: {
  byHour: number[];
  color: string;
  emptyColor: string;
  mutedColor: string;
  /** Hour of day (0-23) as the user's locale writes it. */
  formatHour: (hour: number) => string;
  accessibilityLabel: string;
}) {
  const max = Math.max(...byHour, 0);
  const fmt = formatHour;
  return (
    <View accessibilityLabel={accessibilityLabel}>
      <View style={styles.row}>
        {byHour.map((count, h) => {
          const alpha = max > 0 && count > 0 ? 0.25 + 0.75 * (count / max) : 0;
          return (
            <View
              key={h}
              style={[
                styles.cell,
                { backgroundColor: count > 0 ? color : emptyColor, opacity: count > 0 ? alpha : 1 },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.labels}>
        {[0, 6, 12, 18, 23].map((h) => (
          <Text key={h} style={[styles.label, { color: mutedColor }]}>
            {fmt(h)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 3 },
  cell: { flex: 1, height: 28, borderRadius: 4 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xs },
  label: { fontSize: FontSize.xs - 1 },
});
