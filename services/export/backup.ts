/**
 * Backup: every note as a Markdown file in one zip, shared via the system
 * sheet (Files, Drive, AirDrop…). Text only; recordings stay on the phone.
 */
import JSZip from 'jszip';

import * as notesRepo from '../db/notesRepo';
import { loadTimeline } from '../timelineStore';
import { exportDirectory, shareFile, writeExportFile } from './exporter';
import { slugify, toMarkdown } from './generators';

export async function backupAllNotes(): Promise<number> {
  const notes = await notesRepo.listNotes({ sort: 'oldest' });
  if (notes.length === 0) throw new Error('There are no notes to back up');

  const zip = new JSZip();
  const used = new Set<string>();
  for (const note of notes) {
    let name = `${note.createdAt.toISOString().slice(0, 10)}-${slugify(note.title)}`;
    for (let n = 2; used.has(name); n++) name = `${name}-${n}`;
    used.add(name);
    const segments = await loadTimeline(note.id);
    zip.file(`${name}.md`, toMarkdown(note, { scope: 'full', segments, timestamps: Boolean(segments) }));
  }

  exportDirectory();
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const uri = writeExportFile(`whisprnotes-backup-${new Date().toISOString().slice(0, 10)}.zip`, bytes);
  await shareFile(uri, 'application/zip', 'WhisprNotes backup', 'public.zip-archive');
  return notes.length;
}
