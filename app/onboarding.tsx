/** First-launch onboarding. Placeholder until Task 14. */
import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '@/components/ui/Button';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { updateSettings } from '@/services/settings';

export default function Onboarding() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, padding: Spacing.xl, justifyContent: 'center' }}>
      <View style={{ gap: Spacing.lg }}>
        <Text style={{ fontSize: FontSize.xxl, fontWeight: '800', color: colors.text }}>WhisprNotes</Text>
        <Button
          label="Continue"
          onPress={async () => {
            await updateSettings({ onboardingCompleted: true });
            router.replace('/');
          }}
        />
      </View>
    </SafeAreaView>
  );
}
