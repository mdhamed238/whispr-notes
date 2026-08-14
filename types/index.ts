/**
 * Type definitions for the Audio Transcription App
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

export interface StorageInfo {
  totalTranscriptions: number;
  usedSpace: number; // bytes
  availableSpace: number; // bytes
  lastCleanup?: Date;
}

export interface StorageServiceInterface {
  saveNote(note: Note): Promise<void>;
  getNotes(): Promise<Note[]>;
  updateNote(id: string, updates: Partial<Note>): Promise<void>;
  deleteNote(id: string): Promise<void>;
  exportNote(id: string, options: ExportOptions): Promise<string>;
  shareExportedFile(fileUri: string): Promise<void>;
  getStorageInfo(): Promise<StorageInfo>;
  clearAllData(): Promise<void>;
}
