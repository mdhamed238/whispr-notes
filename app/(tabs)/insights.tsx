/** Placeholder screen; filled in by a later task of the WhisprNotes Pro plan. */
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import EmptyState from '@/components/ui/EmptyState';
import ModalHeader from '@/components/ui/ModalHeader';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function Placeholder() {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ModalHeader title="Insights" />
      <EmptyState icon="construct-outline" title="Insights" subtitle="Your recording stats will appear here." />
    </SafeAreaView>
  );
}
