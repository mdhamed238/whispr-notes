/**
 * Fetches the multilingual speech model ahead of the first recording that
 * needs it, so someone using the app in French isn't left waiting on a
 * download after they press Stop. English uses the model the live preview
 * already installed; Pro's larger models stay opt-in (see the models screen).
 */
import { getAppLanguage } from '../../i18n';
import { peekSettings } from '../settings';
import { effectiveLanguage } from './language';
import * as modelManager from './modelManager';

/** True when recordings in the current language need the multilingual model. */
export function needsMultilingualModel(): boolean {
  return effectiveLanguage(peekSettings().transcriptionLanguage, getAppLanguage()) !== 'en';
}

export function prefetchSpeechModel(): void {
  if (!needsMultilingualModel() || modelManager.status('whisper-base') !== 'absent') return;
  modelManager.download('whisper-base').catch((error) => {
    // Offline or interrupted: the transcription queue fetches it on demand.
    console.warn('Could not prefetch the multilingual model:', error);
  });
}
