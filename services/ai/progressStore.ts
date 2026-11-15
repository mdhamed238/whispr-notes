/**
 * Live progress of the transcription pass, held in memory.
 *
 * Progress used to be written to the note row about once a second, and every
 * write re-ran the notes list, tags and insights queries. Only the screens
 * showing a progress bar care, so it lives here and they subscribe to it;
 * the database hears about state changes (pending, running, done), not ticks.
 */
export interface EnhanceProgress {
  /** 'model': fetching the speech model first. 'transcribing': the pass itself. */
  phase: 'model' | 'transcribing';
  /** 0..1, or -1 when the engine can't report progress. */
  fraction: number;
}

const progress = new Map<string, EnhanceProgress>();
const listeners = new Set<() => void>();

export function getEnhanceProgress(noteId: string): EnhanceProgress | null {
  return progress.get(noteId) ?? null;
}

export function setEnhanceProgress(noteId: string, value: EnhanceProgress | null): void {
  const previous = progress.get(noteId);
  if (value === null) {
    if (!previous) return;
    progress.delete(noteId);
  } else {
    // Whole percents only: finer steps would re-render for nothing.
    const fraction = value.fraction < 0 ? -1 : Math.round(Math.min(1, value.fraction) * 100) / 100;
    if (previous && previous.phase === value.phase && previous.fraction === fraction) return;
    progress.set(noteId, { phase: value.phase, fraction });
  }
  listeners.forEach((listener) => listener());
}

export function subscribeEnhanceProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
