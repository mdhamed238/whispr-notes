import type { SpeechToTextType } from 'react-native-executorch/legacy';

export interface LiveTranscript {
  committed: string;
  nonCommitted: string;
}

/** Joins two pieces of transcript, adding a space only where one is missing. */
export function joinTranscript(before: string, after: string, unspaced = false): string {
  if (!before) return after;
  if (!after) return before;
  if (unspaced || /\s$/.test(before) || /^\s/.test(after)) return before + after;
  return `${before} ${after}`;
}

/**
 * Committed updates are deltas; interim text replaces the previous guess.
 * `prefix` is what was already transcribed before this stream began (the
 * part of the take recorded before a pause).
 */
export async function consumeLiveTranscript(
  stream: ReturnType<SpeechToTextType['stream']>,
  onUpdate: (transcript: LiveTranscript) => void,
  prefix = ''
): Promise<string> {
  let committed = '';
  let nonCommitted = '';
  for await (const update of stream) {
    committed += update.committed.text;
    nonCommitted = update.nonCommitted.text ?? '';
    onUpdate({ committed: joinTranscript(prefix, committed), nonCommitted });
  }
  return (joinTranscript(prefix, committed) + nonCommitted).trim();
}
