/**
 * Header for pushed and modal screens: back/close button, title, optional
 * trailing control.
 */
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';

import IconButton from './IconButton';

export default function ModalHeader({
  title,
  variant = 'back',
  right,
  onClose,
}: {
  title?: string;
  variant?: 'back' | 'close';
  right?: React.ReactNode;
  onClose?: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const router = useRouter();
  return (
    <View style={styles.row}>
      <IconButton
        name={variant === 'back' ? 'chevron-back' : 'close'}
        background={colors.surface}
        onPress={onClose ?? (() => router.back())}
      />
      {title ? (
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, gap: Spacing.md },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '800', textAlign: 'center' },
  right: { minWidth: 44, alignItems: 'flex-end' },
});
