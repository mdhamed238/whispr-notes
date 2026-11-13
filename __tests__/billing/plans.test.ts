import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { lifetimePlanFromOffering } from '../../services/billing/plans';

function storePackage(kind: 'monthly' | 'yearly' | 'lifetime', priceString: string): PurchasesPackage {
  const recurring = kind !== 'lifetime';
  const context = { offeringIdentifier: 'default', placementIdentifier: null, targetingContext: null };
  return {
    identifier: kind === 'yearly' ? '$rc_annual' : `$rc_${kind}`,
    packageType: (kind === 'yearly' ? 'ANNUAL' : kind.toUpperCase()) as PurchasesPackage['packageType'],
    offeringIdentifier: 'default',
    presentedOfferingContext: context,
    webCheckoutUrl: null,
    product: {
      identifier: `whisprnotes_pro_${kind}`,
      title: `WhisprNotes Pro ${kind}`,
      description: 'Pro features',
      price: 4.99,
      priceString,
      currencyCode: 'EUR',
      pricePerWeek: null,
      pricePerMonth: null,
      pricePerYear: null,
      pricePerWeekString: null,
      pricePerMonthString: null,
      pricePerYearString: null,
      introPrice: null,
      discounts: null,
      productCategory: (recurring ? 'SUBSCRIPTION' : 'NON_SUBSCRIPTION') as PurchasesPackage['product']['productCategory'],
      productType: (recurring ? 'AUTO_RENEWABLE_SUBSCRIPTION' : 'NON_CONSUMABLE') as PurchasesPackage['product']['productType'],
      subscriptionPeriod: recurring ? (kind === 'monthly' ? 'P1M' : 'P1Y') : null,
      defaultOption: null,
      subscriptionOptions: null,
      presentedOfferingIdentifier: 'default',
      presentedOfferingContext: context,
      installmentsInfo: null,
    },
  };
}

const monthly = storePackage('monthly', '3,99 €');
const annual = storePackage('yearly', '19,99 €');
const lifetime = storePackage('lifetime', '5,99 €');

function offering(packages: PurchasesPackage[]): PurchasesOffering {
  return {
    identifier: 'default',
    serverDescription: 'Pro',
    metadata: {},
    availablePackages: packages,
    lifetime: packages.find((pkg) => pkg.packageType === 'LIFETIME') ?? null,
    annual: packages.find((pkg) => pkg.packageType === 'ANNUAL') ?? null,
    monthly: packages.find((pkg) => pkg.packageType === 'MONTHLY') ?? null,
    sixMonth: null,
    threeMonth: null,
    twoMonth: null,
    weekly: null,
    webCheckoutUrl: null,
  };
}

describe('lifetimePlanFromOffering', () => {
  test('selects lifetime from a mixed offering and preserves its localized store price', () => {
    const plan = lifetimePlanFromOffering(offering([monthly, annual, lifetime]));
    expect(plan.pkg).toBe(lifetime);
    expect(plan.price).toBe('5,99 €');
    expect(plan.period).toBe('one time');
  });

  test('has no purchasable package when only recurring products are offered', () => {
    const plan = lifetimePlanFromOffering(offering([annual, monthly]));
    expect(plan.pkg).toBeNull();
  });

  test('has no purchasable package when the offering is empty', () => {
    expect(lifetimePlanFromOffering(offering([])).pkg).toBeNull();
  });

  test('shows the USD reference price without a purchasable package while offline', () => {
    const plan = lifetimePlanFromOffering(null);
    expect(plan.price).toBe('$4.99');
    expect(plan.pkg).toBeNull();
  });
});
