import { LANGUAGES, isRtlLanguage, isUnspacedLanguage, languageInfo, languageLabel } from '../../constants/languages';
import { APP_LANGUAGES, isRtlAppLanguage, localeTag, resolveAppLanguage } from '../../i18n/languages';

describe('resolveAppLanguage', () => {
  test('a stored choice wins over the phone language', () => {
    expect(resolveAppLanguage('de', ['fr-FR'])).toBe('de');
  });
  test('"system" takes the first phone language that is translated', () => {
    expect(resolveAppLanguage('system', ['sw-KE', 'pt-BR', 'en-US'])).toBe('pt');
    expect(resolveAppLanguage('system', ['zh-Hans-CN'])).toBe('zh');
    expect(resolveAppLanguage('system', ['ar_MA'])).toBe('ar');
  });
  test('no supported phone language falls back to English', () => {
    expect(resolveAppLanguage('system', ['sw-KE', null, undefined])).toBe('en');
    expect(resolveAppLanguage('system', [])).toBe('en');
  });
  test('garbage in storage behaves like "system"', () => {
    expect(resolveAppLanguage('klingon', ['it-IT'])).toBe('it');
    expect(resolveAppLanguage(undefined, ['it-IT'])).toBe('it');
  });
});

describe('localeTag', () => {
  test('keeps the phone region when the language matches', () => {
    expect(localeTag('fr', ['en-US', 'fr-CA'])).toBe('fr-CA');
    expect(localeTag('es', ['es_MX'])).toBe('es-MX');
  });
  test('falls back to the bare language', () => {
    expect(localeTag('de', ['en-US'])).toBe('de');
  });
});

describe('language catalogs', () => {
  test('there are twenty interface languages and Arabic is the right-to-left one', () => {
    expect(APP_LANGUAGES).toHaveLength(20);
    expect(new Set(APP_LANGUAGES).size).toBe(20);
    expect(APP_LANGUAGES.filter(isRtlAppLanguage)).toEqual(['ar']);
  });
  test('every interface language can also be transcribed', () => {
    for (const code of APP_LANGUAGES) expect(languageInfo(code)).not.toBeNull();
  });
  test('transcription language codes are unique two-letter codes', () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z]{2}$/);
  });
  test('lookups accept locale tags and report direction and spacing', () => {
    expect(languageInfo('pt-BR')?.code).toBe('pt');
    expect(languageLabel('fr')).toBe('Français');
    expect(languageLabel('xx')).toBe('XX');
    expect(isRtlLanguage('ar')).toBe(true);
    expect(isRtlLanguage('he')).toBe(true);
    expect(isRtlLanguage('en')).toBe(false);
    expect(isUnspacedLanguage('zh')).toBe(true);
    expect(isUnspacedLanguage('ja')).toBe(true);
    expect(isUnspacedLanguage('ko')).toBe(false);
    expect(isUnspacedLanguage(null)).toBe(false);
  });
});
