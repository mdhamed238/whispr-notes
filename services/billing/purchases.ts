/**
 * Purchases through RevenueCat (App Store / Google Play). Anonymous: no
 * account, no user id from us. The network is used only to buy, restore
 * and refresh the entitlement; the last known entitlement is cached in
 * settings so Pro keeps working offline.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, {
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
  PURCHASES_ERROR_CODE,
} from 'react-native-purchases';

import { peekSettings, updateSettings } from '../settings';
import { ENTITLEMENT_ID } from './plans';

let configured = false;

/** The store's offering rarely changes; keeping it means the paywall opens with its price already there. */
const OFFERING_TTL_MS = 10 * 60 * 1000;
let offeringCache: { offering: PurchasesOffering | null; at: number } | null = null;
let offeringRequest: Promise<PurchasesOffering | null> | null = null;

function apiKey(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { revenueCat?: { iosKey?: string; androidKey?: string } };
  return (Platform.OS === 'ios' ? extra.revenueCat?.iosKey : extra.revenueCat?.androidKey) ?? '';
}

export function isStoreConfigured(): boolean {
  return configured;
}

async function cache(info: CustomerInfo): Promise<boolean> {
  const isPro = Boolean(info.entitlements.active[ENTITLEMENT_ID]);
  await updateSettings({ proCache: { isPro, checkedAt: new Date().toISOString() } });
  return isPro;
}

/** Call once at launch. Safe offline: failures leave the cached entitlement as is. */
export async function initPurchases(): Promise<void> {
  const key = apiKey();
  if (!key) {
    if (__DEV__) console.warn('RevenueCat key missing (app.json extra.revenueCat); purchases disabled.');
    return;
  }
  try {
    Purchases.configure({ apiKey: key });
    configured = true;
    Purchases.addCustomerInfoUpdateListener((info) => void cache(info));
    await cache(await Purchases.getCustomerInfo());
    // Warm the paywall for people who haven't bought.
    if (!peekSettings().proCache?.isPro) void getCurrentOffering();
  } catch (error) {
    console.warn('Could not refresh purchases (offline?):', error);
  }
}

/** The offering last fetched, if it is still fresh. Lets the paywall render its price at once. */
export function peekCurrentOffering(): PurchasesOffering | null {
  return offeringCache && Date.now() - offeringCache.at < OFFERING_TTL_MS ? offeringCache.offering : null;
}

export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  const fresh = peekCurrentOffering();
  if (fresh) return fresh;
  // One request at a time, shared by everyone asking.
  offeringRequest ??= Purchases.getOfferings()
    .then((offerings) => {
      // A missing offering (offline, store hiccup) is not cached: retry next time.
      if (offerings.current) offeringCache = { offering: offerings.current, at: Date.now() };
      return offerings.current;
    })
    .catch((error) => {
      console.warn('Could not load offerings:', error);
      return null;
    })
    .finally(() => {
      offeringRequest = null;
    });
  return offeringRequest;
}

/** Returns true when Pro is active afterwards; false if the user cancelled. Throws on store errors. */
export async function purchase(pkg: PurchasesPackage): Promise<boolean> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return cache(customerInfo);
  } catch (error) {
    const e = error as { code?: string; userCancelled?: boolean };
    if (e.userCancelled || e.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return false;
    throw error;
  }
}

export async function restore(): Promise<boolean> {
  if (!configured) throw new Error('The store is not available right now.');
  return cache(await Purchases.restorePurchases());
}
