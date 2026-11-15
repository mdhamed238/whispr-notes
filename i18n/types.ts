import type en from './locales/en';

/** Every translatable string. English is the source of truth. */
export type TKey = keyof typeof en;

/** Keys that vary with a count, without their `_one` / `_other` suffix. */
export type PluralBase = { [K in TKey]: K extends `${infer Base}_other` ? Base : never }[TKey];

/**
 * A complete translation. Languages with more plural forms than English add
 * `_zero`, `_two`, `_few` or `_many` variants beside `_one` and `_other`.
 */
export type Translations = Record<TKey, string> &
  Partial<Record<`${PluralBase}_${'zero' | 'two' | 'few' | 'many'}`, string>>;

export type TParams = Record<string, string | number>;
