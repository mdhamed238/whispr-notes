/**
 * Type definitions for the Audio Transcription App
 */

/**
 * A single word with its position in the recording, in seconds from the
 * start of the audio file.
 */
export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

/**
 * A timestamped span of transcript.
 *
 * Deliberately narrower than the library's `TranscriptionSegment`: the raw
 * `tokens` array alone would dominate the size of a stored note, and
 * `temperature`/`avgLogprob`/`compressionRatio` are decoding diagnostics we
 * never read back. Keeping our own shape also means the persisted format
 * doesn't move when react-native-executorch changes its own.
 */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: TranscriptWord[];
}

/**
 * Timelines are deliberately NOT a field on `Note`. They are the largest
 * thing a note can carry and the notes list parses every note on each screen
 * focus, so they live in a sidecar file per note instead — see
 * services/timelineStore.ts. Load one with `loadTimeline(note.id)`, and
 * treat `null` as the normal case.
 */

export interface Note {
  id: string;
  title: string;
  transcription: string;
  audioUri: string | null;
  duration: number; // seconds
  tags: string[];
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AudioConfig {
  sampleRate: 16000;
  numberOfChannels: 1;
}

export interface ExportOptions {
  format: 'txt' | 'json' | 'srt';
  includeMetadata: boolean;
}

export interface StorageServiceInterface {
  saveNote(note: Note): Promise<void>;
  getNotes(): Promise<Note[]>;
  updateNote(id: string, updates: Partial<Note>): Promise<void>;
  deleteNote(id: string): Promise<void>;
  exportNote(id: string, options: ExportOptions): Promise<string>;
  shareExportedFile(fileUri: string): Promise<void>;
}
