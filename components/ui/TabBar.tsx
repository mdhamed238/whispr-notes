/**
 * Bottom tab bar: icon and label per tab, docked to the bottom edge. No
 * moving parts; the selected tab is shown by color alone.
 */
import { Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { haptic } from '@/services/haptics';

/**
 * expo-router ships its own bottom-tabs types, which are structurally
 * incompatible with the standalone `@react-navigation/bottom-tabs` ones.
 * Deriving the props from the `Tabs` component we actually render keeps this
 * in step with whatever expo-router expects.
 */
type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

const BAR_HEIGHT = 58;

export default function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();

  // A bar sitting on top of the keyboard wastes the space being typed into.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (keyboardOpen) return null;

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const label = typeof options.title === 'string' ? options.title : route.name;
        const color = focused ? colors.tabIconSelected : colors.tabIconDefault;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            void haptic('selection');
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={styles.item}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: focused }}
          >
            {options.tabBarIcon?.({ focused, color, size: 24 })}
            <Text style={[styles.label, { color }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  item: { flex: 1, height: BAR_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: 11, fontWeight: '600' },
});
