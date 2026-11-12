/**
 * Decides which entries of an imported zip to read, before inflating any of
 * them, so a crafted archive (zip bomb, millions of entries) can't exhaust
 * memory. Sizes are the archive's declared uncompressed sizes. Pure.
 */
export const ZIP_LIMITS = {
  maxArchiveBytes: 100 * 1024 * 1024,
  maxEntries: 5000,
  maxEntryBytes: 10 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
} as const;

const SUPPORTED = /\.(md|markdown|txt|text|enex)$/i;

export function planZipEntries<T extends { name: string; size: number }>(
  entries: T[]
): { accepted: T[]; rejected: { name: string; reason: string }[] } {
  const accepted: T[] = [];
  const rejected: { name: string; reason: string }[] = [];
  let total = 0;
  for (const e of entries) {
    if (e.name.endsWith('/') || e.name.startsWith('__MACOSX/') || /(^|\/)\./.test(e.name) || !SUPPORTED.test(e.name)) {
      continue;
    }
    if (accepted.length >= ZIP_LIMITS.maxEntries) {
      rejected.push({ name: e.name, reason: `Archive has more than ${ZIP_LIMITS.maxEntries} notes` });
      continue;
    }
    if (!Number.isFinite(e.size) || e.size < 0 || e.size > ZIP_LIMITS.maxEntryBytes) {
      rejected.push({ name: e.name, reason: 'File is too large (over 10 MB)' });
      continue;
    }
    if (total + e.size > ZIP_LIMITS.maxTotalBytes) {
      rejected.push({ name: e.name, reason: 'Archive is over the 50 MB import limit' });
      continue;
    }
    total += e.size;
    accepted.push(e);
  }
  return { accepted, rejected };
}
