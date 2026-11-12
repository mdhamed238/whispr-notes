/**
 * Writes export files to disk and hands them to the system share sheet.
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Note } from '../../types';
import { loadTimeline } from '../timelineStore';
import { ExportScope, slugify, toSrt, toText } from './generators';

export type ExportFormat = 'pdf' | 'md' | 'txt' | 'srt' | 'audio';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  md: 'text/markdown',
  txt: 'text/plain',
  srt: 'application/x-subrip',
  audio: 'audio/wav',
};

export function exportDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function writeExportFile(fileName: string, content: string): string {
  const file = new File(exportDirectory(), fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  return file.uri;
}

/** Text-based exports available to every user. Richer formats live in Task 10. */
export async function exportTextFile(note: Note, format: 'txt' | 'srt', scope: ExportScope = 'full'): Promise<string> {
  const content = format === 'txt' ? toText(note, { scope }) : toSrt(note, await loadTimeline(note.id));
  return writeExportFile(`${slugify(note.title)}.${format}`, content);
}

export async function shareFile(uri: string, mimeType: string, dialogTitle?: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle });
}
