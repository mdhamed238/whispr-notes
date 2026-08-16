import React from 'react';
import { StyleProp, View, ViewProps, ViewStyle } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Radius, Shadow } from '@/constants/theme';

interface Props extends ViewProps {
  padding?: number;
  elevation?: 'sm' | 'md' | 'none';
  style?: StyleProp<ViewStyle>;
}

export default function Card({ style, padding = 16, elevation = 'sm', ...rest }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: Radius.lg,
          padding,
        },
        elevation === 'md' ? Shadow.md : elevation === 'sm' ? Shadow.sm : null,
        style,
      ]}
      {...rest}
    />
  );
}
