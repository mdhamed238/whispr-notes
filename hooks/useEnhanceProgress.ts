import { useCallback, useSyncExternalStore } from 'react';

import { type EnhanceProgress, getEnhanceProgress, subscribeEnhanceProgress } from '@/services/ai/progressStore';

/** Live transcription progress for one note, or null when nothing is running. */
export function useEnhanceProgress(noteId: string | undefined): EnhanceProgress | null {
  const snapshot = useCallback(() => (noteId ? getEnhanceProgress(noteId) : null), [noteId]);
  return useSyncExternalStore(subscribeEnhanceProgress, snapshot, snapshot);
}
