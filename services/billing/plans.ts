/** Plan presentation helpers for the paywall. Pure. */

export type PlanId = 'yearly' | 'monthly' | 'lifetime';

export const PRODUCT_IDS: Record<PlanId, string> = {
  yearly: 'whisprnotes_pro_yearly',
  monthly: 'whisprnotes_pro_monthly',
  lifetime: 'whisprnotes_pro_lifetime',
};

export const ENTITLEMENT_ID = 'pro';

export interface PlanDisplay {
  id: PlanId;
  title: string;
  price: string;
  period: string;
  trial?: string;
}

/** Shown when the store can't be reached; real prices come from the store. */
export const FALLBACK_PLANS: PlanDisplay[] = [
  { id: 'yearly', title: 'Yearly', price: '$19.99', period: 'per year', trial: '7-day free trial' },
  { id: 'monthly', title: 'Monthly', price: '$3.99', period: 'per month', trial: '3-day free trial' },
  { id: 'lifetime', title: 'Lifetime', price: '$49.99', period: 'one time' },
];

/** Whole-percent saving of yearly over twelve months, or null when there is none. */
export function yearlySavingsPercent(monthly: number | null, yearly: number | null): number | null {
  if (!monthly || !yearly || monthly <= 0 || yearly <= 0) return null;
  const pct = Math.round((1 - yearly / (monthly * 12)) * 100);
  return pct > 0 ? pct : null;
}

/** "7-day free trial" for a free introductory offer; undefined otherwise. */
export function trialLabel(
  intro: { price: number; periodNumberOfUnits: number; periodUnit: string } | null | undefined
): string | undefined {
  if (!intro || intro.price !== 0 || intro.periodNumberOfUnits <= 0) return undefined;
  return `${intro.periodNumberOfUnits}-${intro.periodUnit.toLowerCase()} free trial`;
}
