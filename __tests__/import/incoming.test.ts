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
