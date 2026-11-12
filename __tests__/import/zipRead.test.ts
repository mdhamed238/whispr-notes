import JSZip from 'jszip';

import { readEntryBounded } from '../../services/import/zipRead';

async function entryWith(content: string) {
  const zip = new JSZip();
  zip.file('a.md', content);
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
  return loaded.file('a.md')!;
}

describe('readEntryBounded', () => {
  test('returns the text when within the limit', async () => {
    const entry = await entryWith('hello world');
    await expect(readEntryBounded(entry, 1000)).resolves.toBe('hello world');
  });

  test('stops inflating and rejects once the limit is passed', async () => {
    // Highly compressible: tiny on disk, large when inflated.
    const entry = await entryWith('a'.repeat(2_000_000));
    await expect(readEntryBounded(entry, 100_000)).rejects.toThrow(/too large/i);
  });
});
