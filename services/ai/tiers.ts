/**
 * Device capability tiers and model selection. Pure: device facts and
 * entitlement come in as arguments, so every branch is unit-tested.
 */

export type DeviceTier = 'flagship' | 'standard' | 'lite';
export const DEVICE_TIERS: DeviceTier[] = ['flagship', 'standard', 'lite'];

/**
 * `whisper-base` is the multilingual Base model (whisper.cpp); `whisper-base-en`
 * is the English-only one (ExecuTorch), which is also the live-preview model.
 */
export type EngineId = 'whisper-large-v3-turbo' | 'whisper-small' | 'whisper-base' | 'whisper-base-en';
export type LlmId = 'qwen3-1.7b' | 'qwen3-0.6b';

const GiB = 2 ** 30;
// Phones report less RAM than marketed (kernel and carve-outs): an "8 GB"
// Galaxy S23 shows ~7.3 GiB, some 8 GB phones under 7, and a "6 GB" phone
// ~5.5 GiB. Thresholds sit
// below those so each marketed class lands in its intended tier.
const FLAGSHIP_MIN_BYTES = 6.5 * GiB;
const STANDARD_MIN_BYTES = 5.0 * GiB;

export function resolveTier(d: {
  totalMemoryBytes: number | null;
  abis: string[];
  platform: 'ios' | 'android';
}): DeviceTier {
  // ExecuTorch and whisper.cpp ship 64-bit ARM only on Android.
  if (d.platform === 'android' && d.abis.length > 0 && !d.abis.includes('arm64-v8a')) return 'lite';
  if (d.totalMemoryBytes == null) return 'standard';
  if (d.totalMemoryBytes >= FLAGSHIP_MIN_BYTES) return 'flagship';
  if (d.totalMemoryBytes >= STANDARD_MIN_BYTES) return 'standard';
  return 'lite';
}

/** The compact engine for a language: English-only Base, or multilingual Base. */
export function baseEngineFor(language: string): EngineId {
  return language === 'en' ? 'whisper-base-en' : 'whisper-base';
}

/**
 * The next engine to try when one can't load. English ends on the
 * multilingual Base, which runs on a different runtime (whisper.cpp) and so
 * can still work when ExecuTorch can't; other languages have nothing below it.
 */
export function fallbackEngine(engine: EngineId, language: string): EngineId | null {
  switch (engine) {
    case 'whisper-large-v3-turbo':
      return 'whisper-small';
    case 'whisper-small':
      return baseEngineFor(language);
    case 'whisper-base-en':
      return 'whisper-base';
    case 'whisper-base':
      return null;
  }
}

/**
 * The engine for the post-recording pass. Everyone gets a transcript in
 * their language (Base); Pro adds the larger models the phone can run.
 * `language` is the language being transcribed (never 'auto').
 */
export function chooseEngine(a: {
  tier: DeviceTier;
  isPro: boolean;
  override: DeviceTier | null;
  failedEngines: string[];
  language?: string;
}): EngineId {
  const language = a.language ?? 'en';
  const tier = a.override ?? a.tier;
  let engine: EngineId =
    !a.isPro || tier === 'lite'
      ? baseEngineFor(language)
      : tier === 'flagship'
        ? 'whisper-large-v3-turbo'
        : 'whisper-small';
  while (a.failedEngines.includes(engine)) {
    const next = fallbackEngine(engine, language);
    if (!next) break;
    engine = next;
  }
  return engine;
}

/** Engines that read the file in windows, so recording length doesn't matter. */
export function handlesLongAudio(engine: EngineId): boolean {
  return engine === 'whisper-large-v3-turbo' || engine === 'whisper-base';
}

export function chooseLlm(tier: DeviceTier): LlmId {
  return tier === 'flagship' ? 'qwen3-1.7b' : 'qwen3-0.6b';
}

/** A download counts only when its full, known size arrived. */
export function isDownloadComplete(written: number, expected: number | null): boolean {
  return expected != null && expected > 0 && written === expected;
}
