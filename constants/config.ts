/**
 * App configuration constants
 */

import { AudioConfig } from '../types';

// Audio recording configuration used to set up the streaming recorder
export const AUDIO_CONFIG: AudioConfig = {
  sampleRate: 16000, // Whisper expects 16kHz
  numberOfChannels: 1, // Mono audio
};

// Length of each captured audio buffer, in seconds. This is how often audio
// crosses the JS bridge — it is NOT how often the model runs; that is
// STREAMING_CONFIG.INFERENCE_TIMEOUT_MS below.
//
// Lives here rather than on the record screen because the harness
// (services/transcriptionHarness) replays fixture audio at this same chunk
// size and cadence: feeding the model in different-sized pieces than the
// microphone does would not exercise the same streaming path.
export const CAPTURE_BUFFER_SECONDS = 0.1;

// Streaming transcription tuning.
//
// `timeout` is how long the library waits between consecutive model
// inferences (its own default is 100ms). It is the CPU/battery knob — NOT
// the capture buffer above, which only controls how often audio crosses the
// JS bridge. Raising it reduces inference frequency at the cost of how
// quickly interim text appears.
//
// `vadDetectionMargin` is how much silence must follow speech before the
// VAD commits a segment (library default 500ms). It trades commit latency,
// not CPU, so leave it fixed while profiling `timeout`.
export const STREAMING_CONFIG = {
  INFERENCE_TIMEOUT_MS: 100,
  VAD_DETECTION_MARGIN_MS: 300,
} as const;

// Notes list limits
export const UI_CONFIG = {
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

// Public contact for support, privacy and legal requests.
export const CONTACT_EMAIL = 'mdhamed.off@gmail.com';

// Public website (privacy policy, terms, support). Update when a custom
// domain replaces the Vercel URL.
export const WEBSITE_URL = 'https://whisprnotes-rho.vercel.app';
