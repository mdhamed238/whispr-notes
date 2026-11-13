# Prompt: set up WhisprNotes Pro purchases (App Store, Google Play, RevenueCat)

Paste everything below the line into Cowork.

---

Set up in-app purchases for my iOS/Android app **WhisprNotes** across App Store Connect, Google Play Console and RevenueCat, then report back with the results. Use my browser, where I'm signed in. Work through the steps in order.

## Fixed values (use exactly these)

| | |
|---|---|
| App name | WhisprNotes |
| iOS bundle ID | `com.mdhamed.off.audiotranscriptionapp` |
| Android package | `com.mdhamed.off.audiotranscriptionapp` |
| Seller | Mohamed Hamed (individual developer) |
| Support URL | https://whisprnotes-rho.vercel.app/support |
| Privacy Policy URL | https://whisprnotes-rho.vercel.app/privacy |
| Terms of Use (EULA) URL | https://whisprnotes-rho.vercel.app/terms |
| Subscription group (iOS) | WhisprNotes Pro |
| Entitlement (RevenueCat) | `pro` |

Products (same IDs on both stores):

| Product ID | Type | Price (USD base) | Notes |
|---|---|---|---|
| `whisprnotes_pro_monthly` | Auto-renewing subscription, 1 month | $3.99 | |
| `whisprnotes_pro_yearly` | Auto-renewing subscription, 1 year | $19.99 | Introductory offer: 7-day free trial, new subscribers only |
| `whisprnotes_pro_lifetime` | Non-consumable (iOS) / one-time product (Play) | $39.99 | |

Display names and descriptions:
- Monthly: "WhisprNotes Pro Monthly": "Large-v3 accuracy, unlimited AI summaries, every export, import and Insights."
- Yearly: "WhisprNotes Pro Yearly": same description.
- Lifetime: "WhisprNotes Pro Lifetime": "Every Pro feature, forever, with one payment."

Let each store convert the USD base price to other countries automatically.

## Rules

- **Stop and ask me** whenever you hit any of these, and don't guess:
  - a login or 2FA prompt, or an identity check;
  - accepting an agreement (Paid Apps agreement, Play developer terms);
  - entering bank or tax information;
  - anything that costs money;
  - anything that asks to submit the app for review.
- Don't change the bundle ID or package name. Don't create a second app if one already exists for that ID; use the existing one.
- **Secrets stay where they are.** Upload these files straight from the developer site into RevenueCat:
  - the App Store Connect API key (.p8);
  - the In-App Purchase key (.p8);
  - the Google service-account JSON.

  Never paste their contents into chat or into your report. Never report RevenueCat **secret** keys (they start with `sk_`). Delete any downloaded key files from my Downloads folder once they're uploaded.
- If a step is impossible (for example, Google Play won't let me create products before a build is uploaded), skip it, carry on with what you can, and explain it in the report.

## Steps

### 1. App Store Connect (appstoreconnect.apple.com)
1. In **Certificates, Identifiers & Profiles** (developer.apple.com), make sure the App ID `com.mdhamed.off.audiotranscriptionapp` exists with the In-App Purchase capability. Create it if missing.
2. In App Store Connect → **Apps**, find WhisprNotes, or create it (iOS, name "WhisprNotes", primary language English (U.S.), the bundle ID above, SKU `whisprnotes-ios`).
3. **Business → Agreements**: check the status of the Paid Apps agreement. If it isn't Active, stop and tell me what's missing.
4. In the app → **Monetization → Subscriptions**: create the group "WhisprNotes Pro" and add the monthly and yearly subscriptions with the prices above. On the yearly one, add an introductory offer: free trial, 7 days, all territories. Fill in the display names and descriptions. Upload a review screenshot only if one is required; if I need to provide it, list that under "needs me".
5. **Monetization → In-App Purchases**: create the non-consumable `whisprnotes_pro_lifetime` at $39.99.
6. **Users and Access → Integrations → App Store Connect API**: create a key named "RevenueCat" with the App Manager role. Download the .p8 and note the Key ID and Issuer ID.
7. **Users and Access → Integrations → In-App Purchase**: create a key named "RevenueCat IAP". Download the .p8 and note its Key ID.

### 2. Google Play Console (play.google.com/console)
1. Find the app WhisprNotes, or create it (default language English (US), App, Free, the package above). If it doesn't exist and creating it needs an uploaded build, stop this section and report.
2. **Monetize → Products → Subscriptions**: create `whisprnotes_pro_monthly` (base plan `monthly`, auto-renewing, 1 month, $3.99) and `whisprnotes_pro_yearly` (base plan `yearly`, auto-renewing, 1 year, $19.99, plus an offer `trial7` with a 7-day free trial for new customers). Activate them.
3. **Monetize → Products → In-app products**: create `whisprnotes_pro_lifetime` at $39.99 and activate it.
4. In Google Cloud, create a service account for RevenueCat as described in RevenueCat's "Google Play service credentials" guide. Grant it access in Play Console (**Users and permissions**) with the financial-data and order-management permissions that guide lists. Download its JSON key.

### 3. RevenueCat (app.revenuecat.com)
1. Create a project named "WhisprNotes", or use the existing one.
2. Add an **App Store** app with the bundle ID above:
   - upload the In-App Purchase key (.p8) with its Key ID and Issuer ID;
   - add the App Store Connect API key (.p8) with its Key ID and Issuer ID.
3. Add a **Play Store** app with the package above and upload the service-account JSON. Note that Google can take up to 36 hours to accept new credentials.
4. **Products**: import or add all three products for both platforms.
5. **Entitlements**: create `pro` and attach all six products (3 iOS + 3 Android).
6. **Offerings**: in the `default` offering (mark it Current), create these packages, each attaching the iOS and Android product:
   - `$rc_monthly` → monthly
   - `$rc_annual` → yearly
   - `$rc_lifetime` → lifetime
7. **Project settings → API keys**: copy the **public** app-specific SDK keys. The iOS one starts with `appl_` and the Android one with `goog_`.

## Report back with exactly this

```
REVENUECAT_IOS_PUBLIC_KEY=appl_...
REVENUECAT_ANDROID_PUBLIC_KEY=goog_...

Done:
- (each completed step, one line)

Skipped / blocked:
- (step, reason)

Needs me:
- (anything I must do myself: agreements, tax/bank, screenshots, a first Android build upload)
```
