/** Non-hook Pro check for background services. */
import { peekSettings } from '../settings';

export function isProNow(): boolean {
  const s = peekSettings();
  return (__DEV__ && s.devProOverride) || s.proCache?.isPro === true;
}
