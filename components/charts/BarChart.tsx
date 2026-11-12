/**
 * 14-day minutes bar chart. Tap a bar for its exact value. Bars are drawn to
 * one scale with a labelled max gridline.
 */
import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { FontSize, Spacing } from '@/constants/Spacing';
import { haptic } from '@/services/haptics';

export interface Bar {
  key: string;
  value: number;
  label: string;
  detail: string;
}

const HEIGHT = 150;
const AXIS = 18;
const TOP = 16;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export default function BarChart({
  bars,
  color,
  mutedColor,
  textColor,
  gridColor,
  unit,
}: {
  bars: Bar[];
  color: string;
  mutedColor: string;
  textColor: string;
  gridColor: string;
  unit: string;
}) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const max = niceMax(Math.max(...bars.map((b) => b.value), 0));
  const plotH = HEIGHT - AXIS - TOP;
  const slot = bars.length > 0 ? width / bars.length : 0;
  const barW = Math.max(4, slot * 0.58);
  const active = selected ?? bars.length - 1;

  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <Text style={[styles.readout, { color: textColor }]} accessibilityLiveRegion="polite">
        {bars[active] ? `${bars[active].detail}: ${bars[active].value} ${unit}` : ' '}
      </Text>
      {width > 0 && (
        <Svg width={width} height={HEIGHT} accessibilityLabel={`Bar chart of ${unit} per day`}>
          <Line x1={0} x2={width} y1={TOP} y2={TOP} stroke={gridColor} strokeDasharray="3 4" />
          <SvgText x={width} y={TOP - 4} fontSize={10} fill={mutedColor} textAnchor="end">
            {`${max} ${unit}`}
          </SvgText>
          <Line x1={0} x2={width} y1={TOP + plotH} y2={TOP + plotH} stroke={gridColor} />
          {bars.map((b, i) => {
            const h = Math.max(b.value > 0 ? 3 : 0, (b.value / max) * plotH);
            const x = i * slot + (slot - barW) / 2;
            return (
              <G
                key={b.key}
                onPress={() => {
                  void haptic('selection');
                  setSelected(i);
                }}
              >
                {/* Full-height hit area so short bars are easy to tap. */}
                <Rect x={i * slot} y={TOP} width={slot} height={plotH} fill="transparent" />
                <Rect x={x} y={TOP + plotH - h} width={barW} height={h} rx={Math.min(4, barW / 2)} fill={i === active ? color : `${color}80`} />
                {(i % 2 === bars.length % 2 || i === bars.length - 1) && (
                  <SvgText x={i * slot + slot / 2} y={HEIGHT - 4} fontSize={10} fill={mutedColor} textAnchor="middle">
                    {b.label}
                  </SvgText>
                )}
              </G>
            );
          })}
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { fontSize: FontSize.sm, fontWeight: '700', marginBottom: Spacing.sm, fontVariant: ['tabular-nums'] },
});
