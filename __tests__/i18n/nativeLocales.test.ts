/**
 * Texts the operating system shows, such as the microphone permission
 * prompt, are translated through `locales` in app.json (i18n/native/*.json).
 *
 * Expo gives every top-level key in those files to both platforms. On
 * Android they become string resources, and a string that exists in a
 * translation but not in the default language is a fatal lint error
 * (ExtraTranslation): the release build fails. A key meant for one platform
 * has to sit under "ios" or "android".
 *
 * These tests ask Expo's own resolver what each platform would be given.
 */
import path from 'path';

import { getResolvedLocalesAsync } from '@expo/config-plugins/build/utils/locales';

import { APP_LANGUAGES } from '../../i18n/languages';

const projectRoot = path.join(__dirname, '../..');
const locales: Record<string, string> = require('../../app.json').expo.locales;

/** Strings Expo's Android template defines in the default language, so a translation of them is allowed. */
const ANDROID_DEFAULT_STRINGS = ['app_name'];

async function stringsFor(platform: 'ios' | 'android'): Promise<Record<string, Record<string, unknown>>> {
  const { localesMap } = await getResolvedLocalesAsync(projectRoot, locales, platform);
  return localesMap as Record<string, Record<string, unknown>>;
}

test('every interface language other than English has native texts', () => {
  const translated = APP_LANGUAGES.filter((code) => code !== 'en');
  // The native side names Simplified Chinese by script.
  const native = Object.keys(locales).map((code) => (code === 'zh-Hans' ? 'zh' : code));
  expect(native.sort()).toEqual([...translated].sort());
});

test('iOS gets the microphone prompt in every one of them', async () => {
  const ios = await stringsFor('ios');
  expect(Object.keys(ios).sort()).toEqual(Object.keys(locales).sort());
  for (const [language, strings] of Object.entries(ios)) {
    expect({ language, prompt: typeof strings.NSMicrophoneUsageDescription }).toEqual({ language, prompt: 'string' });
    expect(String(strings.NSMicrophoneUsageDescription)).toContain('WhisprNotes');
  }
});

test('Android is given no string that its default language lacks', async () => {
  const android = await stringsFor('android');
  expect(Object.keys(android).sort()).toEqual(Object.keys(locales).sort());
  for (const [language, strings] of Object.entries(android)) {
    const extra = Object.keys(strings).filter((key) => !ANDROID_DEFAULT_STRINGS.includes(key));
    expect({ language, extra }).toEqual({ language, extra: [] });
  }
});
