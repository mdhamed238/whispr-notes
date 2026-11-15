/**
 * Interface translations.
 *
 * `t('notes.title')` for plain strings, `tp('notes.count', n)` for strings
 * that vary with a count. Components read both from `useI18n()`, which
 * re-renders them when the language changes; services call `t` directly.
 *
 * Only English and the active language are ever evaluated: each locale file
 * is required on first use, so the other eighteen cost nothing at launch.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { I18nManager } from 'react-native';

import {
  type AppLanguage,
  type LanguagePreference,
  isRtlAppLanguage,
  localeTag,
  resolveAppLanguage,
} from './languages';
import en from './locales/en';
import { pluralCategory } from './plural';
import type { PluralBase, TKey, TParams, Translations } from './types';

export type { AppLanguage, LanguagePreference } from './languages';
export type { TKey, PluralBase } from './types';

const LOADERS: Record<AppLanguage, () => Translations> = {
  en: () => en,
  fr: () => require('./locales/fr').default,
  es: () => require('./locales/es').default,
  de: () => require('./locales/de').default,
  it: () => require('./locales/it').default,
  ar: () => require('./locales/ar').default,
  pt: () => require('./locales/pt').default,
  nl: () => require('./locales/nl').default,
  tr: () => require('./locales/tr').default,
  ru: () => require('./locales/ru').default,
  hi: () => require('./locales/hi').default,
  ja: () => require('./locales/ja').default,
  ko: () => require('./locales/ko').default,
  zh: () => require('./locales/zh').default,
  pl: () => require('./locales/pl').default,
  id: () => require('./locales/id').default,
  uk: () => require('./locales/uk').default,
  sv: () => require('./locales/sv').default,
  vi: () => require('./locales/vi').default,
  cs: () => require('./locales/cs').default,
};

/**
 * The phone's preferred languages, most preferred first. Required lazily and
 * guarded: a development build made before expo-localization was added has
 * no such native module, and the app should still start (in the language
 * the JS engine reports) rather than fail at import.
 */
function deviceTags(): string[] {
  try {
    const { getLocales } = require('expo-localization') as typeof import('expo-localization');
    const tags = (getLocales() ?? []).map((locale) => locale.languageTag).filter(Boolean);
    if (tags.length > 0) return tags;
  } catch {
    // Fall through to the engine's own locale.
  }
  try {
    return [Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    return [];
  }
}

function load(language: AppLanguage): Translations {
  try {
    return LOADERS[language]();
  } catch (error) {
    console.warn(`Could not load the ${language} translation; using English.`, error);
    return en;
  }
}

let language: AppLanguage = resolveAppLanguage('system', deviceTags());
let dictionary: Translations = load(language);
let tag = localeTag(language, deviceTags());
const listeners = new Set<() => void>();

export function getAppLanguage(): AppLanguage {
  return language;
}

/** BCP 47 tag of the interface language, for dates and numbers. */
export function getLocaleTag(): string {
  return tag;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Applies the stored language choice. Safe to call repeatedly. */
export function applyLanguagePreference(preference: LanguagePreference): AppLanguage {
  const tags = deviceTags();
  const next = resolveAppLanguage(preference, tags);
  if (next !== language) {
    language = next;
    dictionary = load(next);
    tag = localeTag(next, tags);
    listeners.forEach((listener) => listener());
  }
  return language;
}

/**
 * Lines the layout direction up with the interface language. React Native
 * only reads the direction at launch, so a change returns true: the new
 * direction applies the next time the app starts.
 */
export function syncLayoutDirection(): boolean {
  const wantRtl = isRtlAppLanguage(language);
  if (I18nManager.isRTL === wantRtl) return false;
  try {
    I18nManager.allowRTL(wantRtl);
    I18nManager.forceRTL(wantRtl);
  } catch (error) {
    console.warn('Could not change layout direction:', error);
    return false;
  }
  return true;
}

/** True when the layout is actually mirrored right now. */
export function isLayoutRtl(): boolean {
  return I18nManager.isRTL;
}

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

export function t(key: TKey, params?: TParams): string {
  return interpolate(dictionary[key] ?? en[key] ?? key, params);
}

/** A string that varies with `count`; `{{count}}` is filled in automatically. */
export function tp(base: PluralBase, count: number, params?: TParams): string {
  const table = dictionary as Record<string, string | undefined>;
  const fallback = en as Record<string, string | undefined>;
  const template =
    table[`${base}_${pluralCategory(language, count)}`] ??
    table[`${base}_other`] ??
    fallback[`${base}_${pluralCategory('en', count)}`] ??
    fallback[`${base}_other`] ??
    base;
  return interpolate(template, { count, ...params });
}

export function formatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  try {
    return date.toLocaleDateString(tag, options);
  } catch {
    return date.toLocaleDateString('en-US', options);
  }
}

export function formatDateTime(date: Date, options: Intl.DateTimeFormatOptions): string {
  try {
    return date.toLocaleString(tag, options);
  } catch {
    return date.toLocaleString('en-US', options);
  }
}

export function formatNumber(value: number): string {
  try {
    return value.toLocaleString(tag);
  } catch {
    return String(value);
  }
}

/** `t`, `tp` and the active language; the component re-renders when it changes. */
export function useI18n(): { t: typeof t; tp: typeof tp; language: AppLanguage; rtl: boolean } {
  const active = useSyncExternalStore(subscribe, getAppLanguage, getAppLanguage);
  return useMemo(
    () => ({
      // Fresh identities per language, so memoized values keyed on them refresh.
      t: ((key, params) => t(key, params)) as typeof t,
      tp: ((base, count, params) => tp(base, count, params)) as typeof tp,
      language: active,
      rtl: I18nManager.isRTL,
    }),
    [active]
  );
}
