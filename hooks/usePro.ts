/**
 * Pro entitlement. Reads the cached entitlement (kept fresh by the purchases
 * service) and, in development builds only, the developer override.
 */
import { useSettings } from '@/services/settings';

export function usePro(): { isPro: boolean; loading: boolean } {
  const [settings, , loaded] = useSettings();
  const isPro = (__DEV__ && settings.devProOverride) || settings.proCache?.isPro === true;
  return { isPro, loading: !loaded };
}
