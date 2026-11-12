/**
 * Non-blocking feedback ("Note deleted · Undo") shown above the tab bar.
 * Replaces Alert for anything that doesn't need a decision.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand } from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import { Radius, Shadow } from '@/constants/theme';
import { haptic } from '@/services/haptics';

export interface ToastOptions {
  message: string;
  action?: { label: string; onPress: () => void };
  tone?: 'default' | 'success' | 'error';
  durationMs?: number;
  /** Called when the toast goes away without its action being pressed. */
  onDismiss?: () => void;
}

interface ToastState extends ToastOptions {
  key: number;
}

const ToastContext = createContext<{ show: (options: ToastOptions) => void }>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const ICONS = { default: null, success: 'checkmark-circle', error: 'alert-circle' } as const;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToastState] = useState<ToastState | null>(null);
  // Mirrors `toast` so callbacks can see the current one without running
  // side effects inside a state updater.
  const toastRef = useRef<ToastState | null>(null);
  const setToast = useCallback((next: ToastState | null) => {
    toastRef.current = next;
    setToastState(next);
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(0);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const dismiss = useCallback((current: ToastState | null, viaAction: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!current || toastRef.current?.key !== current.key) return;
    if (!viaAction) current.onDismiss?.();
    setToast(null);
  }, [setToast]);

  const show = useCallback(
    (options: ToastOptions) => {
      // A replaced toast still counts as dismissed (e.g. finalize a delete).
      toastRef.current?.onDismiss?.();
      setToast({ ...options, key: ++keyRef.current });
      if (options.tone === 'error') void haptic('error');
    },
    [setToast]
  );

  useEffect(() => {
    if (!toast) return;
    timer.current = setTimeout(() => dismiss(toast, false), toast.durationMs ?? 4000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast, dismiss]);

  const value = useMemo(() => ({ show }), [show]);
  const icon = toast ? ICONS[toast.tone ?? 'default'] : null;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <Animated.View
          key={toast.key}
          entering={reduceMotion ? FadeIn.duration(150) : SlideInDown.springify().damping(18)}
          exiting={reduceMotion ? FadeOut.duration(150) : SlideOutDown.duration(180)}
          style={[styles.wrap, { bottom: insets.bottom + 96 }]}
          pointerEvents="box-none"
        >
          <View style={styles.toast} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {icon && (
              <Ionicons name={icon} size={18} color={toast.tone === 'error' ? '#FF8A80' : '#7EE2B8'} />
            )}
            <Text style={styles.message} numberOfLines={2}>
              {toast.message}
            </Text>
            {toast.action && (
              <Pressable
                hitSlop={10}
                onPress={() => {
                  void haptic('selection');
                  toast.action?.onPress();
                  dismiss(toast, true);
                }}
              >
                <Text style={styles.action}>{toast.action.label}</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Brand.ink,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    maxWidth: 520,
    width: '100%',
    ...Shadow.lg,
  },
  message: { flex: 1, color: '#FFFFFF', fontSize: FontSize.sm, fontWeight: '600' },
  action: { color: Brand.peach, fontSize: FontSize.sm, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
});
