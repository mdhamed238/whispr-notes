/** Placeholder until Task 11: picking and importing files. */
export interface ImportReport {
  imported: number;
  duplicates: number;
  failed: { name: string; reason: string }[];
}

export async function runImportFlow(): Promise<ImportReport | null> {
  return null;
}
