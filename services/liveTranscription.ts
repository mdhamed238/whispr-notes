import type { SpeechToTextType } from 'react-native-executorch/legacy';

export interface LiveTranscript {
  committed: string;
  nonCommitted: string;
}

/** Committed updates are deltas; interim text replaces the previous guess. */
export async function consumeLiveTranscript(
  stream: ReturnType<SpeechToTextType['stream']>,
  onUpdate: (transcript: LiveTranscript) => void
): Promise<string> {
  let committed = '';
  let nonCommitted = '';
  for await (const update of stream) {
    committed += update.committed.text;
    nonCommitted = update.nonCommitted.text ?? '';
    onUpdate({ committed, nonCommitted });
  }
  return (committed + nonCommitted).trim();
}
