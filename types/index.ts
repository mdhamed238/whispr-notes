/**
 * Type definitions for the Audio Transcription App
 * Defines interfaces for transcription items, audio configuration, and app settings
 */

export interface TranscriptionItem {
  id: string;
  audioUri: string;
  transcription: string;
  duration: number; // in seconds
  createdAt: Date;
  isProcessing: boolean;
  confidence?: number; // Optional confidence score from model
}

export interface AudioConfig {
  sampleRate: 16000; // Whisper expects 16kHz
  numberOfChannels: 1; // Mono audio
  bitDepthHint: 16;
  extension: '.wav';
  outputFormat: 'wav';
  bitRate: 128000;
}

export interface AppSettings {
  maxRecordingDuration: number; // in seconds, default 300 (5 minutes)
  autoSaveTranscriptions: boolean;
  modelVersion: string;
  modelDownloaded: boolean;
  hapticFeedback: boolean;
}

export interface ModelInfo {
  name: string;
  version: string;
  size: number; // in bytes
  path: string;
  isDownloaded: boolean;
  downloadProgress?: number; // 0-100
}

export interface TranscriptionProgress {
  stage: 'preprocessing' | 'loading_model' | 'inference' | 'decoding';
  progress: number; // 0-100
  message: string;
}

export interface AudioRecordingState {
  isRecording: boolean;
  isPlaying: boolean;
  duration: number; // current recording/playback duration
  uri: string | null;
  status: 'idle' | 'recording' | 'stopped' | 'playing' | 'paused';
}

export interface ExportOptions {
  format: 'txt' | 'json' | 'srt';
  includeMetadata: boolean;
  includeTimestamps: boolean;
}

export interface StorageInfo {
  totalTranscriptions: number;
  usedSpace: number; // in bytes
  availableSpace: number; // in bytes
  lastCleanup?: Date;
}

// Error types for better error handling
export interface TranscriptionError {
  code: 'MODEL_NOT_FOUND' | 'AUDIO_FORMAT_ERROR' | 'MEMORY_ERROR' | 'INFERENCE_ERROR' | 'PERMISSION_ERROR';
  message: string;
  details?: any;
}

export interface AudioError {
  code: 'PERMISSION_DENIED' | 'RECORDING_FAILED' | 'PLAYBACK_FAILED' | 'FORMAT_ERROR';
  message: string;
  details?: any;
}

// Service interfaces for dependency injection and testing
export interface AudioServiceInterface {
  requestPermissions(): Promise<boolean>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<string | null>;
  playAudio(uri: string): Promise<void>;
  pauseAudio(): Promise<void>;
  stopAudio(): Promise<void>;
  getAudioDuration(uri: string): Promise<number>;
  preprocessAudioForWhisper(audioUri: string): Promise<Float32Array>;
}

export interface TranscriptionServiceInterface {
  initialize(): Promise<void>;
  transcribe(audioUri: string): Promise<string>;
  cancel(): Promise<void>;
  isModelLoaded(): boolean;
  getModelInfo(): ModelInfo | null;
}

export interface StorageServiceInterface {
  saveTranscription(item: TranscriptionItem): Promise<void>;
  getTranscriptions(): Promise<TranscriptionItem[]>;
  updateTranscription(id: string, updates: Partial<TranscriptionItem>): Promise<void>;
  deleteTranscription(id: string): Promise<void>;
  exportTranscription(id: string, options: ExportOptions): Promise<string>;
  getStorageInfo(): Promise<StorageInfo>;
  clearAllData(): Promise<void>;
}

export interface ModelManagerInterface {
  downloadModel(onProgress?: (progress: number) => void): Promise<void>;
  isModelAvailable(): Promise<boolean>;
  loadModel(): Promise<void>;
  getModelInfo(): Promise<ModelInfo>;
  deleteModel(): Promise<void>;
  getModelSize(): Promise<number>;
}

// Constants for the app
export const AUDIO_CONFIG: AudioConfig = {
  sampleRate: 16000,
  numberOfChannels: 1,
  bitDepthHint: 16,
  extension: '.wav',
  outputFormat: 'wav',
  bitRate: 128000,
};

export const DEFAULT_SETTINGS: AppSettings = {
  maxRecordingDuration: 300, // 5 minutes
  autoSaveTranscriptions: true,
  modelVersion: 'whisper-tiny-v1',
  modelDownloaded: false,
  hapticFeedback: true,
};

export const STORAGE_KEYS = {
  TRANSCRIPTIONS: 'transcriptions',
  SETTINGS: 'app_settings',
  MODEL_DOWNLOADED: 'model_downloaded',
  FIRST_LAUNCH: 'first_launch',
} as const;

export const MODEL_CONFIG = {
  NAME: 'whisper-tiny',
  VERSION: 'v1',
  SIZE_MB: 40,
  URL: 'https://huggingface.co/openai/whisper-tiny/resolve/main/pytorch_model.bin',
  LOCAL_PATH: 'models/whisper-tiny.ptl',
} as const;
