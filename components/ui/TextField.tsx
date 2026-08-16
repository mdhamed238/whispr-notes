import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleProp, TextInput, TextInputProps, ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';

interface Props extends TextInputProps {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  containerStyle?: StyleProp<ViewStyle>;
  onClear?: () => void;
}

export default function TextField({
  icon,
  containerStyle,
  onClear,
  value,
  onFocus,
  onBlur,
  style,
  ...rest
}: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const focus = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], [colors.border, colors.tint]),
  }));

  return (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderRadius: Radius.md,
          borderWidth: 1.5,
          paddingHorizontal: Spacing.md,
          gap: Spacing.sm,
        },
        animatedStyle,
        containerStyle,
      ]}
    >
      {icon && <Ionicons name={icon} size={18} color={colors.textMuted} />}
      <TextInput
        value={value}
        onFocus={(e) => {
          focus.value = withTiming(1, { duration: 180 });
          onFocus?.(e);
        }}
        onBlur={(e) => {
          focus.value = withTiming(0, { duration: 180 });
          onBlur?.(e);
        }}
        placeholderTextColor={colors.textMuted}
        style={[{ flex: 1, color: colors.text, fontSize: FontSize.md, paddingVertical: 12 }, style]}
        {...rest}
      />
      {onClear && !!value && (
        <Ionicons name="close-circle" size={18} color={colors.textMuted} onPress={onClear} hitSlop={8} />
      )}
    </Animated.View>
  );
}
