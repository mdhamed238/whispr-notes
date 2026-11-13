/**
 * Finds note files on disk that no note references any more, e.g. when the
 * app was killed during a delete's undo window, before the files were
 * purged. Only files matching the app's own naming are considered. Pure.
 */
export function orphanedFiles(
  files: { audio: string[]; timelines: string[] },
  notes: { id: string; audioUri: string | null }[],
  /** Recordings named after this time (ms) may still be in progress. */
  createdBefore = Number.POSITIVE_INFINITY
): { audio: string[]; timelines: string[] } {
  const createdAt = (f: string) => Number(f.match(/(\d+)\.wav$/i)?.[1] ?? 0);
  const audioInUse = new Set(notes.map((n) => n.audioUri?.split('/').pop()).filter(Boolean) as string[]);
  const ids = new Set(notes.map((n) => n.id));
  return {
    audio: files.audio.filter((f) => /\.wav$/i.test(f) && !audioInUse.has(f) && createdAt(f) < createdBefore),
    timelines: files.timelines.filter((f) => {
      const m = f.match(/^([A-Za-z0-9_-]+)(\.peaks)?\.json$/);
      return Boolean(m) && !ids.has(m![1]);
    }),
  };
}
