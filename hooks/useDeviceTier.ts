/**
 * Detected device tier and the engine it runs. Placeholder until Task 7
 * adds detection; reads only the user's override.
 */
import type { DeviceTier } from '@/services/ai/tiers';
import { useSettings } from '@/services/settings';

export function useDeviceTier(): { tier: DeviceTier; engineLabel: string } {
  const [settings] = useSettings();
  return { tier: settings.tierOverride ?? 'standard', engineLabel: 'Whisper Base' };
}
