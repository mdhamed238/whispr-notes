/**
 * This phone's tier (or the user's override) and the models it runs for the
 * language being recorded.
 */
import { useEffect, useState } from 'react';

import { useI18n } from '@/i18n';
import { detectTier } from '@/services/ai/device';
import { effectiveLanguage } from '@/services/ai/language';
import { MODEL_CATALOG } from '@/services/ai/modelCatalog';
import * as modelManager from '@/services/ai/modelManager';
import { chooseEngine, chooseLlm, type DeviceTier, type EngineId, type LlmId } from '@/services/ai/tiers';
import { useSettings } from '@/services/settings';

import { usePro } from './usePro';

export function useDeviceTier(): {
  detected: DeviceTier;
  tier: DeviceTier;
  engine: EngineId;
  llm: LlmId;
  engineLabel: string;
  /** The language recordings are transcribed in right now (never 'auto'). */
  spokenLanguage: string;
} {
  const [settings] = useSettings();
  const { isPro } = usePro();
  const { language } = useI18n();
  // Re-evaluate when a model finishes downloading or is removed.
  const [, bump] = useState(0);
  useEffect(() => modelManager.subscribeModels(() => bump((n) => n + 1)), []);

  const detected = detectTier();
  const tier = settings.tierOverride ?? detected;
  const spokenLanguage = effectiveLanguage(settings.transcriptionLanguage, language);
  // Large-v3 Turbo only counts once it is installed, exactly as the queue decides.
  const unavailable =
    modelManager.status('whisper-large-v3-turbo') === 'ready'
      ? settings.failedEngines
      : [...settings.failedEngines, 'whisper-large-v3-turbo'];
  const engine = chooseEngine({
    tier: detected,
    isPro,
    override: settings.tierOverride,
    failedEngines: unavailable,
    language: spokenLanguage,
  });
  const llm = chooseLlm(tier);
  return { detected, tier, engine, llm, engineLabel: MODEL_CATALOG[engine].name.replace(/^Whisper /, ''), spokenLanguage };
}
