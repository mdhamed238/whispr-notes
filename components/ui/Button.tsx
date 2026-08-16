import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleProp, Text, ViewStyle } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';

import AnimatedPressable, { HapticKind } from './AnimatedPressable';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'ghost-destructive';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  haptic?: HapticKind;
}

export default function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  style,
  haptic,
}: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const palette: Record<Variant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.tint, fg: colors.onAccent },
    secondary: { bg: colors.surface, fg: colors.text },
    ghost: { bg: 'transparent', fg: colors.tint },
    destructive: { bg: colors.danger, fg: colors.onAccent },
    'ghost-destructive': { bg: 'transparent', fg: colors.danger },
  };
  const p = palette[variant];
  const isDisabled = disabled || loading;

  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={isDisabled}
      haptic={haptic ?? (variant === 'ghost' || variant === 'ghost-destructive' ? 'selection' : 'light')}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: p.bg,
          borderRadius: Radius.md,
          paddingVertical: Spacing.md,
          paddingHorizontal: Spacing.lg,
          borderWidth: p.border ? 1 : 0,
          borderColor: p.border,
          opacity: isDisabled ? 0.5 : 1,
          gap: Spacing.sm,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={p.fg} />}
          <Text style={{ color: p.fg, fontSize: FontSize.md, fontWeight: '600' }}>{label}</Text>
        </>
      )}
    </AnimatedPressable>
  );
}
