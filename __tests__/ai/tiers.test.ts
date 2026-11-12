import { chooseEngine, chooseLlm, isDownloadComplete, resolveTier } from '../../services/ai/tiers';

const GiB = 2 ** 30;

describe('resolveTier', () => {
  test('an 8 GB Android flagship reporting ~7.3 GiB is flagship', () => {
    expect(resolveTier({ totalMemoryBytes: 7.3 * GiB, abis: ['arm64-v8a'], platform: 'android' })).toBe('flagship');
  });
  test('12 GB class is flagship', () => {
    expect(resolveTier({ totalMemoryBytes: 11.2 * GiB, abis: ['arm64-v8a'], platform: 'android' })).toBe('flagship');
  });
  test('6 GB class is standard', () => {
    expect(resolveTier({ totalMemoryBytes: 5.5 * GiB, abis: ['arm64-v8a'], platform: 'android' })).toBe('standard');
  });
  test('4 GB class is lite', () => {
    expect(resolveTier({ totalMemoryBytes: 3.6 * GiB, abis: ['arm64-v8a'], platform: 'android' })).toBe('lite');
  });
  test('unknown memory is standard', () => {
    expect(resolveTier({ totalMemoryBytes: null, abis: [], platform: 'ios' })).toBe('standard');
  });
  test('32-bit Android is lite regardless of memory', () => {
    expect(resolveTier({ totalMemoryBytes: 12 * GiB, abis: ['armeabi-v7a'], platform: 'android' })).toBe('lite');
  });
  test('iOS ignores the ABI list', () => {
    expect(resolveTier({ totalMemoryBytes: 7.5 * GiB, abis: [], platform: 'ios' })).toBe('flagship');
  });
});

describe('chooseEngine', () => {
  const base = { tier: 'flagship' as const, isPro: true, override: null, failedEngines: [] as string[] };
  test('free users always get Base', () => {
    expect(chooseEngine({ ...base, isPro: false })).toBe('whisper-base-en');
  });
  test('Pro flagship gets Large-v3-Turbo', () => {
    expect(chooseEngine(base)).toBe('whisper-large-v3-turbo');
  });
  test('Pro standard gets Small', () => {
    expect(chooseEngine({ ...base, tier: 'standard' })).toBe('whisper-small');
  });
  test('a failed engine falls back one step', () => {
    expect(chooseEngine({ ...base, failedEngines: ['whisper-large-v3-turbo'] })).toBe('whisper-small');
    expect(chooseEngine({ ...base, failedEngines: ['whisper-large-v3-turbo', 'whisper-small'] })).toBe('whisper-base-en');
  });
  test('the user override wins over detection', () => {
    expect(chooseEngine({ ...base, override: 'lite' })).toBe('whisper-base-en');
  });
});

describe('chooseLlm', () => {
  test('flagship gets the 1.7B model, others 0.6B', () => {
    expect(chooseLlm('flagship')).toBe('qwen3-1.7b');
    expect(chooseLlm('standard')).toBe('qwen3-0.6b');
    expect(chooseLlm('lite')).toBe('qwen3-0.6b');
  });
});

describe('isDownloadComplete', () => {
  test('complete only when the expected size is known and matched', () => {
    expect(isDownloadComplete(10, 10)).toBe(true);
    expect(isDownloadComplete(9, 10)).toBe(false);
    expect(isDownloadComplete(10, null)).toBe(false);
    expect(isDownloadComplete(0, 0)).toBe(false);
  });
});
