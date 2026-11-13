/**
 * One note plus its timeline, kept live: reloads whenever the repo reports a
 * write to this note (e.g. the enhanced transcript or summary landing while
 * the note is open).
 */
import { useCallback, useEffect, useState } from 'react';

import * as notesRepo from '@/services/db/notesRepo';
import { loadTimeline } from '@/services/timelineStore';
import type { Note, TranscriptSegment } from '@/types';

export function useNote(id: string | undefined) {
  const [note, setNote] = useState<Note | null>(null);
  const [timeline, setTimeline] = useState<TranscriptSegment[] | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      const found = await notesRepo.getNote(id);
      const segments = found?.audioUri ? await loadTimeline(found.id) : null;
      setNote(found);
      setTimeline(segments);
    } catch (error) {
      console.error('Failed to load note:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
    return notesRepo.subscribe((changedId) => {
      if (changedId === null || changedId === id) void reload();
    });
  }, [id, reload]);

  return { note, timeline, loading, reload, setTimeline };
}
