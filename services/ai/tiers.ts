/**
 * Device capability tiers and model selection. Pure: device facts and
 * entitlement come in as arguments, so every branch is unit-tested.
 */

export type DeviceTier = 'flagship' | 'standard' | 'lite';
export const DEVICE_TIERS: DeviceTier[] = ['flagship', 'standard', 'lite'];

export type EngineId = 'whisper-large-v3-turbo' | 'whisper-small' | 'whisper-base-en';
export type LlmId = 'qwen3-1.7b' | 'qwen3-0.6b';

const GiB = 2 ** 30;
// Phones report less RAM than marketed (kernel and carve-outs): an "8 GB"
// Galaxy S23 shows ~7.3 GiB and a "6 GB" phone ~5.5 GiB. Thresholds sit
// below those so each marketed class lands in its intended tier.
const FLAGSHIP_MIN_BYTES = 7.0 * GiB;
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

const FALLBACK: Record<EngineId, EngineId | null> = {
  'whisper-large-v3-turbo': 'whisper-small',
  'whisper-small': 'whisper-base-en',
  'whisper-base-en': null,
};

/** The engine for the post-recording pass. Free users always get Base. */
export function chooseEngine(a: {
  tier: DeviceTier;
  isPro: boolean;
  override: DeviceTier | null;
  failedEngines: string[];
}): EngineId {
  if (!a.isPro) return 'whisper-base-en';
  const tier = a.override ?? a.tier;
  let engine: EngineId =
    tier === 'flagship' ? 'whisper-large-v3-turbo' : tier === 'standard' ? 'whisper-small' : 'whisper-base-en';
  while (a.failedEngines.includes(engine) && FALLBACK[engine]) {
    engine = FALLBACK[engine]!;
  }
  return engine;
}

export function chooseLlm(tier: DeviceTier): LlmId {
  return tier === 'flagship' ? 'qwen3-1.7b' : 'qwen3-0.6b';
}

/** A download counts only when its full, known size arrived. */
export function isDownloadComplete(written: number, expected: number | null): boolean {
  return expected != null && expected > 0 && written === expected;
}
