import { FREE_SUMMARIES_PER_WEEK, summaryAllowance } from '../../services/billing/quota';

const now = new Date('2026-03-10T12:00:00.000Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe('summaryAllowance', () => {
  test('free users get three per rolling week', () => {
    expect(FREE_SUMMARIES_PER_WEEK).toBe(3);
    const a = summaryAllowance([daysAgo(1), daysAgo(2), daysAgo(3)], now, false);
    expect(a.allowed).toBe(false);
    expect(a.remaining).toBe(0);
    expect(a.resetsAt?.toISOString()).toBe(new Date(new Date(daysAgo(3)).getTime() + 7 * 86_400_000).toISOString());
  });

  test('entries older than seven days do not count', () => {
    const a = summaryAllowance([daysAgo(8), daysAgo(9), daysAgo(1)], now, false);
    expect(a.allowed).toBe(true);
    expect(a.remaining).toBe(2);
  });

  test('Pro is unlimited', () => {
    expect(summaryAllowance([daysAgo(1), daysAgo(1), daysAgo(1), daysAgo(1)], now, true)).toEqual({
      allowed: true,
      remaining: 'unlimited',
      resetsAt: null,
    });
  });

  test('malformed log entries are ignored', () => {
    expect(summaryAllowance(['garbage'], now, false).remaining).toBe(3);
  });
});
