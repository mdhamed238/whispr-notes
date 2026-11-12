/** Detects this phone's tier once. */
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { DeviceTier, resolveTier } from './tiers';

let cached: DeviceTier | null = null;

export function detectTier(): DeviceTier {
  if (!cached) {
    cached = resolveTier({
      totalMemoryBytes: Device.totalMemory,
      abis: Device.supportedCpuArchitectures ?? [],
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
  }
  return cached;
}
