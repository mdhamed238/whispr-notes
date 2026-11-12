/**
 * Real waveform for a note's recording, computed once from the WAV and
 * cached beside its timeline (timelines/<id>.peaks.json).
 */
import { Directory, File, Paths } from 'expo-file-system';

import { decodeToPcm } from './transcriptionTimeline';
import { computePeaks } from './waveform';

export const PEAK_COUNT = 64;

function peaksFile(noteId: string): File | null {
  if (!/^[A-Za-z0-9_-]+$/.test(noteId)) return null;
  return new File(new Directory(Paths.document, 'timelines'), `${noteId}.peaks.json`);
}

export async function loadPeaks(noteId: string, audioUri: string): Promise<number[] | null> {
  const file = peaksFile(noteId);
  if (!file) return null;
  try {
    if (file.exists) {
      const cached = JSON.parse(await file.text());
      if (Array.isArray(cached) && cached.length === PEAK_COUNT) return cached as number[];
    }
    const pcm = await decodeToPcm(audioUri);
    const peaks = computePeaks(pcm, PEAK_COUNT).map((p) => Math.round(p * 1000) / 1000);
    const dir = new Directory(Paths.document, 'timelines');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    file.create({ overwrite: true });
    file.write(JSON.stringify(peaks));
    return peaks;
  } catch (error) {
    console.warn('Failed to compute waveform:', error);
    return null;
  }
}
