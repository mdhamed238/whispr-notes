/**
 * Guards for files handed to WhisprNotes by other apps. Strict allow-list:
 * Android content:// URIs, or a file:// URI whose decoded, normalized path
 * is inside iOS's Documents/Inbox (where the system copies opened files).
 * Everything else, including any other path in or outside the app's
 * sandbox, is refused, so a crafted link can't import the app's own private
 * files. Pure.
 */

/** Decoded, normalized absolute path of a file:// URI, or null if it's unsafe or malformed. */
export function canonicalFilePath(uri: string): string | null {
  const m = uri.match(/^file:\/\/([^/]*)(\/.*)$/i);
  if (!m) return null;
  const host = m[1];
  if (host !== '' && host.toLowerCase() !== 'localhost') return null;
  const rawPath = m[2];
  // Encoded separators would turn into path structure after decoding.
  if (/%2f|%5c|\\/i.test(rawPath)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const parts: string[] = [];
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null; // never resolve upward; refuse instead
    parts.push(segment);
  }
  let path = `/${parts.join('/')}`;
  // iOS reports the same container as /var/... and /private/var/...
  if (path.startsWith('/private/var/')) path = path.slice('/private'.length);
  return path;
}

export function isAcceptableIncomingUri(uri: string, appDocumentsUri: string): boolean {
  if (/^content:\/\/[^/]+\//i.test(uri)) return true;
  const path = canonicalFilePath(uri);
  const docs = canonicalFilePath(appDocumentsUri.endsWith('/') ? appDocumentsUri : `${appDocumentsUri}/`);
  if (!path || !docs) return false;
  return path.startsWith(`${docs}/Inbox/`);
}

export function incomingFileName(uri: string): string {
  const last = uri.split('/').pop() ?? 'file';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}
