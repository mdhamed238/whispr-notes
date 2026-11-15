import { APP_LANGUAGES } from '../../i18n/languages';
import en from '../../i18n/locales/en';
import { pluralCategory } from '../../i18n/plural';

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{(\w+)\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const englishKeys = Object.keys(en);
const pluralBases = englishKeys.filter((k) => k.endsWith('_other')).map((k) => k.slice(0, -'_other'.length));

describe('English source strings', () => {
  test('every plural has both an _one and an _other form', () => {
    for (const base of pluralBases) expect(englishKeys).toContain(`${base}_one`);
    for (const key of englishKeys.filter((k) => k.endsWith('_one'))) {
      expect(englishKeys).toContain(key.replace(/_one$/, '_other'));
    }
  });

  test('no string is empty', () => {
    for (const [key, value] of Object.entries(en)) expect(`${key}:${value.trim().length > 0}`).toBe(`${key}:true`);
  });
});

describe.each(APP_LANGUAGES.filter((l) => l !== 'en'))('%s translation', (language) => {
  const locale: Record<string, string> = require(`../../i18n/locales/${language}`).default;

  test('has every English key', () => {
    const missing = englishKeys.filter((key) => !(key in locale));
    expect(missing).toEqual([]);
  });

  test('adds nothing but extra plural forms of existing plurals', () => {
    const extra = Object.keys(locale).filter(
      (key) => !(key in en) && !(PLURAL_SUFFIX.test(key) && pluralBases.includes(key.replace(PLURAL_SUFFIX, '')))
    );
    expect(extra).toEqual([]);
  });

  test('keeps the same placeholders as English', () => {
    const wrong: string[] = [];
    for (const [key, value] of Object.entries(locale)) {
      const source = (en as Record<string, string>)[key] ?? (en as Record<string, string>)[key.replace(PLURAL_SUFFIX, '_other')];
      const want = placeholders(source);
      const got = placeholders(value);
      // A plural form may spell the number out ("one note") instead of repeating {{count}}.
      const mayOmitCount = PLURAL_SUFFIX.test(key) && want === 'count' && got === '';
      if (got !== want && !mayOmitCount) wrong.push(`${key}: "${got}" should be "${want}"`);
    }
    expect(wrong).toEqual([]);
  });

  test('has no empty or untrimmed string', () => {
    const bad = Object.entries(locale).filter(([, value]) => value.trim().length === 0 || value !== value.trim());
    expect(bad.map(([key]) => key)).toEqual([]);
  });

  test('provides every plural form its grammar can ask for', () => {
    const needed = new Set<string>();
    for (let n = 0; n <= 200; n++) needed.add(pluralCategory(language, n));
    const missing: string[] = [];
    for (const base of pluralBases) {
      for (const form of needed) if (!(`${base}_${form}` in locale)) missing.push(`${base}_${form}`);
    }
    expect(missing).toEqual([]);
  });

  test('is actually translated', () => {
    // Brand names, formats and symbols legitimately stay the same; whole screens must not.
    const same = englishKeys.filter((key) => locale[key] === (en as Record<string, string>)[key]);
    expect(same.length).toBeLessThan(englishKeys.length * 0.08);
  });
});

describe('runtime lookup', () => {
  const i18n = require('../../i18n');

  afterAll(() => i18n.applyLanguagePreference('en'));

  test('switching language changes strings and notifies nothing stale', () => {
    i18n.applyLanguagePreference('fr');
    expect(i18n.getAppLanguage()).toBe('fr');
    expect(i18n.t('common.cancel')).toBe('Annuler');
    i18n.applyLanguagePreference('en');
    expect(i18n.t('common.cancel')).toBe('Cancel');
  });

  test('interpolates values and leaves unknown placeholders visible', () => {
    i18n.applyLanguagePreference('en');
    expect(i18n.t('record.languageA11y', { language: 'Deutsch' })).toBe('Recording language: Deutsch. Tap to change.');
    expect(i18n.t('record.languageA11y')).toContain('{{language}}');
  });

  test('plurals follow the active language', () => {
    i18n.applyLanguagePreference('en');
    expect(i18n.tp('notes.count', 1)).toBe('1 note');
    expect(i18n.tp('notes.count', 4)).toBe('4 notes');
    i18n.applyLanguagePreference('ru');
    expect(i18n.tp('notes.count', 1)).toBe('1 заметка');
    expect(i18n.tp('notes.count', 3)).toBe('3 заметки');
    expect(i18n.tp('notes.count', 5)).toBe('5 заметок');
    expect(i18n.tp('notes.count', 21)).toBe('21 заметка');
    i18n.applyLanguagePreference('ar');
    expect(i18n.tp('notes.count', 2)).toBe('ملاحظتان');
    expect(i18n.tp('notes.count', 7)).toBe('7 ملاحظات');
    i18n.applyLanguagePreference('ja');
    expect(i18n.tp('notes.count', 1)).toBe('1件のノート');
  });

  test('"system" resolves from the phone language', () => {
    expect(i18n.applyLanguagePreference('system')).toBe('en');
  });
});
