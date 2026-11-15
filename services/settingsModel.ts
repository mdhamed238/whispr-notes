/**
 * User settings: shape, defaults and validation. Pure, so it's unit-tested;
 * persistence lives in services/settings.ts.
 */

import { type LanguagePreference, isAppLanguage } from '../i18n/languages';
import { DEFAULT_SUMMARY_STYLE, MAX_INSTRUCTIONS_CHARS, type SummaryStyle, isSummaryStyle } from './ai/summaryStyles';
import { DEVICE_TIERS, type DeviceTier } from './ai/tiers';

/** Summary language: the transcript's own, the app's, or a fixed ISO code. */
export const SUMMARY_LANGUAGE_TRANSCRIPT = 'transcript';
export const SUMMARY_LANGUAGE_APP = 'app';

export interface Settings {
  /** Interface language: follow the phone, or a fixed one. */
  appLanguage: LanguagePreference;
  hapticsEnabled: boolean;
  /** Null means "use the detected tier". */
  tierOverride: DeviceTier | null;
  /** 'auto' or an ISO-639-1 code for the final transcription pass. */
  transcriptionLanguage: string;
  /** Summarize automatically after the enhanced transcript lands. */
  autoSummarize: boolean;
  /** What summaries focus on (Pro beyond the default). */
  summaryStyle: SummaryStyle;
  /** 'transcript', 'app', or an ISO-639-1 code (Pro beyond 'transcript'). */
  summaryLanguage: string;
  /** The user's own standing instructions for summaries (Pro). */
  summaryInstructions: string;
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

/**
 * Settings after "Delete all data": preferences go back to defaults, but the
 * purchase entitlement and the free-summary log (timestamps only, no
 * content) are kept so neither a paying user loses Pro nor the quota resets.
 * The interface language is about the app, not the data, so it stays too.
 */
export function settingsAfterDataReset(current: Settings): Settings {
  return {
    ...DEFAULT_SETTINGS,
    appLanguage: current.appLanguage,
    onboardingCompleted: true,
    proCache: current.proCache,
    summaryLog: current.summaryLog,
    devProOverride: current.devProOverride,
  };
}

export const DEFAULT_SETTINGS: Settings = {
  appLanguage: 'system',
  hapticsEnabled: true,
  tierOverride: null,
  transcriptionLanguage: 'auto',
  autoSummarize: true,
  summaryStyle: DEFAULT_SUMMARY_STYLE,
  summaryLanguage: SUMMARY_LANGUAGE_TRANSCRIPT,
  summaryInstructions: '',
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

  const text = (key: keyof Settings) =>
    typeof s[key] === 'string' && (s[key] as string).length > 0 ? (s[key] as string) : (d[key] as string);

  return {
    appLanguage: s.appLanguage === 'system' || isAppLanguage(s.appLanguage) ? s.appLanguage : d.appLanguage,
    hapticsEnabled: bool('hapticsEnabled'),
    tierOverride: DEVICE_TIERS.includes(s.tierOverride as DeviceTier) ? (s.tierOverride as DeviceTier) : null,
    transcriptionLanguage: text('transcriptionLanguage'),
    autoSummarize: bool('autoSummarize'),
    summaryStyle: isSummaryStyle(s.summaryStyle) ? s.summaryStyle : d.summaryStyle,
    summaryLanguage: text('summaryLanguage'),
    summaryInstructions:
      typeof s.summaryInstructions === 'string' ? s.summaryInstructions.slice(0, MAX_INSTRUCTIONS_CHARS) : '',
    onboardingCompleted: bool('onboardingCompleted'),
    summaryLog: isStringArray(s.summaryLog) ? s.summaryLog : [],
    proCache,
    devProOverride: bool('devProOverride'),
    failedEngines: isStringArray(s.failedEngines) ? s.failedEngines : [],
  };
}
