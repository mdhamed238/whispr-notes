import { useEffect, useState } from 'react';

import { getSummaryState, subscribeSummaryState, type SummaryState } from '@/services/ai/summarizer';

/** Live summary/title generation state for one note. */
export function useSummaryState(noteId: string | undefined): SummaryState {
  const [state, setState] = useState(() => getSummaryState(noteId ?? ''));
  useEffect(() => {
    if (!noteId) return;
    setState(getSummaryState(noteId));
    return subscribeSummaryState((id, next) => {
      if (id === noteId) setState(next);
    });
  }, [noteId]);
  return state;
}
