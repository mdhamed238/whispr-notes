import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Radius } from '@/constants/theme';

import AnimatedPressable, { HapticKind } from './AnimatedPressable';

interface Props {
  name: React.ComponentProps<typeof Ionicons>['name'];
  onPress?: () => void;
  size?: number;
  color?: string;
  background?: string;
  style?: StyleProp<ViewStyle>;
  haptic?: HapticKind;
}

export default function IconButton({
  name,
  onPress,
  size = 20,
  color,
  background,
  style,
  haptic = 'selection',
}: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const dim = size + 24;

  return (
    <AnimatedPressable
      onPress={onPress}
      haptic={haptic}
      hitSlop={8}
      style={[
        {
          width: dim,
          height: dim,
          borderRadius: Radius.pill,
          backgroundColor: background ?? colors.card,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={color ?? colors.text} />
    </AnimatedPressable>
  );
}
