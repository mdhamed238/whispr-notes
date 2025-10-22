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

// Enhanced TranscriptionItem with additional fields for improved functionality
export interface EnhancedTranscriptionItem extends TranscriptionItem {
  tags: string[];
  category: TranscriptionCategory;
  editHistory: EditHistoryItem[];
  audioQuality: AudioQualityMetrics;
  processingTime: number;
  wordTimestamps: WordTimestamp[];
  speakerSegments: SpeakerSegment[];
  customMetadata: Record<string, any>;
  exportHistory: ExportHistoryItem[];
  searchableText: string; // Processed text for search optimization
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
  format: 'txt' | 'json' | 'srt' | 'vtt' | 'docx' | 'pdf';
  includeMetadata: boolean;
  includeTimestamps: boolean;
  template?: ExportTemplate;
  destination?: ExportDestination;
  batchMode?: boolean;
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

// Enhanced types for new functionality

// Audio Visualizer Component Props
export interface AudioVisualizerProps {
  audioData: Float32Array;
  isRecording: boolean;
  sensitivity: number;
  theme: 'light' | 'dark' | 'auto';
  showLevels: boolean;
  height?: number;
  width?: number;
}

// Enhanced Recording Controls Props
export interface RecordingControlsProps {
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSave: () => void;
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  quality: AudioQualityMetrics;
}

// Search and Filter Props
export interface SearchFilterProps {
  onSearch: (query: string) => void;
  onFilter: (filters: FilterOptions) => void;
  onSort: (sortBy: SortOption) => void;
  totalResults: number;
  isLoading: boolean;
}

// Transcription Editor Props
export interface TranscriptionEditorProps {
  transcription: string;
  confidence: number[];
  timestamps: WordTimestamp[];
  onEdit: (text: string) => void;
  readOnly: boolean;
  showConfidence: boolean;
  showTimestamps: boolean;
}

// Performance Metrics
export interface PerformanceMetrics {
  appStartTime: number;
  modelLoadTime: number;
  transcriptionSpeed: number; // words per second
  memoryUsage: MemoryUsage;
  batteryImpact: BatteryMetrics;
  errorRate: number;
  userSatisfactionScore?: number;
}

export interface MemoryUsage {
  current: number;
  peak: number;
  average: number;
  threshold: number;
}

export interface BatteryMetrics {
  estimatedImpact: number; // percentage per hour
  optimizationLevel: 'low' | 'medium' | 'high';
}

// Enhanced App Settings
export interface EnhancedAppSettings extends AppSettings {
  // Audio Settings
  audioQuality: AudioQualityPreset;
  noiseReduction: boolean;
  autoGainControl: boolean;
  echoCancellation: boolean;
  
  // Transcription Settings
  language: string;
  confidenceThreshold: number;
  realTimeTranscription: boolean;
  speakerDetection: boolean;
  
  // UI Settings
  theme: ThemeOption;
  fontSize: FontSizeOption;
  animations: boolean;
  
  // Performance Settings
  maxCacheSize: number;
  backgroundProcessing: boolean;
  lowPowerMode: boolean;
  
  // Export Settings
  defaultExportFormat: ExportFormat;
  autoExportLocation: string;
  includeMetadataByDefault: boolean;
}

// Supporting Types
export type TranscriptionCategory = 'meeting' | 'lecture' | 'interview' | 'memo' | 'other' | string;
export type AudioQualityPreset = 'low' | 'medium' | 'high' | 'custom';
export type ThemeOption = 'light' | 'dark' | 'auto';
export type FontSizeOption = 'small' | 'medium' | 'large' | 'extra-large';
export type ExportFormat = 'txt' | 'json' | 'srt' | 'vtt' | 'docx' | 'pdf';
export type ExportDestination = 'local' | 'share' | 'cloud';
export type SortOption = 'date' | 'duration' | 'relevance' | 'alphabetical';

export interface EditHistoryItem {
  id: string;
  timestamp: Date;
  originalText: string;
  editedText: string;
  editType: 'manual' | 'correction' | 'enhancement';
}

export interface AudioQualityMetrics {
  signalToNoiseRatio: number;
  clarity: number;
  volume: number;
  backgroundNoise: number;
  overallScore: number;
}

export interface WordTimestamp {
  word: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

export interface SpeakerSegment {
  speakerId: string;
  startTime: number;
  endTime: number;
  text: string;
  confidence: number;
}

export interface ExportHistoryItem {
  id: string;
  format: ExportFormat;
  timestamp: Date;
  destination: ExportDestination;
  success: boolean;
}

export interface ExportTemplate {
  id: string;
  name: string;
  format: ExportFormat;
  template: string;
  variables: Record<string, string>;
}

export interface FilterOptions {
  dateRange?: {
    start: Date;
    end: Date;
  };
  durationRange?: {
    min: number;
    max: number;
  };
  categories?: TranscriptionCategory[];
  tags?: string[];
  confidenceThreshold?: number;
}

// Context Types for State Management
export interface AppContextType {
  settings: EnhancedAppSettings;
  updateSettings: (settings: Partial<EnhancedAppSettings>) => void;
  performance: PerformanceMetrics;
  isLoading: boolean;
  error: string | null;
}

export interface SettingsContextType {
  settings: EnhancedAppSettings;
  updateSetting: <K extends keyof EnhancedAppSettings>(key: K, value: EnhancedAppSettings[K]) => void;
  resetSettings: () => void;
  exportSettings: () => string;
  importSettings: (settingsJson: string) => void;
}

export interface PerformanceContextType {
  metrics: PerformanceMetrics;
  startMeasurement: (operation: string) => string;
  endMeasurement: (measurementId: string) => void;
  reportError: (error: Error, context?: string) => void;
}

// Enhanced Service Interfaces
export interface EnhancedAudioServiceInterface extends AudioServiceInterface {
  pauseRecording(): Promise<void>;
  resumeRecording(): Promise<void>;
  getAudioLevels(): Promise<number>;
  applyNoiseReduction(audioUri: string): Promise<string>;
  validateAudioQuality(audioUri: string): Promise<AudioQualityMetrics>;
  setAudioQualityPreset(preset: AudioQualityPreset): void;
}

export interface SearchServiceInterface {
  indexTranscription(transcription: EnhancedTranscriptionItem): Promise<void>;
  search(query: string, filters?: FilterOptions): Promise<EnhancedTranscriptionItem[]>;
  updateIndex(): Promise<void>;
  clearIndex(): Promise<void>;
}

export interface SettingsServiceInterface {
  getSettings(): Promise<EnhancedAppSettings>;
  updateSettings(settings: Partial<EnhancedAppSettings>): Promise<void>;
  resetToDefaults(): Promise<void>;
  exportSettings(): Promise<string>;
  importSettings(settingsJson: string): Promise<void>;
}

export interface PerformanceServiceInterface {
  startMeasurement(operation: string): string;
  endMeasurement(measurementId: string): number;
  getMetrics(): PerformanceMetrics;
  reportError(error: Error, context?: string): void;
  optimizeMemory(): Promise<void>;
}
