import { resolveExecutorchLanguage } from '../../services/ai/language';

describe('resolveExecutorchLanguage', () => {
  test('an explicit supported language is used as is', () => {
    expect(resolveExecutorchLanguage('fr', 'en-US')).toBe('fr');
  });
  test('auto falls back to the phone language', () => {
    expect(resolveExecutorchLanguage('auto', 'ar_MA')).toBe('ar');
  });
  test('an unsupported phone language falls back to English', () => {
    expect(resolveExecutorchLanguage('auto', 'sw-KE')).toBe('en');
  });
});

describe('effectiveLanguage / livePreviewEngine / engineLanguage', () => {
  const { effectiveLanguage, engineLanguage, livePreviewEngine } = require('../../services/ai/language');

  test('"auto" follows the app language, an explicit choice wins', () => {
    expect(effectiveLanguage('auto', 'fr')).toBe('fr');
    expect(effectiveLanguage('de', 'fr')).toBe('de');
    expect(effectiveLanguage('auto', 'xx')).toBe('en');
    expect(effectiveLanguage('klingon', 'es')).toBe('es');
  });

  test('every language has a live preview: English streams, the rest use the multilingual model', () => {
    expect(livePreviewEngine('auto', 'en')).toBe('whisper-base-en');
    expect(livePreviewEngine('en', 'fr')).toBe('whisper-base-en');
    expect(livePreviewEngine('auto', 'ar')).toBe('whisper-base');
    expect(livePreviewEngine('ja', 'en')).toBe('whisper-base');
  });

  test('only Large-v3 Turbo is left to detect the language itself', () => {
    expect(engineLanguage('whisper-large-v3-turbo', 'auto', 'fr')).toBe('auto');
    expect(engineLanguage('whisper-large-v3-turbo', 'es', 'fr')).toBe('es');
    expect(engineLanguage('whisper-base', 'auto', 'fr')).toBe('fr');
    expect(engineLanguage('whisper-small', 'auto', 'ar')).toBe('ar');
    expect(engineLanguage('whisper-base-en', 'fr', 'fr')).toBe('en');
  });
});

describe('resolveSummaryLanguage', () => {
  const { resolveSummaryLanguage } = require('../../services/ai/language');

  test('free users always get the recording\'s own language', () => {
    expect(resolveSummaryLanguage('es', 'fr', 'en', false)).toBe('fr');
    expect(resolveSummaryLanguage('app', null, 'en', false)).toBeNull();
  });
  test('Pro can pick the transcript, the app language or a fixed one', () => {
    expect(resolveSummaryLanguage('transcript', 'fr', 'en', true)).toBe('fr');
    expect(resolveSummaryLanguage('app', 'fr', 'de', true)).toBe('de');
    expect(resolveSummaryLanguage('ar', 'fr', 'de', true)).toBe('ar');
  });
  test('an unknown choice falls back to the recording\'s language', () => {
    expect(resolveSummaryLanguage('klingon', 'it', 'en', true)).toBe('it');
  });
});
