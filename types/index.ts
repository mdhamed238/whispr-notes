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

export type EnhancementState = 'none' | 'pending' | 'running' | 'done' | 'failed';

/** Structured meeting summary produced on-device by the summarizer. */
export interface NoteSummary {
  overview: string;
  keyPoints: string[];
  actionItems: string[];
  decisions: string[];
  /** Which LLM produced it, e.g. `qwen3-1.7b`. */
  model: string;
  /** ISO timestamp. */
  generatedAt: string;
}

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
  summary: NoteSummary | null;
  /** Language the final transcript is in (ISO code), when known. */
  language: string | null;
  source: 'recording' | 'import';
  /** State of the post-recording "enhanced transcription" pass. */
  enhancement: EnhancementState;
  /** 0..1, or -1 when the running engine can't report progress. */
  enhancementProgress: number;
  /** True while the title is machine-generated; a user edit sets it false. */
  titleIsAuto: boolean;
  /** Set for imported notes, used to skip duplicates on re-import. */
  contentHash: string | null;
}

export type NoteSort = 'newest' | 'oldest' | 'longest' | 'title';

export interface AudioConfig {
  sampleRate: 16000;
  numberOfChannels: 1;
}
