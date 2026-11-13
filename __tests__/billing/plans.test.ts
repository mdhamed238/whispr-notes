import { FALLBACK_PLANS, yearlySavingsPercent } from '../../services/billing/plans';

describe('yearlySavingsPercent', () => {
  test('compares a year of monthly with the yearly price', () => {
    expect(yearlySavingsPercent(3.99, 19.99)).toBe(58);
  });
  test('no saving shows nothing', () => {
    expect(yearlySavingsPercent(5, 60)).toBeNull();
    expect(yearlySavingsPercent(5, 70)).toBeNull();
  });
  test('missing prices show nothing', () => {
    expect(yearlySavingsPercent(null, 49.99)).toBeNull();
    expect(yearlySavingsPercent(0, 49.99)).toBeNull();
  });
});

describe('FALLBACK_PLANS', () => {
  test('lists yearly first and matches the agreed prices', () => {
    expect(FALLBACK_PLANS.map((p) => p.id)).toEqual(['yearly', 'monthly', 'lifetime']);
    expect(FALLBACK_PLANS.map((p) => p.price)).toEqual(['$19.99', '$3.99', '$49.99']);
  });
});
