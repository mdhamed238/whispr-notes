import { pluralCategory } from '../../i18n/plural';

describe('pluralCategory', () => {
  test('English-like languages: one for 1, other otherwise', () => {
    for (const lang of ['en', 'es', 'de', 'it', 'nl', 'tr', 'sv']) {
      expect(pluralCategory(lang, 1)).toBe('one');
      expect(pluralCategory(lang, 0)).toBe('other');
      expect(pluralCategory(lang, 2)).toBe('other');
    }
  });

  test('French, Portuguese and Hindi treat 0 as singular', () => {
    for (const lang of ['fr', 'pt', 'hi']) {
      expect(pluralCategory(lang, 0)).toBe('one');
      expect(pluralCategory(lang, 1)).toBe('one');
      expect(pluralCategory(lang, 2)).toBe('other');
    }
  });

  test('languages without plurals always use other', () => {
    for (const lang of ['ja', 'ko', 'zh', 'vi', 'id']) {
      expect(pluralCategory(lang, 1)).toBe('other');
      expect(pluralCategory(lang, 5)).toBe('other');
    }
  });

  test('Russian and Ukrainian: one / few / many', () => {
    for (const lang of ['ru', 'uk']) {
      expect(pluralCategory(lang, 1)).toBe('one');
      expect(pluralCategory(lang, 21)).toBe('one');
      expect(pluralCategory(lang, 3)).toBe('few');
      expect(pluralCategory(lang, 24)).toBe('few');
      expect(pluralCategory(lang, 5)).toBe('many');
      expect(pluralCategory(lang, 11)).toBe('many');
      expect(pluralCategory(lang, 12)).toBe('many');
      expect(pluralCategory(lang, 0)).toBe('many');
    }
  });

  test('Polish: 1 is one, 21 is many', () => {
    expect(pluralCategory('pl', 1)).toBe('one');
    expect(pluralCategory('pl', 2)).toBe('few');
    expect(pluralCategory('pl', 5)).toBe('many');
    expect(pluralCategory('pl', 21)).toBe('many');
    expect(pluralCategory('pl', 22)).toBe('few');
    expect(pluralCategory('pl', 112)).toBe('many');
  });

  test('Czech: 2-4 are few', () => {
    expect(pluralCategory('cs', 1)).toBe('one');
    expect(pluralCategory('cs', 3)).toBe('few');
    expect(pluralCategory('cs', 5)).toBe('other');
    expect(pluralCategory('cs', 0)).toBe('other');
  });

  test('Arabic uses all six forms', () => {
    expect(pluralCategory('ar', 0)).toBe('zero');
    expect(pluralCategory('ar', 1)).toBe('one');
    expect(pluralCategory('ar', 2)).toBe('two');
    expect(pluralCategory('ar', 3)).toBe('few');
    expect(pluralCategory('ar', 10)).toBe('few');
    expect(pluralCategory('ar', 11)).toBe('many');
    expect(pluralCategory('ar', 99)).toBe('many');
    expect(pluralCategory('ar', 100)).toBe('other');
    expect(pluralCategory('ar', 103)).toBe('few');
  });
});
