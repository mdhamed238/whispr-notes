/** Legal documents and the "what's stored" page. Content arrives in Task 14. */
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ModalHeader from '@/components/ui/ModalHeader';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Spacing } from '@/constants/Spacing';

const TITLES: Record<string, string> = { privacy: 'Privacy Policy', terms: 'Terms of Use', data: "What's stored" };

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ModalHeader title={TITLES[doc ?? ''] ?? 'Document'} />
      <ScrollView contentContainerStyle={{ padding: Spacing.xl }}>
        <Text style={{ color: colors.textMuted }}>Coming soon.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
