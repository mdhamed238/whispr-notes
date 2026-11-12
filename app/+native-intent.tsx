/**
 * Routes files handed over by other apps ("Open in WhisprNotes") to the
 * import screen instead of treating them as app links.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (/^(file|content):\/\//i.test(path)) {
      return `/import?uri=${encodeURIComponent(path)}`;
    }
  } catch {
    // Fall through to normal routing.
  }
  return path;
}
