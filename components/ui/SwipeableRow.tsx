/**
 * List row with full-swipe actions: swipe right for the left action (e.g.
 * pin), swipe left for the right action (e.g. delete). The action fires when
 * the row is released past the threshold, with a light haptic as the
 * threshold is crossed so the user feels the commit point.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { SharedValue, runOnJS, useAnimatedReaction, useAnimatedStyle } from 'react-native-reanimated';

import { Radius } from '@/constants/theme';
import { haptic } from '@/services/haptics';

export interface SwipeAction {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  onTrigger: () => void;
  accessibilityLabel: string;
}

const ACTION_WIDTH = 84;

function ActionPanel({
  action,
  side,
  progress,
}: {
  action: SwipeAction;
  side: 'left' | 'right';
  progress: SharedValue<number>;
}) {
  useAnimatedReaction(
    () => progress.value >= 1,
    (crossed, previous) => {
      if (crossed && previous === false) runOnJS(haptic)('light');
    }
  );

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: Math.min(1.15, 0.6 + progress.value * 0.5) }],
    opacity: Math.min(1, progress.value * 1.4),
  }));

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: action.color, alignItems: side === 'left' ? 'flex-start' : 'flex-end' },
      ]}
      accessibilityLabel={action.accessibilityLabel}
    >
      <Animated.View style={[styles.iconWrap, iconStyle]}>
        <Ionicons name={action.icon} size={22} color="#FFFFFF" />
      </Animated.View>
    </View>
  );
}

export default function SwipeableRow({
  children,
  leftAction,
  rightAction,
}: {
  children: React.ReactNode;
  leftAction?: SwipeAction;
  rightAction?: SwipeAction;
}) {
  const ref = useRef<SwipeableMethods>(null);

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.6}
      overshootFriction={8}
      leftThreshold={ACTION_WIDTH}
      rightThreshold={ACTION_WIDTH}
      containerStyle={styles.container}
      renderLeftActions={
        leftAction ? (progress) => <ActionPanel action={leftAction} side="left" progress={progress} /> : undefined
      }
      renderRightActions={
        rightAction ? (progress) => <ActionPanel action={rightAction} side="right" progress={progress} /> : undefined
      }
      onSwipeableOpen={(direction) => {
        // RIGHT means the row moved right, revealing the left action.
        const action = direction === SwipeDirection.RIGHT ? leftAction : rightAction;
        ref.current?.close();
        action?.onTrigger();
      }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: Radius.lg, marginBottom: 12 },
  panel: {
    width: ACTION_WIDTH,
    justifyContent: 'center',
    paddingHorizontal: 28,
    borderRadius: Radius.lg,
  },
  iconWrap: { width: 28, alignItems: 'center' },
});
