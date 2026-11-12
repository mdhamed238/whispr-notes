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
}

/** Shown when the store can't be reached; real prices come from the store. */
export const FALLBACK_PLANS: PlanDisplay[] = [
  { id: 'yearly', title: 'Yearly', price: '$49.99', period: 'per year' },
  { id: 'monthly', title: 'Monthly', price: '$7.99', period: 'per month' },
  { id: 'lifetime', title: 'Lifetime', price: '$99.99', period: 'one time' },
];

/** Whole-percent saving of yearly over twelve months, or null when there is none. */
export function yearlySavingsPercent(monthly: number | null, yearly: number | null): number | null {
  if (!monthly || !yearly || monthly <= 0 || yearly <= 0) return null;
  const pct = Math.round((1 - yearly / (monthly * 12)) * 100);
  return pct > 0 ? pct : null;
}
