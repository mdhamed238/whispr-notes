/**
 * react-native-executorch reports each model download to its maker's
 * analytics endpoint. WhisprNotes promises no analytics, so the downloader it
 * hands the library is wrapped (services/ai/quietResourceFetcher.ts).
 *
 * These tests run the library's real download entry point, not a copy of its
 * logic: first to show that it does report, then that the wrapper stops it.
 */
import { withoutDownloadReports } from '../../services/ai/quietResourceFetcher';

// By file path: the package only exports its index, which needs native modules.
const { ResourceFetcher } = require('../../node_modules/react-native-executorch/lib/module/legacy/src/utils/ResourceFetcher.js');
const modelUrls = require('../../node_modules/react-native-executorch/lib/module/legacy/src/constants/modelUrls.js');

/** A model the library ships a name for; those are the ones it reports. */
const KNOWN_MODEL_URL = Object.values(modelUrls).find(
  (value): value is string => typeof value === 'string' && Boolean(modelUrls.getModelNameForUrl(value))
)!;

/** Stands in for the real downloader: every source was freshly downloaded. */
function downloader() {
  return {
    fetch: jest.fn(async (progress: (fraction: number) => void, ...sources: unknown[]) => {
      progress(1);
      return { paths: sources.map((_, i) => `/models/${i}.pte`), wasDownloaded: sources.map(() => true) };
    }),
    readAsString: jest.fn(async (path: string) => `contents of ${path}`),
  };
}

const realFetch = globalThis.fetch;
let network: jest.Mock;

beforeEach(() => {
  network = jest.fn(async () => ({ ok: true }));
  globalThis.fetch = network as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  ResourceFetcher.resetAdapter();
});

test('the library knows the model used here, so the cases below exercise its reporting', () => {
  expect(KNOWN_MODEL_URL).toMatch(/^https:\/\/huggingface\.co\//);
});

test('left alone, the library reports a download to its analytics endpoint', async () => {
  ResourceFetcher.setAdapter(downloader());
  await ResourceFetcher.fetch(() => {}, KNOWN_MODEL_URL);

  const requests = network.mock.calls.map(([url]) => String(url));
  expect(requests.some((url) => url.includes('ai.swmansion.com/telemetry'))).toBe(true);
  const report = network.mock.calls.find(([url]) => String(url).includes('telemetry'))!;
  // What it would have sent: this is why it must not go out.
  expect(JSON.parse(report[1].body)).toEqual(
    expect.objectContaining({ modelName: expect.any(String), countryCode: expect.any(String), libVersion: expect.any(String) })
  );
});

test('with the WhisprNotes downloader, a model download makes no request beyond the download itself', async () => {
  const inner = downloader();
  ResourceFetcher.setAdapter(withoutDownloadReports(inner));
  const progress = jest.fn();

  const paths = await ResourceFetcher.fetch(progress, KNOWN_MODEL_URL, 'https://example.com/tokenizer.json');

  // The library made no network request of its own: no analytics, no counter.
  expect(network).not.toHaveBeenCalled();
  // The download itself is untouched.
  expect(paths).toEqual(['/models/0.pte', '/models/1.pte']);
  expect(inner.fetch).toHaveBeenCalledTimes(1);
  expect(inner.fetch.mock.calls[0].slice(1)).toEqual([KNOWN_MODEL_URL, 'https://example.com/tokenizer.json']);
  expect(progress).toHaveBeenCalledWith(1);
});

test('reading a downloaded file still goes to the real downloader', async () => {
  const inner = downloader();
  ResourceFetcher.setAdapter(withoutDownloadReports(inner));
  expect(await ResourceFetcher.fs.readAsString('/models/tokenizer.json')).toBe('contents of /models/tokenizer.json');
});

test('the wrapper calls the downloader as a method, since the real one is a class instance', async () => {
  class Downloader {
    private readonly root = '/models';
    async fetch(_progress: (fraction: number) => void, ...sources: unknown[]) {
      return { paths: sources.map((_, i) => `${this.root}/${i}`), wasDownloaded: sources.map(() => true) };
    }
    async readAsString(path: string) {
      return `${this.root}:${path}`;
    }
  }
  const wrapped = withoutDownloadReports(new Downloader());
  expect(await wrapped.fetch(() => {}, 'a', 'b')).toEqual({ paths: ['/models/0', '/models/1'], wasDownloaded: [false, false] });
  expect(await wrapped.readAsString('x')).toBe('/models:x');
});
