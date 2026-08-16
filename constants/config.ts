/**
 * App configuration constants
 */

import { AudioConfig } from '../types';

// Audio recording configuration used to set up the streaming recorder
export const AUDIO_CONFIG: AudioConfig = {
  sampleRate: 16000, // Whisper expects 16kHz
  numberOfChannels: 1, // Mono audio
};

// Storage keys for AsyncStorage
export const STORAGE_KEYS = {
  TRANSCRIPTIONS: 'transcriptions',
} as const;

// Notes list limits
export const UI_CONFIG = {
  MAX_HISTORY_ITEMS: 1000,
  // Audio is now streamed to disk as it arrives (see services/wavEncoder),
  // so stopping is a 44-byte header patch rather than a full synchronous
  // encode — length is bounded by disk space, not the JS heap. This cap is
  // now just a runaway guard for a recording left running by accident.
  MAX_RECORDING_DURATION_SECONDS: 3600,
} as const;

// User-facing error messages for failure paths that are actually wired up
export const ERROR_MESSAGES = {
  MICROPHONE_PERMISSION_DENIED:
    'Microphone permission is required to record audio. Please enable it in Settings.',
  RECORDING_FAILED: 'Failed to start recording. Please try again.',
} as const;

// Export formats supported by storageService.exportNote
export const EXPORT_FORMATS = {
  TXT: 'txt',
  JSON: 'json',
  SRT: 'srt',
} as const;
