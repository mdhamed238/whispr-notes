/**
 * Bottom action sheet (replaces Alert-based menus). Drag down or tap the
 * backdrop to close.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius } from '@/constants/theme';
import { haptic } from '@/services/haptics';

export interface SheetAction {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  destructive?: boolean;
  /** Small trailing label, e.g. "PRO". */
  badge?: string;
  onPress: () => void;
}

export interface SheetOptions {
  title?: string;
  message?: string;
  actions: SheetAction[];
  /** Arbitrary content rendered above the actions. */
  content?: React.ReactNode;
}

const SheetContext = createContext<{ open: (options: SheetOptions) => void; close: () => void }>({
  open: () => {},
  close: () => {},
});

export function useActionSheet() {
  return useContext(SheetContext);
}

export function ActionSheetProvider({ children }: { children: React.ReactNode }) {
  const [sheet, setSheet] = useState<SheetOptions | null>(null);
  const colors = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const dragY = useSharedValue(0);

  const close = useCallback(() => setSheet(null), []);
  const open = useCallback(
    (options: SheetOptions) => {
      dragY.value = 0;
      void haptic('selection');
      setSheet(options);
    },
    [dragY]
  );

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) {
        runOnJS(close)();
      } else {
        dragY.value = withSpring(0, { damping: 18 });
      }
    });

  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.value }] }));
  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <SheetContext.Provider value={value}>
      {children}
      <Modal visible={sheet !== null} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
        <GestureHandlerRootView style={{ flex: 1 }}>
          {sheet && (
            <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={styles.backdrop}>
              <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close menu" />
            </Animated.View>
          )}
          {sheet && (
            <GestureDetector gesture={pan}>
              <Animated.View
                entering={SlideInDown.springify().damping(20)}
                exiting={SlideOutDown.duration(180)}
                style={[
                  styles.sheet,
                  { backgroundColor: colors.card, paddingBottom: insets.bottom + Spacing.lg },
                  dragStyle,
                ]}
              >
                <View style={[styles.grabber, { backgroundColor: colors.border }]} />
                {sheet.title && <Text style={[styles.title, { color: colors.text }]}>{sheet.title}</Text>}
                {sheet.message && <Text style={[styles.message, { color: colors.textMuted }]}>{sheet.message}</Text>}
                {sheet.content}
                {sheet.actions.map((action) => (
                  <Pressable
                    key={action.label}
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
                    onPress={() => {
                      void haptic(action.destructive ? 'warning' : 'selection');
                      close();
                      // Let the sheet start closing before the action (which may open another sheet or screen).
                      setTimeout(action.onPress, 120);
                    }}
                    accessibilityRole="button"
                  >
                    {action.icon && (
                      <Ionicons name={action.icon} size={20} color={action.destructive ? colors.danger : colors.text} />
                    )}
                    <Text style={[styles.rowLabel, { color: action.destructive ? colors.danger : colors.text }]}>
                      {action.label}
                    </Text>
                    {action.badge && (
                      <Text style={[styles.badge, { color: colors.tint, borderColor: colors.tint }]}>{action.badge}</Text>
                    )}
                  </Pressable>
                ))}
              </Animated.View>
            </GestureDetector>
          )}
        </GestureHandlerRootView>
      </Modal>
    </SheetContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10, 6, 16, 0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: Spacing.md },
  title: { fontSize: FontSize.md, fontWeight: '800', paddingHorizontal: Spacing.sm, marginBottom: Spacing.xs },
  message: { fontSize: FontSize.sm, paddingHorizontal: Spacing.sm, marginBottom: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 14,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  rowLabel: { flex: 1, fontSize: FontSize.md, fontWeight: '600' },
  badge: {
    fontSize: 10,
    fontWeight: '800',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    letterSpacing: 0.5,
  },
});
