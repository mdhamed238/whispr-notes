import { DEFAULT_SETTINGS, mergeSettings } from '../services/settingsModel';

describe('mergeSettings', () => {
  test('missing storage gives defaults', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  test('keeps known valid values and drops unknown keys', () => {
    const merged = mergeSettings({ hapticsEnabled: false, junk: 1 });
    expect(merged.hapticsEnabled).toBe(false);
    expect('junk' in merged).toBe(false);
  });

  test('wrong-typed values fall back to defaults', () => {
    expect(mergeSettings({ summaryLog: 'x' }).summaryLog).toEqual([]);
    expect(mergeSettings({ tierOverride: 'mega' }).tierOverride).toBeNull();
    expect(mergeSettings({ tierOverride: 'lite' }).tierOverride).toBe('lite');
  });
});

describe('settingsAfterDataReset', () => {
  const { settingsAfterDataReset } = require('../services/settingsModel');
  test('keeps entitlement, quota log and onboarding, resets the rest', () => {
    const current = {
      ...DEFAULT_SETTINGS,
      hapticsEnabled: false,
      onboardingCompleted: true,
      summaryLog: ['2026-01-01T00:00:00.000Z'],
      proCache: { isPro: true, checkedAt: '2026-01-01T00:00:00.000Z' },
      devProOverride: true,
    };
    const next = settingsAfterDataReset(current);
    expect(next.hapticsEnabled).toBe(true);
    expect(next.onboardingCompleted).toBe(true);
    expect(next.summaryLog).toEqual(current.summaryLog);
    expect(next.proCache).toEqual(current.proCache);
    expect(next.devProOverride).toBe(true);
  });
});

describe('language and summary preferences', () => {
  const { settingsAfterDataReset } = require('../services/settingsModel');

  test('defaults: follow the phone, meeting summaries in the transcript language', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      appLanguage: 'system',
      summaryStyle: 'meeting',
      summaryLanguage: 'transcript',
      summaryInstructions: '',
    });
  });

  test('invalid stored values fall back, valid ones are kept', () => {
    expect(mergeSettings({ appLanguage: 'klingon' }).appLanguage).toBe('system');
    expect(mergeSettings({ appLanguage: 'ar' }).appLanguage).toBe('ar');
    expect(mergeSettings({ summaryStyle: 'haiku' }).summaryStyle).toBe('meeting');
    expect(mergeSettings({ summaryStyle: 'lecture' }).summaryStyle).toBe('lecture');
    expect(mergeSettings({ summaryInstructions: 'x'.repeat(1000) }).summaryInstructions).toHaveLength(280);
  });

  test('there is no statistics setting, and one stored by an earlier build is dropped', () => {
    expect(DEFAULT_SETTINGS).not.toHaveProperty('analyticsEnabled');
    expect(mergeSettings({ analyticsEnabled: true })).not.toHaveProperty('analyticsEnabled');
  });

  test('"Delete all data" keeps the app language', () => {
    const next = settingsAfterDataReset({ ...DEFAULT_SETTINGS, appLanguage: 'fr', summaryStyle: 'brief' });
    expect(next.appLanguage).toBe('fr');
    expect(next.summaryStyle).toBe('meeting');
  });
});
