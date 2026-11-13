/**
 * This phone's tier (or the user's override) and the models it runs.
 */
import { MODEL_CATALOG } from '@/services/ai/modelCatalog';
import { detectTier } from '@/services/ai/device';
import { chooseEngine, chooseLlm, type DeviceTier, type EngineId, type LlmId } from '@/services/ai/tiers';
import { useSettings } from '@/services/settings';

import { usePro } from './usePro';

export function useDeviceTier(): {
  detected: DeviceTier;
  tier: DeviceTier;
  engine: EngineId;
  llm: LlmId;
  engineLabel: string;
} {
  const [settings] = useSettings();
  const { isPro } = usePro();
  const detected = detectTier();
  const tier = settings.tierOverride ?? detected;
  const engine = chooseEngine({ tier: detected, isPro, override: settings.tierOverride, failedEngines: settings.failedEngines });
  const llm = chooseLlm(tier);
  return { detected, tier, engine, llm, engineLabel: MODEL_CATALOG[engine].name.replace(/^Whisper /, '') };
}
