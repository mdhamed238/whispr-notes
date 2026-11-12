/** Free-plan summary allowance: a rolling seven-day window. Pure. */

export const FREE_SUMMARIES_PER_WEEK = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function summaryAllowance(
  log: string[],
  now: Date,
  isPro: boolean
): { allowed: boolean; remaining: number | 'unlimited'; resetsAt: Date | null } {
  if (isPro) return { allowed: true, remaining: 'unlimited', resetsAt: null };
  const recent = log
    .map((iso) => new Date(iso).getTime())
    .filter((t) => Number.isFinite(t) && now.getTime() - t < WEEK_MS && t <= now.getTime())
    .sort((a, b) => a - b);
  const remaining = Math.max(0, FREE_SUMMARIES_PER_WEEK - recent.length);
  return {
    allowed: remaining > 0,
    remaining,
    resetsAt: remaining === 0 && recent.length > 0 ? new Date(recent[recent.length - FREE_SUMMARIES_PER_WEEK] + WEEK_MS) : null,
  };
}
