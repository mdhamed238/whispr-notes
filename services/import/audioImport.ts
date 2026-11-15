/**
 * Transcribe an existing audio file (voice memo, lecture, call recording).
 *
 * The file is decoded to the 16 kHz mono WAV the rest of the app works
 * with, saved as a note with that audio, and handed to the same background
 * queue a recording goes through, so it gets the same transcript, word
 * timings, summary and title. Nothing leaves the phone.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { AUDIO_CONFIG } from '../../constants/config';
import type { Note } from '../../types';
import * as enhanceQueue from '../ai/enhanceQueue';
import * as notesRepo from '../db/notesRepo';
import { decodeToPcm } from '../transcriptionTimeline';
import { WavFileWriter } from '../wavEncoder';
import { bucketPeaks } from '../waveform';
import { PEAK_COUNT, savePeaks } from '../waveformStore';
import { notionTitle } from './parsers';

/**
 * Decoding holds the whole file as 16 kHz samples (about 230 MB per hour),
 * so very large files are refused up front rather than risking the app.
 */
export const MAX_AUDIO_IMPORT_BYTES = 200 * 1024 * 1024;
const MIN_SAMPLES = AUDIO_CONFIG.sampleRate; // one second: Whisper's minimum
const WRITE_SAMPLES = AUDIO_CONFIG.sampleRate * 5;

export type AudioImportFailure = 'too-large' | 'unreadable' | 'too-short';

export class AudioImportError extends Error {
  constructor(public reason: AudioImportFailure) {
    super(`Audio import failed: ${reason}`);
  }
}

export interface PickedAudio {
  uri: string;
  name: string;
  size: number | null;
}

/** Opens the file picker for audio. Null when cancelled. */
export async function pickAudioFile(): Promise<PickedAudio | null> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    type: ['audio/*', 'video/mp4', 'application/ogg'],
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, name: asset.name, size: asset.size ?? null };
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Converts the file, saves it as a note and queues its transcription. Returns the note id. */
export async function importAudioFile(picked: PickedAudio, fallbackTitle: string): Promise<string> {
  const source = new File(picked.uri);
  const size = picked.size ?? source.size ?? 0;
  if (size > MAX_AUDIO_IMPORT_BYTES) throw new AudioImportError('too-large');

  let pcm: Float32Array;
  try {
    pcm = await decodeToPcm(picked.uri);
  } catch (error) {
    console.warn('Could not decode audio file:', error);
    throw new AudioImportError('unreadable');
  }
  if (pcm.length < MIN_SAMPLES) throw new AudioImportError(pcm.length === 0 ? 'unreadable' : 'too-short');

  const writer = WavFileWriter.create(AUDIO_CONFIG.sampleRate);
  try {
    for (let offset = 0; offset < pcm.length; offset += WRITE_SAMPLES) {
      writer.write(pcm.subarray(offset, Math.min(pcm.length, offset + WRITE_SAMPLES)));
      // Let the interface breathe: an hour of audio is hundreds of writes.
      if ((offset / WRITE_SAMPLES) % 12 === 11) await nextTick();
    }
  } catch (error) {
    writer.discard();
    throw error;
  }
  const wav = writer.finalize();
  if (!wav) throw new AudioImportError('unreadable');

  const now = new Date();
  const note: Note = {
    id: `aud_${now.getTime()}`,
    title: notionTitle(picked.name).slice(0, 80) || fallbackTitle,
    transcription: '',
    audioUri: wav.uri,
    duration: wav.durationSeconds,
    tags: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
    summary: null,
    language: null,
    source: 'import',
    enhancement: 'none',
    enhancementProgress: 0,
    // The file name is a placeholder until the AI title is written.
    titleIsAuto: true,
    contentHash: null,
  };

  try {
    await notesRepo.createNote(note);
  } catch (error) {
    new File(wav.uri).delete();
    throw error;
  }
  savePeaks(note.id, bucketPeaks(wav.chunkPeaks, PEAK_COUNT));
  await enhanceQueue.enqueue(note.id, 'enhance');

  // The picker's copy in the cache is no longer needed.
  try {
    if (source.exists) source.delete();
  } catch {
    // It lives in the cache; the system clears it eventually.
  }
  return note.id;
}
