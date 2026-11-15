/**
 * Plural categories (CLDR rules for whole numbers) for the interface
 * languages. Written out rather than read from Intl.PluralRules, which
 * Hermes does not ship on every platform. Pure.
 */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export function pluralCategory(language: string, count: number): PluralCategory {
  const n = Math.abs(Math.trunc(count));
  const mod10 = n % 10;
  const mod100 = n % 100;

  switch (language) {
    // No grammatical plural.
    case 'ja':
    case 'ko':
    case 'zh':
    case 'vi':
    case 'id':
      return 'other';

    // 0 and 1 are singular.
    case 'fr':
    case 'pt':
    case 'hi':
      return n <= 1 ? 'one' : 'other';

    case 'ru':
    case 'uk':
      if (mod10 === 1 && mod100 !== 11) return 'one';
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
      return 'many';

    case 'pl':
      if (n === 1) return 'one';
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
      return 'many';

    case 'cs':
      if (n === 1) return 'one';
      if (n >= 2 && n <= 4) return 'few';
      return 'other';

    case 'ar':
      if (n === 0) return 'zero';
      if (n === 1) return 'one';
      if (n === 2) return 'two';
      if (mod100 >= 3 && mod100 <= 10) return 'few';
      if (mod100 >= 11) return 'many';
      return 'other';

    // en, es, de, it, nl, tr, sv and anything unknown.
    default:
      return n === 1 ? 'one' : 'other';
  }
}
