/**
 * Base pressable used by every tappable element in the app: spring
 * scale-down on press plus an optional haptic on a completed tap.
 */
import { haptic as playHaptic, type HapticKind as ServiceHapticKind } from '@/services/haptics';
import React from 'react';
import { GestureResponderEvent, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

export type HapticKind = ServiceHapticKind | 'none';

interface Props extends Omit<PressableProps, 'style'> {
  scaleTo?: number;
  haptic?: HapticKind;
  style?: StyleProp<ViewStyle>;
  // Reanimated layout-animation props, forwarded straight through.
  entering?: any;
  exiting?: any;
  layout?: any;
}

export default function AnimatedPressable({
  scaleTo = 0.96,
  haptic = 'light',
  style,
  onPressIn,
  onPressOut,
  onPress,
  disabled,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePressIn = (e: GestureResponderEvent) => {
    scale.value = withSpring(scaleTo, { damping: 16, stiffness: 260 });
    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    scale.value = withSpring(1, { damping: 16, stiffness: 260 });
    onPressOut?.(e);
  };

  const handlePress = (e: GestureResponderEvent) => {
    if (haptic !== 'none') void playHaptic(haptic);
    onPress?.(e);
  };

  return (
    <AnimatedPressableBase
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[style, animatedStyle]}
      {...rest}
    />
  );
}
