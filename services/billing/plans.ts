/** Lifetime purchase presentation for the paywall. Pure. */
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

export const PRODUCT_IDS = { lifetime: 'whisprnotes_pro_lifetime' } as const;
export const ENTITLEMENT_ID = 'pro';

export interface LifetimePlan {
  title: string;
  price: string;
  period: string;
  pkg: PurchasesPackage | null;
}

/** Missing/offline offerings stay unavailable; never fall back to a subscription. */
export function lifetimePlanFromOffering(offering: PurchasesOffering | null): LifetimePlan {
  const pkg = offering?.lifetime ?? null;
  return {
    title: 'Lifetime Pro',
    price: pkg?.product.priceString ?? '$4.99',
    period: 'one time',
    pkg,
  };
}
