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

describe('trialLabel', () => {
  const { trialLabel } = require('../../services/billing/plans');
  test('free intro offers become a readable trial label', () => {
    expect(trialLabel({ price: 0, periodNumberOfUnits: 3, periodUnit: 'DAY' })).toBe('3-day free trial');
    expect(trialLabel({ price: 0, periodNumberOfUnits: 7, periodUnit: 'DAY' })).toBe('7-day free trial');
    expect(trialLabel({ price: 0, periodNumberOfUnits: 1, periodUnit: 'WEEK' })).toBe('1-week free trial');
  });
  test('paid or missing intro offers are not trials', () => {
    expect(trialLabel({ price: 0.99, periodNumberOfUnits: 1, periodUnit: 'MONTH' })).toBeUndefined();
    expect(trialLabel(null)).toBeUndefined();
  });
});

describe('fallback trials', () => {
  test('monthly has a 3-day trial and yearly a 7-day trial', () => {
    const byId = Object.fromEntries(FALLBACK_PLANS.map((p) => [p.id, p.trial]));
    expect(byId).toEqual({ yearly: '7-day free trial', monthly: '3-day free trial', lifetime: undefined });
  });
});
