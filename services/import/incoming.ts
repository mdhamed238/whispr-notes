/**
 * Guards for files handed to WhisprNotes by other apps. Only content:// URIs
 * (Android) and iOS's Documents/Inbox copies are accepted, so a crafted link
 * can't make the app import its own private files. Pure.
 */
export function isAcceptableIncomingUri(uri: string, appDocumentsUri: string): boolean {
  if (/^content:\/\//i.test(uri)) return true;
  if (!/^file:\/\//i.test(uri)) return false;
  if (/(^|\/)\.\.(\/|$)/.test(uri) || /%2e%2e/i.test(uri)) return false;
  const docs = appDocumentsUri.endsWith('/') ? appDocumentsUri : `${appDocumentsUri}/`;
  if (uri.startsWith(docs)) return uri.startsWith(`${docs}Inbox/`);
  // Anywhere else in the app's own container (caches, Library) is refused;
  // other file:// locations come from the system share/open flow.
  const container = docs.replace(/[^/]+\/$/, '');
  return !uri.startsWith(container);
}

export function incomingFileName(uri: string): string {
  const last = uri.split('/').pop() ?? 'file';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}
