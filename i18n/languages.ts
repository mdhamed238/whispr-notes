/**
 * Languages the app's interface is translated into. Pure.
 *
 * Each one is also a transcription language (constants/languages.ts), so the
 * language someone reads the app in is one they can dictate in.
 */
export const APP_LANGUAGES = [
  'en',
  'fr',
  'es',
  'de',
  'it',
  'ar',
  'pt',
  'nl',
  'tr',
  'ru',
  'hi',
  'ja',
  'ko',
  'zh',
  'pl',
  'id',
  'uk',
  'sv',
  'vi',
  'cs',
] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

/** Stored preference: follow the phone, or a fixed language. */
export type LanguagePreference = 'system' | AppLanguage;

export const DEFAULT_LANGUAGE: AppLanguage = 'en';

const RTL_APP_LANGUAGES: ReadonlySet<string> = new Set(['ar']);

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && (APP_LANGUAGES as readonly string[]).includes(value);
}

export function isRtlAppLanguage(language: string): boolean {
  return RTL_APP_LANGUAGES.has(language);
}

/**
 * Picks the interface language: the stored choice, else the first of the
 * phone's preferred languages that is translated, else English.
 */
export function resolveAppLanguage(preference: unknown, deviceLanguages: (string | null | undefined)[]): AppLanguage {
  if (isAppLanguage(preference)) return preference;
  for (const tag of deviceLanguages) {
    const code = tag?.split(/[-_]/)[0]?.toLowerCase();
    if (isAppLanguage(code)) return code;
  }
  return DEFAULT_LANGUAGE;
}

/** BCP 47 tag for date and number formatting. */
export function localeTag(language: AppLanguage, deviceTags: (string | null | undefined)[]): string {
  // Prefer the phone's own regional variant (fr-CA, es-MX) when it matches.
  const regional = deviceTags.find((tag) => tag?.split(/[-_]/)[0]?.toLowerCase() === language);
  return regional ? regional.replace('_', '-') : language;
}
