/**
 * Writes export files (to the cache, never the documents folder, so they
 * don't pile up in backups) and hands them to the system share sheet.
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { Note } from '../../types';
import { loadTimeline } from '../timelineStore';
import { ExportScope, slugify, toMarkdown, toSrt, toText } from './generators';
import { buildPdfHtml } from './pdfTemplate';

export type ExportFormat = 'pdf' | 'md' | 'txt' | 'srt' | 'audio';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  md: 'text/markdown',
  txt: 'text/plain',
  srt: 'application/x-subrip',
  audio: 'audio/wav',
};

const UTI: Partial<Record<ExportFormat, string>> = {
  pdf: 'com.adobe.pdf',
  md: 'net.daringfireball.markdown',
  txt: 'public.plain-text',
  audio: 'com.microsoft.waveform-audio',
};

export function exportDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function writeExportFile(fileName: string, content: string | Uint8Array): string {
  const file = new File(exportDirectory(), fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  return file.uri;
}

/** Text-based exports. */
export async function exportTextFile(note: Note, format: 'txt' | 'srt', scope: ExportScope = 'full'): Promise<string> {
  const content = format === 'txt' ? toText(note, { scope }) : toSrt(note, await loadTimeline(note.id));
  return writeExportFile(`${slugify(note.title)}.${format}`, content);
}

export async function exportNote(
  note: Note,
  format: ExportFormat,
  o: { scope: ExportScope; timestamps: boolean }
): Promise<string> {
  const name = slugify(note.title);
  switch (format) {
    case 'txt':
    case 'srt':
      return exportTextFile(note, format, o.scope);
    case 'md': {
      const segments = o.timestamps ? await loadTimeline(note.id) : null;
      return writeExportFile(`${name}.md`, toMarkdown(note, { ...o, segments }));
    }
    case 'pdf': {
      const segments = o.timestamps ? await loadTimeline(note.id) : null;
      const { uri } = await Print.printToFileAsync({ html: buildPdfHtml(note, { ...o, segments }) });
      // Give the PDF a readable name instead of the printer's random one.
      const target = new File(exportDirectory(), `${name}.pdf`);
      if (target.exists) target.delete();
      await new File(uri).move(target);
      return target.uri;
    }
    case 'audio': {
      if (!note.audioUri) throw new Error('This note has no recording');
      const source = new File(note.audioUri);
      if (!source.exists) throw new Error('The recording file is missing');
      const target = new File(exportDirectory(), `${name}.wav`);
      if (target.exists) target.delete();
      await source.copy(target);
      return target.uri;
    }
  }
}

export async function shareFile(uri: string, mimeType: string, dialogTitle?: string, uti?: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle, UTI: uti });
}

export async function exportAndShare(
  note: Note,
  format: ExportFormat,
  o: { scope: ExportScope; timestamps: boolean }
): Promise<void> {
  const uri = await exportNote(note, format, o);
  await shareFile(uri, EXPORT_MIME[format], note.title, UTI[format]);
}

/** Clears old export files (they're only needed until shared). */
export function clearExports(): void {
  try {
    const dir = new Directory(Paths.cache, 'exports');
    if (dir.exists) dir.delete();
  } catch (error) {
    console.warn('Failed to clear exports:', error);
  }
}
