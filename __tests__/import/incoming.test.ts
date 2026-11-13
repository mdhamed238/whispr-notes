import { incomingFileName, isAcceptableIncomingUri } from '../../services/import/incoming';

const DOCS = 'file:///var/mobile/Containers/Data/Application/ABC/Documents/';

describe('isAcceptableIncomingUri', () => {
  test('Android content URIs are accepted', () => {
    expect(isAcceptableIncomingUri('content://com.android.providers.downloads/document/12', DOCS)).toBe(true);
  });
  test('iOS Inbox copies are accepted', () => {
    expect(isAcceptableIncomingUri(`${DOCS}Inbox/notes.md`, DOCS)).toBe(true);
  });
  test('files elsewhere in the app sandbox are refused', () => {
    expect(isAcceptableIncomingUri(`${DOCS}audio/123.wav`, DOCS)).toBe(false);
    expect(isAcceptableIncomingUri(`${DOCS}Inbox/../timelines/1.json`, DOCS)).toBe(false);
  });
  test('encoded traversal and encoded separators are refused', () => {
    expect(isAcceptableIncomingUri(`${DOCS}Inbox/%2e%2e/timelines/1.json`, DOCS)).toBe(false);
    expect(isAcceptableIncomingUri(`${DOCS}Inbox/%2E%2E%2Ftimelines%2F1.json`, DOCS)).toBe(false);
    expect(isAcceptableIncomingUri(`${DOCS}Inbox/..%5ctimelines`, DOCS)).toBe(false);
    expect(isAcceptableIncomingUri(`${DOCS}Inbox/%E0%A4%A`, DOCS)).toBe(false);
  });
  test('only the Inbox is allowed for file URIs, wherever else they point', () => {
    expect(isAcceptableIncomingUri('file:///private/var/mobile/Library/x.md', DOCS)).toBe(false);
    expect(isAcceptableIncomingUri('file:///tmp/x.md', DOCS)).toBe(false);
  });
  test('/private/var and /var are the same container', () => {
    expect(isAcceptableIncomingUri('file:///private/var/mobile/Containers/Data/Application/ABC/Documents/Inbox/n.md', DOCS)).toBe(true);
  });
  test('duplicate slashes and dot segments are normalized', () => {
    expect(isAcceptableIncomingUri(`${DOCS}Inbox//./notes.md`, DOCS)).toBe(true);
  });
  test('a file URI with a host is refused', () => {
    expect(isAcceptableIncomingUri('file://evil/var/mobile/Containers/Data/Application/ABC/Documents/Inbox/n.md', DOCS)).toBe(false);
  });
  test('other schemes are refused', () => {
    expect(isAcceptableIncomingUri('https://example.com/a.md', DOCS)).toBe(false);
    expect(isAcceptableIncomingUri('whisprnotes://x', DOCS)).toBe(false);
  });
});

describe('incomingFileName', () => {
  test('decodes the last path segment', () => {
    expect(incomingFileName(`${DOCS}Inbox/My%20notes.md`)).toBe('My notes.md');
  });
  test('survives malformed escapes', () => {
    expect(incomingFileName('file:///x/bad%E0%A4%A.md')).toBe('bad%E0%A4%A.md');
  });
});
