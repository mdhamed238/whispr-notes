import { ZIP_LIMITS, planZipEntries } from '../../services/import/zipBudget';

const entry = (name: string, size: number) => ({ name, size });

describe('planZipEntries', () => {
  test('keeps supported text entries and skips folders, hidden and macOS files', () => {
    const plan = planZipEntries([
      entry('a.md', 10),
      entry('__MACOSX/a.md', 10),
      entry('.obsidian/x.md', 10),
      entry('img.png', 10),
      entry('b.txt', 10),
      entry('c.enex', 10),
    ]);
    expect(plan.accepted.map((e) => e.name)).toEqual(['a.md', 'b.txt', 'c.enex']);
  });

  test('an entry larger than the per-file limit is rejected', () => {
    const plan = planZipEntries([entry('big.md', ZIP_LIMITS.maxEntryBytes + 1)]);
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected[0].reason).toMatch(/too large/i);
  });

  test('stops once the total uncompressed budget is spent', () => {
    const nineMb = 9 * 1024 * 1024;
    const plan = planZipEntries(Array.from({ length: 6 }, (_, i) => entry(`${i}.md`, nineMb)));
    expect(plan.accepted).toHaveLength(5);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].reason).toMatch(/limit/i);
  });

  test('caps the number of entries', () => {
    const many = Array.from({ length: ZIP_LIMITS.maxEntries + 5 }, (_, i) => entry(`${i}.md`, 1));
    expect(planZipEntries(many).accepted).toHaveLength(ZIP_LIMITS.maxEntries);
  });
});
