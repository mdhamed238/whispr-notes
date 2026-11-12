/**
 * Imports notes from files: .md/.markdown, .txt, Evernote .enex, and .zip
 * archives of those (Notion, Obsidian, Bear exports). Duplicates (same title
 * and text) are skipped, so importing the same export twice is harmless.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import JSZip from 'jszip';

import * as notesRepo from '../db/notesRepo';
import type { Note } from '../../types';
import { ImportedNote, contentHash, parseEnex, parseMarkdown, parseText } from './parsers';

export interface ImportReport {
  imported: number;
  duplicates: number;
  failed: { name: string; reason: string }[];
}

const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const TEXT_EXT = /\.(md|markdown|txt|text)$/i;

function parseByName(name: string, content: string): ImportedNote[] {
  if (/\.enex$/i.test(name)) return parseEnex(content);
  if (/\.(md|markdown)$/i.test(name)) return [parseMarkdown(name, content)];
  return [parseText(name, content)];
}

async function readZip(bytes: Uint8Array, report: ImportReport): Promise<{ name: string; notes: ImportedNote[] }[]> {
  const zip = await JSZip.loadAsync(bytes);
  const out: { name: string; notes: ImportedNote[] }[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || entry.name.startsWith('__MACOSX/') || /(^|\/)\./.test(entry.name)) continue;
    if (!TEXT_EXT.test(entry.name) && !/\.enex$/i.test(entry.name)) continue;
    try {
      out.push({ name: entry.name, notes: parseByName(entry.name, await entry.async('string')) });
    } catch (error) {
      report.failed.push({ name: entry.name, reason: 'Could not read this file' });
    }
  }
  return out;
}

export async function importFiles(assets: { uri: string; name: string }[]): Promise<ImportReport> {
  const report: ImportReport = { imported: 0, duplicates: 0, failed: [] };
  const parsed: ImportedNote[] = [];

  for (const asset of assets) {
    try {
      const file = new File(asset.uri);
      if (/\.zip$/i.test(asset.name)) {
        for (const entry of await readZip(await file.bytes(), report)) parsed.push(...entry.notes);
      } else if (TEXT_EXT.test(asset.name) || /\.enex$/i.test(asset.name)) {
        if ((file.size ?? 0) > MAX_TEXT_BYTES) {
          report.failed.push({ name: asset.name, reason: 'File is larger than 10 MB' });
          continue;
        }
        parsed.push(...parseByName(asset.name, await file.text()));
      } else {
        report.failed.push({ name: asset.name, reason: 'Unsupported file type' });
      }
    } catch (error) {
      console.warn('Import failed for', asset.name, error);
      report.failed.push({ name: asset.name, reason: 'Could not read this file' });
    }
  }

  const now = Date.now();
  const seen = new Set<string>();
  const notes: Note[] = [];
  for (const [i, item] of parsed.entries()) {
    if (!item.body.trim() && !item.title.trim()) continue;
    const hash = contentHash(item.title, item.body);
    if (seen.has(hash) || (await notesRepo.findByContentHash(hash))) {
      report.duplicates++;
      continue;
    }
    seen.add(hash);
    const created = item.createdAt ?? new Date(now);
    notes.push({
      id: `imp_${now}_${i}`,
      title: item.title,
      transcription: item.body,
      audioUri: null,
      duration: 0,
      tags: item.tags,
      pinned: false,
      createdAt: created,
      updatedAt: item.updatedAt ?? created,
      summary: null,
      language: null,
      source: 'import',
      enhancement: 'none',
      enhancementProgress: 0,
      titleIsAuto: false,
      contentHash: hash,
    });
  }

  await notesRepo.createNotes(notes);
  report.imported = notes.length;
  return report;
}

/** Opens the file picker and imports what the user chose. Null when cancelled. */
export async function runImportFlow(): Promise<ImportReport | null> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    type: ['text/*', 'application/zip', 'application/x-zip-compressed', 'application/xml', 'application/octet-stream', '*/*'],
  });
  if (result.canceled || result.assets.length === 0) return null;
  return importFiles(result.assets.map((a) => ({ uri: a.uri, name: a.name })));
}
