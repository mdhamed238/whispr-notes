import React from 'react';
import { StyleProp, Text, TextStyle, View, ViewStyle } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';

import AnimatedPressable from './AnimatedPressable';

interface Props {
  label: string;
  onPress?: () => void;
  onRemove?: () => void;
  tone?: 'tint' | 'muted';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export default function Chip({ label, onPress, onRemove, tone = 'tint', style, textStyle }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const bg = tone === 'tint' ? `${colors.tint}1A` : colors.surface;
  const fg = tone === 'tint' ? colors.tint : colors.textMuted;

  const content = (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: bg,
          borderRadius: Radius.pill,
          paddingHorizontal: Spacing.md,
          paddingVertical: 6,
          gap: 4,
        },
        style,
      ]}
    >
      <Text style={[{ color: fg, fontSize: FontSize.sm, fontWeight: '600' }, textStyle]}>{label}</Text>
      {onRemove && (
        <Text
          onPress={onRemove}
          style={{ color: fg, fontSize: FontSize.sm, fontWeight: '700', paddingLeft: 2 }}
        >
          ×
        </Text>
      )}
    </View>
  );

  if (!onPress) return content;

  return (
    <AnimatedPressable onPress={onPress} haptic="selection" style={{ borderRadius: Radius.pill }}>
      {content}
    </AnimatedPressable>
  );
}
