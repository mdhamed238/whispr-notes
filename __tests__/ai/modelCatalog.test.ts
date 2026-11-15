/**
 * The sizes people are told before a download. ExecuTorch serves a different
 * Whisper file per platform, and the Android one is two to three times the
 * iOS one: quoting the iOS figure on Android promised 150 MB for 399 MB.
 */
type Catalog = typeof import('../../services/ai/modelCatalog');

function catalogOn(os: 'ios' | 'android'): Catalog {
  jest.resetModules();
  jest.doMock('react-native', () => ({ Platform: { OS: os } }));
  return require('../../services/ai/modelCatalog');
}

afterEach(() => {
  jest.dontMock('react-native');
});

test('Android is quoted the Android files, which are far larger', () => {
  const { MODEL_CATALOG, formatBytes } = catalogOn('android');
  expect(formatBytes(MODEL_CATALOG['whisper-base-en'].approxBytes)).toBe('399 MB');
  expect(formatBytes(MODEL_CATALOG['whisper-small'].approxBytes)).toBe('1.1 GB');
});

test('iOS is quoted the Core ML files', () => {
  const { MODEL_CATALOG, formatBytes } = catalogOn('ios');
  expect(formatBytes(MODEL_CATALOG['whisper-base-en'].approxBytes)).toBe('146 MB');
  expect(formatBytes(MODEL_CATALOG['whisper-small'].approxBytes)).toBe('485 MB');
});

test('the models that are one file everywhere are quoted the same everywhere', () => {
  const android = catalogOn('android').MODEL_CATALOG;
  const ios = catalogOn('ios').MODEL_CATALOG;
  for (const id of ['whisper-base', 'whisper-large-v3-turbo', 'qwen3-0.6b', 'qwen3-1.7b'] as const) {
    expect(android[id].approxBytes).toBe(ios[id].approxBytes);
  }
});
