/**
 * Pro entitlement. Until purchases are wired (Task 13) this reads the cached
 * entitlement and, in development builds only, the developer override.
 */
import { useSettings } from '@/services/settings';

export function usePro(): { isPro: boolean; loading: boolean } {
  const [settings, , loaded] = useSettings();
  const isPro = (__DEV__ && settings.devProOverride) || settings.proCache?.isPro === true;
  return { isPro, loading: !loaded };
}
