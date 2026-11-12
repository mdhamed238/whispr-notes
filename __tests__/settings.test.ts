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
