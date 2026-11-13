/**
 * Custom floating pill tab bar for the (tabs) navigator: a dark rounded
 * dock with a spring-animated bubble sliding behind the active icon.
 */
import { Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Radius, Shadow } from '@/constants/theme';
import { haptic } from '@/services/haptics';

/**
 * expo-router ships its own bottom-tabs types, which are structurally
 * incompatible with the standalone `@react-navigation/bottom-tabs` ones
 * (their header option types disagree on `ColorValue` vs `string`). Deriving
 * the props from the `Tabs` component we actually render keeps this in step
 * with whatever expo-router expects, and avoids depending on a package the
 * app doesn't otherwise use.
 */
type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

const ITEM_SIZE = 60;
const BUBBLE_SIZE = 44;
const BUBBLE_OFFSET = (ITEM_SIZE - BUBBLE_SIZE) / 2;

export default function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  // A dock floating over the keyboard covers the field being typed into.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const indicator = useSharedValue(state.index * ITEM_SIZE + BUBBLE_OFFSET);

  useEffect(() => {
    indicator.value = withSpring(state.index * ITEM_SIZE + BUBBLE_OFFSET, {
      damping: 18,
      stiffness: 240,
    });
  }, [state.index, indicator]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicator.value }],
  }));

  if (keyboardOpen) return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrapper, { bottom: insets.bottom + 16 }]}>
      <View style={[styles.bar, { backgroundColor: colors.navBackground }]}>
        <Animated.View style={[styles.bubble, { backgroundColor: colors.tint }, indicatorStyle]} />
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const label = typeof options.title === 'string' ? options.title : route.name;

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
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={focused ? { selected: true } : {}}
            >
              {options.tabBarIcon?.({
                focused,
                color: focused ? colors.onAccent : 'rgba(255,255,255,0.5)',
                size: 22,
              })}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    borderRadius: Radius.pill,
    padding: 8,
    ...Shadow.lg,
  },
  bubble: {
    position: 'absolute',
    top: 8,
    left: 0,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
  },
  item: {
    width: ITEM_SIZE,
    height: BUBBLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
