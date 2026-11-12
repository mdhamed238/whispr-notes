/**
 * User settings: shape, defaults and validation. Pure, so it's unit-tested;
 * persistence lives in services/settings.ts.
 */

import { DEVICE_TIERS, type DeviceTier } from './ai/tiers';

export interface Settings {
  hapticsEnabled: boolean;
  /** Null means "use the detected tier". */
  tierOverride: DeviceTier | null;
  /** 'auto' or an ISO-639-1 code for the final transcription pass. */
  transcriptionLanguage: string;
  /** Summarize automatically after the enhanced transcript lands. */
  autoSummarize: boolean;
  onboardingCompleted: boolean;
  /** ISO timestamps of AI summaries generated (free-tier weekly quota). */
  summaryLog: string[];
  /** Last known Pro entitlement, so Pro keeps working offline. */
  proCache: { isPro: boolean; checkedAt: string } | null;
  /** Developer-only override for testing Pro without store setup. */
  devProOverride: boolean;
  /** Engines that failed to load on this device; skipped on later runs. */
  failedEngines: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  hapticsEnabled: true,
  tierOverride: null,
  transcriptionLanguage: 'auto',
  autoSummarize: true,
  onboardingCompleted: false,
  summaryLog: [],
  proCache: null,
  devProOverride: false,
  failedEngines: [],
};

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === 'string');

/** Validates stored settings field by field; anything invalid takes its default. */
export function mergeSettings(stored: unknown): Settings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const bool = (key: keyof Settings) => (typeof s[key] === 'boolean' ? (s[key] as boolean) : (d[key] as boolean));

  const proCache =
    s.proCache &&
    typeof s.proCache === 'object' &&
    typeof (s.proCache as { isPro?: unknown }).isPro === 'boolean' &&
    typeof (s.proCache as { checkedAt?: unknown }).checkedAt === 'string'
      ? (s.proCache as Settings['proCache'])
      : null;

  return {
    hapticsEnabled: bool('hapticsEnabled'),
    tierOverride: DEVICE_TIERS.includes(s.tierOverride as DeviceTier) ? (s.tierOverride as DeviceTier) : null,
    transcriptionLanguage:
      typeof s.transcriptionLanguage === 'string' && s.transcriptionLanguage.length > 0
        ? s.transcriptionLanguage
        : d.transcriptionLanguage,
    autoSummarize: bool('autoSummarize'),
    onboardingCompleted: bool('onboardingCompleted'),
    summaryLog: isStringArray(s.summaryLog) ? s.summaryLog : [],
    proCache,
    devProOverride: bool('devProOverride'),
    failedEngines: isStringArray(s.failedEngines) ? s.failedEngines : [],
  };
}
