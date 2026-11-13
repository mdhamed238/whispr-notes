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
