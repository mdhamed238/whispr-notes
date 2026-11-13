/** Privacy Policy, Terms of Use and "What's stored", bundled for offline reading. */
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Markdown from '@/components/Markdown';
import ModalHeader from '@/components/ui/ModalHeader';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Spacing } from '@/constants/Spacing';
import { LEGAL_DOCS, type LegalDoc } from '@/content/legal';

const TITLES: Record<LegalDoc, string> = { privacy: 'Privacy Policy', terms: 'Terms of Use', data: "What's stored" };

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const colors = Colors[useColorScheme() ?? 'light'];
  const key = (doc && doc in LEGAL_DOCS ? doc : null) as LegalDoc | null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ModalHeader title={key ? TITLES[key] : 'Document'} />
      <ScrollView contentContainerStyle={{ padding: Spacing.xl, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl * 2 }}>
        {key ? <Markdown source={LEGAL_DOCS[key]} skipTitle /> : <Text style={{ color: colors.textMuted }}>Document not found.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}
