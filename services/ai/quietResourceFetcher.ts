/**
 * The model downloader handed to ExecuTorch, minus its reporting.
 *
 * react-native-executorch reports every model download: it posts a "download
 * event" (the model's name, the country taken from the phone's locale, the
 * library version) to its maker's analytics endpoint, and pings a Hugging
 * Face download counter. The legacy API this app uses has no switch for it.
 *
 * WhisprNotes promises that it has no analytics, and that the network is used
 * only to download models and for purchases. The library decides whether to
 * report from the `wasDownloaded` flags its downloader returns, and reads
 * them for nothing else, so answering "nothing was downloaded" keeps the
 * download exactly as it is and drops the report.
 *
 * `__tests__/ai/quietResourceFetcher.test.ts` runs the library's real
 * download entry point both ways. If it fails after a library upgrade, the
 * library has changed how it reports: fix this before shipping.
 */
import type { ResourceFetcherAdapter } from 'react-native-executorch/legacy';

export function withoutDownloadReports(fetcher: ResourceFetcherAdapter): ResourceFetcherAdapter {
  return {
    // Called as methods: the downloader is a class instance.
    fetch: async (callback, ...sources) => {
      const { paths } = await fetcher.fetch(callback, ...sources);
      return { paths, wasDownloaded: sources.map(() => false) };
    },
    readAsString: (path) => fetcher.readAsString(path),
  };
}
