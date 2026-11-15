/**
 * Real waveform for a note's recording, cached beside its timeline
 * (timelines/<id>.peaks.json).
 *
 * New recordings save their peaks as they're captured (`savePeaks`). Older
 * recordings and imported audio are measured on first view by reading the
 * WAV a piece at a time, in constant memory: decoding an hour of audio just
 * to draw 64 bars used to cost about 230 MB.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { decodeToPcm } from './transcriptionTimeline';
import { computePeaks, createPcm16PeakReader } from './waveform';

export const PEAK_COUNT = 64;

const WAV_HEADER_BYTES = 44;
const READ_CHUNK_BYTES = 256 * 1024;

function peaksFile(noteId: string): File | null {
  if (!/^[A-Za-z0-9_-]+$/.test(noteId)) return null;
  return new File(new Directory(Paths.document, 'timelines'), `${noteId}.peaks.json`);
}

function round(peaks: number[]): number[] {
  return peaks.map((p) => Math.round(p * 1000) / 1000);
}

/** Stores peaks computed elsewhere (the recorder collects them while capturing). */
export function savePeaks(noteId: string, peaks: number[]): void {
  const file = peaksFile(noteId);
  if (!file || peaks.length !== PEAK_COUNT) return;
  try {
    const dir = new Directory(Paths.document, 'timelines');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    file.create({ overwrite: true });
    file.write(JSON.stringify(round(peaks)));
  } catch (error) {
    console.warn('Failed to save waveform:', error);
  }
}

/**
 * Peaks for a WAV in the app's own format (16-bit mono PCM, 44-byte header),
 * read in pieces. Null when the file is anything else.
 */
function readWavPeaks(audioUri: string): number[] | null {
  const file = new File(audioUri);
  if (!file.exists) return null;
  const handle = file.open();
  try {
    const header = handle.readBytes(WAV_HEADER_BYTES);
    const tag = (offset: number) => String.fromCharCode(...header.subarray(offset, offset + 4));
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const isOurWav =
      header.length === WAV_HEADER_BYTES &&
      tag(0) === 'RIFF' &&
      tag(8) === 'WAVE' &&
      tag(36) === 'data' &&
      view.getUint16(20, true) === 1 &&
      view.getUint16(22, true) === 1 &&
      view.getUint16(34, true) === 16;
    if (!isOurWav) return null;

    const dataBytes = Math.max(0, (file.size ?? 0) - WAV_HEADER_BYTES);
    const reader = createPcm16PeakReader(Math.floor(dataBytes / 2), PEAK_COUNT);
    for (let read = 0; read < dataBytes; ) {
      const chunk = handle.readBytes(Math.min(READ_CHUNK_BYTES, dataBytes - read));
      if (chunk.length === 0) break;
      reader.push(chunk);
      read += chunk.length;
    }
    return reader.result();
  } finally {
    handle.close();
  }
}

export async function loadPeaks(noteId: string, audioUri: string): Promise<number[] | null> {
  const file = peaksFile(noteId);
  if (!file) return null;
  try {
    if (file.exists) {
      const cached = JSON.parse(await file.text());
      if (Array.isArray(cached) && cached.length === PEAK_COUNT) return cached as number[];
    }
    const peaks = readWavPeaks(audioUri) ?? computePeaks(await decodeToPcm(audioUri), PEAK_COUNT);
    savePeaks(noteId, peaks);
    return round(peaks);
  } catch (error) {
    console.warn('Failed to compute waveform:', error);
    return null;
  }
}
