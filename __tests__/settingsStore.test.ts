/**
 * The settings store: what screens read, as opposed to the model in
 * settings.test.ts. A change made during a session must hold for everything
 * that reads the settings afterwards, not only for the screens already open.
 */
const KEY = 'settings.v1';

/** The storage mock as currently loaded (jest.setup.js); CommonJS or ES default. */
function asyncStorage() {
  const module = require('@react-native-async-storage/async-storage');
  return module.default ?? module;
}

/**
 * The app as freshly launched, with `stored` (or whatever the last launch
 * left) on disk. The store keeps what it loaded in module state, so every
 * launch needs fresh modules: React and the storage mock included.
 */
async function launch(stored?: string) {
  const last = asyncStorage();
  const onDisk = stored ?? (await last.getItem(KEY));
  jest.resetModules();
  const storage = asyncStorage();
  if (onDisk !== null && onDisk !== undefined) await storage.setItem(KEY, onDisk);
  const store: typeof import('../services/settings') = require('../services/settings');
  const React: typeof import('react') = require('react');
  const { act, create } = require('react-test-renderer');
  return { store, React, act, create };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

test('a change is what later reads see, not the settings the app launched with', async () => {
  const { store } = await launch(JSON.stringify({ transcriptionLanguage: 'en' }));
  expect((await store.getSettings()).transcriptionLanguage).toBe('en');

  await store.updateSettings({ transcriptionLanguage: 'fr' });
  expect((await store.getSettings()).transcriptionLanguage).toBe('fr');
  expect(store.peekSettings().transcriptionLanguage).toBe('fr');

  // And it is what the next launch reads.
  const next = await launch();
  expect((await next.store.getSettings()).transcriptionLanguage).toBe('fr');
});

test('a screen opened after a change shows the change, and keeps it once loading settles', async () => {
  const { store, React, act, create } = await launch(JSON.stringify({ transcriptionLanguage: 'en' }));
  const seen: string[] = [];
  function Screen() {
    const [settings, , loaded] = store.useSettings();
    seen.push(`${settings.transcriptionLanguage}${loaded ? '' : ' (loading)'}`);
    return null;
  }

  // The app starts, then the language is changed (as the settings screen does).
  await store.getSettings();
  await store.updateSettings({ transcriptionLanguage: 'fr' });

  // The record screen is mounted anew after every Save and Reset.
  let screen: { unmount(): void };
  await act(async () => { screen = create(React.createElement(Screen)); });
  expect(seen[0]).toBe('fr (loading)');
  expect(seen[seen.length - 1]).toBe('fr');
  expect(seen).not.toContain('en');

  // Screens already open follow a later change.
  await act(async () => { await store.updateSettings({ transcriptionLanguage: 'de' }); });
  expect(seen[seen.length - 1]).toBe('de');
  await act(async () => { screen!.unmount(); });
});

test('unreadable storage gives defaults, and changes still apply', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const { store } = await launch('{ not json');
  expect((await store.getSettings()).transcriptionLanguage).toBe('auto');
  await store.updateSettings({ transcriptionLanguage: 'es' });
  expect((await store.getSettings()).transcriptionLanguage).toBe('es');
  warn.mockRestore();
});
