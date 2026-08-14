/**
 * Storage Service
 * Handles local storage of notes using AsyncStorage.
 * Provides CRUD operations and export functionality.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { EXPORT_FORMATS, STORAGE_KEYS, UI_CONFIG } from '../constants/config';
import { ExportOptions, Note, StorageServiceInterface } from '../types';

function formatSrtTimestamp(totalSeconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},000`;
}

class StorageService implements StorageServiceInterface {
  async saveNote(note: Note): Promise<void> {
    try {
      const existingNotes = await this.getNotes();
      const updatedNotes = [note, ...existingNotes];

      if (updatedNotes.length > UI_CONFIG.MAX_HISTORY_ITEMS) {
        updatedNotes.splice(UI_CONFIG.MAX_HISTORY_ITEMS);
      }

      await AsyncStorage.setItem(STORAGE_KEYS.TRANSCRIPTIONS, JSON.stringify(updatedNotes));
    } catch (error) {
      console.error('Failed to save note:', error);
      throw new Error('Failed to save note');
    }
  }

  async getNotes(): Promise<Note[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.TRANSCRIPTIONS);

      if (!data) {
        return [];
      }

      const rawNotes = JSON.parse(data);

      if (!Array.isArray(rawNotes)) {
        return [];
      }

      return rawNotes.map((item: any) => this.normalizeNote(item));
    } catch (error) {
      console.error('Failed to get notes:', error);
      return [];
    }
  }

  /**
   * Fills in defaults for notes saved under the old TranscriptionItem shape
   * (no title/tags/pinned/updatedAt, fake 'streaming_recording' audioUri).
   */
  private normalizeNote(item: any): Note {
    const parsedCreatedAt = new Date(item.createdAt);
    // Bug fix: a missing/malformed createdAt in legacy data produced an
    // Invalid Date here, which then serialized to `null` on the next write,
    // silently corrupting the note's date going forward.
    const createdAt = Number.isNaN(parsedCreatedAt.getTime()) ? new Date() : parsedCreatedAt;
    return {
      id: item.id,
      title: item.title ?? (item.transcription ? String(item.transcription).slice(0, 40) : 'Untitled note'),
      transcription: item.transcription ?? '',
      audioUri: item.audioUri && item.audioUri !== 'streaming_recording' ? item.audioUri : null,
      duration: item.duration ?? 0,
      tags: Array.isArray(item.tags) ? item.tags : [],
      pinned: item.pinned ?? false,
      createdAt,
      updatedAt: item.updatedAt ? new Date(item.updatedAt) : createdAt,
    };
  }

  async updateNote(id: string, updates: Partial<Note>): Promise<void> {
    try {
      const notes = await this.getNotes();
      const index = notes.findIndex((note) => note.id === id);

      if (index === -1) {
        throw new Error('Note not found');
      }

      notes[index] = {
        ...notes[index],
        ...updates,
        id: notes[index].id,
        createdAt: notes[index].createdAt,
        updatedAt: new Date(),
      };

      await AsyncStorage.setItem(STORAGE_KEYS.TRANSCRIPTIONS, JSON.stringify(notes));
    } catch (error) {
      console.error('Failed to update note:', error);
      throw new Error('Failed to update note');
    }
  }

  async deleteNote(id: string): Promise<void> {
    try {
      const notes = await this.getNotes();
      const note = notes.find((n) => n.id === id);
      const remaining = notes.filter((n) => n.id !== id);

      if (remaining.length === notes.length) {
        throw new Error('Note not found');
      }

      await AsyncStorage.setItem(STORAGE_KEYS.TRANSCRIPTIONS, JSON.stringify(remaining));

      if (note?.audioUri) {
        try {
          const fileInfo = await FileSystem.getInfoAsync(note.audioUri);
          if (fileInfo.exists) {
            await FileSystem.deleteAsync(note.audioUri);
          }
        } catch (fileError) {
          console.warn('Failed to delete audio file:', fileError);
        }
      }
    } catch (error) {
      console.error('Failed to delete note:', error);
      throw new Error('Failed to delete note');
    }
  }

  async exportNote(id: string, options: ExportOptions): Promise<string> {
    try {
      const notes = await this.getNotes();
      const note = notes.find((n) => n.id === id);

      if (!note) {
        throw new Error('Note not found');
      }

      let content = '';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `note-${timestamp}`;

      switch (options.format) {
        case EXPORT_FORMATS.TXT:
          content = this.generateTextExport(note, options);
          break;
        case EXPORT_FORMATS.JSON:
          content = this.generateJsonExport(note, options);
          break;
        case EXPORT_FORMATS.SRT:
          content = this.generateSrtExport(note);
          break;
        default:
          throw new Error('Unsupported export format');
      }

      const exportDir = `${FileSystem.documentDirectory}exports/`;
      const dirInfo = await FileSystem.getInfoAsync(exportDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(exportDir, { intermediates: true });
      }

      const fileUri = `${exportDir}${fileName}.${options.format}`;
      await FileSystem.writeAsStringAsync(fileUri, content);

      return fileUri;
    } catch (error) {
      console.error('Failed to export note:', error);
      throw new Error('Failed to export note');
    }
  }

  async shareExportedFile(fileUri: string): Promise<void> {
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        throw new Error('Sharing is not available on this device');
      }
      await Sharing.shareAsync(fileUri);
    } catch (error) {
      console.error('Failed to share file:', error);
      throw new Error('Failed to share file');
    }
  }

  private generateTextExport(note: Note, options: ExportOptions): string {
    let content = note.transcription;

    if (options.includeMetadata) {
      const metadata = [
        `Title: ${note.title}`,
        `Created: ${note.createdAt.toLocaleString()}`,
        `Duration: ${note.duration}s`,
        note.tags.length > 0 ? `Tags: ${note.tags.join(', ')}` : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n');
      content = `${metadata}\n\n${content}`;
    }

    return content;
  }

  private generateJsonExport(note: Note, options: ExportOptions): string {
    const exportData: any = {
      title: note.title,
      transcription: note.transcription,
      duration: note.duration,
      createdAt: note.createdAt.toISOString(),
    };

    if (options.includeMetadata) {
      exportData.id = note.id;
      exportData.tags = note.tags;
      exportData.pinned = note.pinned;
    }

    return JSON.stringify(exportData, null, 2);
  }

  private generateSrtExport(note: Note): string {
    // Bug fix: the old version did `duration.toString().padStart(2, '0')`
    // straight into the seconds field with no minutes/hours math, producing
    // invalid timestamps like "00:00:125,000" for anything over 59s.
    const startTime = '00:00:00,000';
    const endTime = formatSrtTimestamp(note.duration);
    return `1\n${startTime} --> ${endTime}\n${note.transcription}\n\n`;
  }
}

export const storageService = new StorageService();
export default storageService;
