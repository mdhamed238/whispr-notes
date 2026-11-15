import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import type { ColorValue } from 'react-native';

import TabBar from '@/components/ui/TabBar';
import { useI18n } from '@/i18n';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(active: IconName, inactive: IconName) {
  return ({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) => (
    <Ionicons name={focused ? active : inactive} size={size} color={color as string} />
  );
}

export default function TabLayout() {
  const { t } = useI18n();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        // Each screen renders its own header. Tabs switch instantly, as
        // they do in the platforms' own tab bars.
        headerShown: false,
        animation: 'none',
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.record'), tabBarIcon: tabIcon('mic', 'mic-outline') }} />
      <Tabs.Screen
        name="notes"
        options={{ title: t('tabs.notes'), tabBarIcon: tabIcon('document-text', 'document-text-outline') }}
      />
      <Tabs.Screen
        name="insights"
        options={{ title: t('tabs.insights'), tabBarIcon: tabIcon('stats-chart', 'stats-chart-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: t('tabs.settings'), tabBarIcon: tabIcon('settings', 'settings-outline') }}
      />
    </Tabs>
  );
}
