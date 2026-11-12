/**
 * The one place the app triggers haptics, so the Settings toggle applies
 * everywhere and each kind of interaction always feels the same:
 *
 * - selection: taps on tabs, chips, toggles, list rows
 * - light: pin, word seek, swipe threshold
 * - medium: record start (fired before the mic opens, see the record screen)
 * - heavy: confirming a destructive action
 * - success / warning / error: outcomes (saved, exported, purchased, failed)
 */

import * as Haptics from 'expo-haptics';
import { peekSettings } from './settings';

export type HapticKind = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

export async function haptic(kind: HapticKind): Promise<void> {
  if (!peekSettings().hapticsEnabled) return;
  try {
    switch (kind) {
      case 'selection':
        return await Haptics.selectionAsync();
      case 'light':
        return await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      case 'medium':
        return await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      case 'heavy':
        return await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      case 'success':
        return await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      case 'warning':
        return await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      case 'error':
        return await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  } catch {
    // Haptics are a nicety; devices without a motor simply skip them.
  }
}
