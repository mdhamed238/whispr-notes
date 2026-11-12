import type { TranscriptSegment } from '../../../types';
import type { EngineId } from '../tiers';

export interface EngineResult {
  text: string;
  segments: TranscriptSegment[];
  /** Detected or requested language, ISO code. */
  language: string | null;
}

export interface TranscribeOptions {
  /** 'auto' or an ISO-639-1 code. */
  language: string;
  /** 0..1, or -1 when the engine can't report progress. */
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

export interface TranscriptionEngine {
  id: EngineId;
  transcribeFile(uri: string, o: TranscribeOptions): Promise<EngineResult | null>;
  release(): Promise<void>;
}

/** The model couldn't be loaded on this device (missing file, out of memory). */
export class EngineLoadError extends Error {
  constructor(
    public engine: EngineId,
    cause: unknown
  ) {
    super(`Failed to load ${engine}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export class AbortedError extends Error {
  constructor() {
    super('Transcription cancelled');
  }
}
