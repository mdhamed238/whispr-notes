/**
 * Live, filtered notes list. Re-queries when the filters change (search is
 * debounced while typing) and whenever the repo reports a write, so notes
 * finishing enhancement or summaries in the background update in place.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import * as notesRepo from '@/services/db/notesRepo';
import type { Note, NoteSort } from '@/types';

const QUERY_DEBOUNCE_MS = 150;
const CHANGE_DEBOUNCE_MS = 50;

export function useNotes(opts: { query: string; tag: string | null; sort: NoteSort }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const next = await notesRepo.listNotes(optsRef.current);
      // Drop out-of-order results from an older, slower query.
      if (id === requestId.current) {
        setNotes(next);
        setError(null);
      }
    } catch (e) {
      console.error('Failed to load notes:', e);
      if (id === requestId.current) setError(e as Error);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(refresh, opts.query ? QUERY_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [opts.query, opts.tag, opts.sort, refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = notesRepo.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, CHANGE_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh]);

  return { notes, loading, error, refresh };
}

/** All tags with counts, kept live. */
export function useTags() {
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      notesRepo
        .allTags()
        .then((t) => !cancelled && setTags(t))
        .catch((e) => console.warn('Failed to load tags:', e));
    load();
    const unsubscribe = notesRepo.subscribe(() => load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return tags;
}
