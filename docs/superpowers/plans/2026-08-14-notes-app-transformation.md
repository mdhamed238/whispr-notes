# Notes App Transformation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Purge ~9,000 lines of dead code, fix the real bugs in the Record/History flow, and evolve "History" into an editable, taggable, pinnable "Notes" feature with real audio playback and a themed UI.

**Architecture:** In-place extension of the existing two-screen Expo Router app — no new dependencies, no database. `AsyncStorage`-as-JSON-array remains the store; the `TranscriptionItem` shape becomes `Note` (title, tags, pinned, real audioUri/duration). A third screen (`app/note/[id].tsx`) is added as a modal for viewing/editing a single note.

**Tech Stack:** Expo SDK 54, React Native 0.81, expo-router, `react-native-audio-api` (recording, now with `enableFileOutput`), `react-native-executorch` (Whisper Tiny EN streaming STT, unchanged), `expo-audio` (new: playback), AsyncStorage.

**Spec:** `docs/superpowers/specs/2026-08-14-notes-app-transformation-design.md`

## Global Constraints

- No new external dependencies. `expo-audio` is already installed and becomes used (playback); `expo-av` is already installed and unused — it gets removed.
- No database/SQLite. No fixed `category` enum — freeform `tags: string[]` only. No test framework added.
- `AudioRecorder.enableFileOutput({ format: FileFormat.M4A, preset: FilePreset.High })` (called once, before `start()`) records a real audio file in parallel with the streamed buffers. `recorder.stop()` resolves to `{ status: 'success', paths, duration, size } | { status: 'error', message }`. `recorder.start()` resolves to `{ status: 'error', message } | ...`. `AudioManager.requestRecordingPermissions()` resolves to the string `'Granted'` on success, something else on denial. All four of these return values are currently ignored in the live code — every task that touches `index.tsx` must check them.
- `expo-audio`: `useAudioPlayer(uri)` returns a player; `useAudioPlayerStatus(player)` returns `{ playing, currentTime, duration, ... }`. Both come from `import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'`.
- **No Jest/RNTL is configured in this repo, and none is added.** Every task's verification step is `npx tsc --noEmit` (must report no errors touching the files that task changed) plus, for deletion tasks, a `grep` sweep confirming zero remaining references. The final task adds a manual on-device smoke-test checklist — this plan cannot be executed end-to-end in a sandboxed environment (no physical device, no simulator support per the README).
- `node_modules/` is not present in this environment. Before Task 1's verification step can run, install dependencies once: `npm install` from the repo root.
- Text/icons painted on top of a solid accent-colored button (e.g. white icon on a green Save button) use literal `'#ffffff'`, not a theme token — that's a fixed contrast requirement, not a themed surface. Every other color in touched screens must come from `Colors[colorScheme]` or `constants/Spacing.ts`, never a hardcoded hex.

---

### Task 1: Remove the dead "enhanced" tree, orphaned contexts/hooks/utils, and dead services

**Files:**
- Delete: `components/enhanced/` (entire directory: AudioVisualizer.tsx, BatchOperationsModal.tsx, ExportModal.tsx, OptimizedRecordingScreen.tsx, RecordingControls.tsx, SearchAndFilter.tsx, TagManager.tsx, TranscriptionDetailScreen.tsx, TranscriptionEditor.tsx, TranscriptionListItem.tsx, VirtualizedTranscriptionList.tsx)
- Delete: `services/enhanced/` (entire directory: audioService.ts, cacheService.ts, cloudService.ts, exportService.ts, memoryService.ts, paginationService.ts, searchService.ts, templateService.ts)
- Delete: `services/modelManager.ts`
- Delete: `services/streamingTranscriptionService.ts`
- Delete: `contexts/` (entire directory: AppContext.tsx, SettingsContext.tsx, PerformanceContext.tsx)
- Delete: `hooks/` (entire directory: useOptimizedCallback.ts, usePerformanceOptimization.ts)
- Delete: `utils/` (entire directory: performance/memoryUtils.ts, performance/performanceUtils.ts)
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing (this is pure deletion of code with zero live references, confirmed by grep during design)
- Produces: nothing new — later tasks must not import any of the paths deleted here

- [ ] **Step 0: Install dependencies (one-time, only if `node_modules/` doesn't exist)**

```bash
test -d node_modules || npm install
```

- [ ] **Step 1: Confirm nothing outside the dead cluster references it**

```bash
grep -rln \
  -e "components/enhanced" -e "services/enhanced" \
  -e "contexts/AppContext" -e "contexts/SettingsContext" -e "contexts/PerformanceContext" \
  -e "hooks/useOptimizedCallback" -e "hooks/usePerformanceOptimization" \
  -e "utils/performance" -e "services/modelManager" -e "services/streamingTranscriptionService" \
  --include="*.ts" --include="*.tsx" . \
  | grep -v -E "^\./(components/enhanced|services/enhanced|contexts|hooks|utils)/"
```

Expected: empty output. If anything prints, stop and investigate before deleting — do not delete a file something still imports.

- [ ] **Step 2: Delete the directories**

```bash
rm -rf components/enhanced services/enhanced contexts hooks utils \
  services/modelManager.ts services/streamingTranscriptionService.ts
```

- [ ] **Step 3: Fix `package.json`**

Remove the `"expo-av": "~16.0.7",` line from `dependencies`, and change the `"name"` field from `"audio-transcription-app-temp"` to `"audio-transcription-app"`.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
```

Expected: no errors referencing any deleted path. (Unrelated pre-existing errors, if any, are out of scope for this task — note them but don't fix here.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove dead enhanced/ tree, orphaned contexts/hooks/utils, unused expo-av dep"
```

---

### Task 2: Remove stock Expo template leftovers

The default Expo tab-starter template ships a demo modal screen and its supporting components (`Themed`, `StyledText`, `EditScreenInfo`, `ExternalLink`). None of it is used by the real Record/History screens — only by each other and by the demo `app/modal.tsx` route, which nothing in the app links to.

**Files:**
- Delete: `app/modal.tsx`
- Delete: `components/EditScreenInfo.tsx`
- Delete: `components/StyledText.tsx`
- Delete: `components/__tests__/StyledText-test.js` (and the now-empty `components/__tests__/` directory)
- Delete: `components/ExternalLink.tsx`
- Delete: `components/Themed.tsx`
- Modify: `app/+not-found.tsx` (drop its `Themed` import — it's a real expo-router route, not dead, so it needs a plain-RN rewrite instead of deletion)
- Modify: `app/_layout.tsx` (remove the `modal` route registration)

**Interfaces:**
- Consumes: `Colors` (default export from `constants/Colors.ts`, unchanged shape at this point in the plan — Task 6 expands it later, but `text`/`background`/`tint` already exist today), `useColorScheme` (`components/useColorScheme.ts`, re-exports RN's hook, returns `'light' | 'dark' | null | undefined`)
- Produces: nothing new

- [ ] **Step 1: Delete the files**

```bash
rm -rf app/modal.tsx components/EditScreenInfo.tsx components/StyledText.tsx \
  components/__tests__ components/ExternalLink.tsx components/Themed.tsx
```

- [ ] **Step 2: Rewrite `app/+not-found.tsx`**

Replace the full file contents with:

```tsx
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function NotFoundScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>This screen doesn't exist.</Text>

        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: colors.tint }]}>Go to home screen!</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
  },
});
```

- [ ] **Step 3: Remove the `modal` route from `app/_layout.tsx`**

In the `RootLayoutNav` function, delete this line from inside `<Stack>`:

```tsx
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
```

(Task 9 adds a replacement `<Stack.Screen name="note/[id]" .../>` entry here later — leave the `<Stack>` with just the `(tabs)` screen for now.)

- [ ] **Step 4: Verify**

```bash
grep -rln "components/Themed\|EditScreenInfo\|StyledText\|ExternalLink" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules
npx tsc --noEmit
```

Expected: grep returns nothing; tsc reports no new errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove unused Expo template demo screen and Themed component cluster"
```

---

### Task 3: Trim `types/index.ts` to the live `Note`-based type set

**Files:**
- Modify: `types/index.ts` (full rewrite)

**Interfaces:**
- Consumes: nothing
- Produces: `Note`, `AudioConfig`, `ExportOptions`, `StorageInfo`, `StorageServiceInterface` — these exact names/shapes are what Tasks 5, 7, 8, 9 import from `@/types` / `../types`.

- [ ] **Step 1: Replace the full contents of `types/index.ts`**

```ts
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
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: new errors in `services/storageService.ts`, `app/(tabs)/index.tsx`, `app/(tabs)/two.tsx` — they still reference the old `TranscriptionItem`/`STORAGE_KEYS` exports removed here. That's expected; Tasks 4, 5, 7, 8 fix each of those files. Confirm the errors are *only* in those three files (plus their downstream imports) and nothing else.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "refactor: replace TranscriptionItem types with the Note-based type set"
```

---

### Task 4: Trim `constants/config.ts` to the live constant set

**Files:**
- Modify: `constants/config.ts` (full rewrite)

**Interfaces:**
- Consumes: `AudioConfig` from `../types` (Task 3)
- Produces: `AUDIO_CONFIG`, `STORAGE_KEYS` (`{ TRANSCRIPTIONS, LAST_CLEANUP }`), `UI_CONFIG` (`{ MAX_HISTORY_ITEMS }`), `ERROR_MESSAGES` (`{ MICROPHONE_PERMISSION_DENIED, RECORDING_FAILED }`), `EXPORT_FORMATS` (`{ TXT, JSON, SRT }`) — these exact names are what Tasks 5 and 7 import.

- [ ] **Step 1: Replace the full contents of `constants/config.ts`**

```ts
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
  LAST_CLEANUP: 'last_cleanup',
} as const;

// Notes list limits
export const UI_CONFIG = {
  MAX_HISTORY_ITEMS: 1000,
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
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: same set of errors as after Task 3 (still `storageService.ts`/`index.tsx`/`two.tsx`, now also missing the trimmed constants) — no *new* files affected.

- [ ] **Step 3: Commit**

```bash
git add constants/config.ts
git commit -m "refactor: trim constants/config.ts to the constants the live app actually uses"
```

---

### Task 5: Rewrite `storageService.ts` around the `Note` model, fix the storage bugs

**Files:**
- Modify: `services/storageService.ts` (full rewrite)

**Interfaces:**
- Consumes: `Note`, `ExportOptions`, `StorageInfo`, `StorageServiceInterface` (Task 3); `EXPORT_FORMATS`, `STORAGE_KEYS`, `UI_CONFIG` (Task 4)
- Produces: `storageService` singleton (default export + named export) with methods `saveNote`, `getNotes`, `updateNote`, `deleteNote`, `exportNote`, `shareExportedFile`, `getStorageInfo`, `clearAllData` — these exact method names are what Tasks 7, 8, 9 call.

- [ ] **Step 1: Replace the full contents of `services/storageService.ts`**

```ts
/**
 * Storage Service
 * Handles local storage of notes using AsyncStorage.
 * Provides CRUD operations and export functionality.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { EXPORT_FORMATS, STORAGE_KEYS, UI_CONFIG } from '../constants/config';
import { ExportOptions, Note, StorageInfo, StorageServiceInterface } from '../types';

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
    const createdAt = new Date(item.createdAt);
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

  async getStorageInfo(): Promise<StorageInfo> {
    try {
      const notes = await this.getNotes();
      let usedSpace = 0;

      for (const note of notes) {
        if (note.audioUri) {
          try {
            const fileInfo = await FileSystem.getInfoAsync(note.audioUri);
            if (fileInfo.exists && 'size' in fileInfo && fileInfo.size) {
              usedSpace += fileInfo.size;
            }
          } catch (error) {
            console.warn('Failed to get file size for:', note.audioUri);
          }
        }
      }

      const documentDirInfo = await FileSystem.getInfoAsync(FileSystem.documentDirectory!);
      const availableSpace = ('size' in documentDirInfo ? documentDirInfo.size : 0) || 0;

      return {
        totalTranscriptions: notes.length,
        usedSpace,
        availableSpace: availableSpace - usedSpace,
        lastCleanup: await this.getLastCleanupDate(),
      };
    } catch (error) {
      console.error('Failed to get storage info:', error);
      return {
        totalTranscriptions: 0,
        usedSpace: 0,
        availableSpace: 0,
      };
    }
  }

  async clearAllData(): Promise<void> {
    try {
      const notes = await this.getNotes();

      for (const note of notes) {
        if (note.audioUri) {
          try {
            const fileInfo = await FileSystem.getInfoAsync(note.audioUri);
            if (fileInfo.exists) {
              await FileSystem.deleteAsync(note.audioUri);
            }
          } catch (error) {
            console.warn('Failed to delete audio file:', error);
          }
        }
      }

      await AsyncStorage.removeItem(STORAGE_KEYS.TRANSCRIPTIONS);

      const exportDir = `${FileSystem.documentDirectory}exports/`;
      const dirInfo = await FileSystem.getInfoAsync(exportDir);
      if (dirInfo.exists) {
        await FileSystem.deleteAsync(exportDir);
      }

      // Bug fix: this used to write into STORAGE_KEYS.TRANSCRIPTIONS (a plain
      // object where the reader expects an array), corrupting the notes list.
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_CLEANUP, new Date().toISOString());
    } catch (error) {
      console.error('Failed to clear all data:', error);
      throw new Error('Failed to clear all data');
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

  private async getLastCleanupDate(): Promise<Date | undefined> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.LAST_CLEANUP);
      return data ? new Date(data) : undefined;
    } catch (error) {
      return undefined;
    }
  }
}

export const storageService = new StorageService();
export default storageService;
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: remaining errors now confined to `app/(tabs)/index.tsx` and `app/(tabs)/two.tsx` only (both still reference the old `TranscriptionItem`/`storageService.saveTranscription`/etc. API, fixed in Tasks 7 and 8).

- [ ] **Step 3: Commit**

```bash
git add services/storageService.ts
git commit -m "fix: rework storageService around Note model, fix clearAllData key bug and SRT timestamp formatting"
```

---

### Task 6: Expand the theme — `Colors.ts` tokens + new `Spacing.ts`

The app already wires `useColorScheme`/`ThemeProvider` into `app/_layout.tsx` and the tab bar, but the two real screens hardcode light-only hex colors and ignore it entirely. This task gives them a real token set to use; Tasks 7–9 consume it.

**Files:**
- Modify: `constants/Colors.ts` (full rewrite — expand from 5 keys to a full token set)
- Create: `constants/Spacing.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Colors` default export shaped `{ light: {...}, dark: {...} }` with keys `text, textMuted, background, surface, card, border, tint, tabIconDefault, tabIconSelected, danger, success`; `Spacing` (`xs=4, sm=8, md=12, lg=16, xl=24, xxl=32`) and `FontSize` (`sm=13, md=16, lg=20, xl=28`) named exports from `constants/Spacing.ts`. Tasks 7, 8, 9 both import `Colors` from `@/constants/Colors` and `{ Spacing, FontSize }` from `@/constants/Spacing`.

- [ ] **Step 1: Replace the full contents of `constants/Colors.ts`**

```ts
const tintColorLight = '#2f6fed';
const tintColorDark = '#5b8bff';

export default {
  light: {
    text: '#1a1a1a',
    textMuted: '#6b7280',
    background: '#ffffff',
    surface: '#f3f4f6',
    card: '#ffffff',
    border: '#e5e7eb',
    tint: tintColorLight,
    tabIconDefault: '#9aa0a6',
    tabIconSelected: tintColorLight,
    danger: '#dc2626',
    success: '#16a34a',
  },
  dark: {
    text: '#f2f2f2',
    textMuted: '#9aa0a6',
    background: '#0b0b0d',
    surface: '#18181b',
    card: '#1f1f23',
    border: '#2c2c31',
    tint: tintColorDark,
    tabIconDefault: '#6b7280',
    tabIconSelected: tintColorDark,
    danger: '#f87171',
    success: '#4ade80',
  },
};
```

- [ ] **Step 2: Create `constants/Spacing.ts`**

```ts
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const FontSize = {
  sm: 13,
  md: 16,
  lg: 20,
  xl: 28,
} as const;
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

Expected: same error set as after Task 5 (nothing consumes the new tokens yet, so nothing new breaks; `app/(tabs)/_layout.tsx` already used `Colors[colorScheme ?? 'light'].tint`, which still exists).

- [ ] **Step 4: Commit**

```bash
git add constants/Colors.ts constants/Spacing.ts
git commit -m "feat: expand theme tokens (Colors.ts) and add a shared Spacing/FontSize scale"
```

---

### Task 7: Rewrite the Record screen — real audio capture, fixed bugs, theming

Fixes: permission/start/stop results ignored, fake `audioUri`/`duration: 0`, Reset not clearing the transcript, hardcoded light-only colors. Adds: real audio file capture via `enableFileOutput`, auto-titled save, navigation to Notes on save.

**Files:**
- Modify: `app/(tabs)/index.tsx` (full rewrite)

**Interfaces:**
- Consumes: `AUDIO_CONFIG`, `ERROR_MESSAGES` (Task 4); `Colors` (Task 6); `Spacing`, `FontSize` (Task 6); `storageService.saveNote` (Task 5); `Note` (Task 3)
- Produces: nothing consumed by other tasks (leaf screen)

- [ ] **Step 1: Replace the full contents of `app/(tabs)/index.tsx`**

```tsx
/**
 * Record Screen
 * Streaming transcription via react-native-executorch, with a real audio
 * file captured alongside the stream (for playback from the Notes screens).
 */

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { AUDIO_CONFIG, ERROR_MESSAGES } from '@/constants/config';
import { FontSize, Spacing } from '@/constants/Spacing';
import storageService from '@/services/storageService';
import { Note } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AudioManager,
  AudioRecorder,
  FileFormat,
  FilePreset,
} from 'react-native-audio-api';
import { useSpeechToText, WHISPER_TINY_EN } from 'react-native-executorch';
import { SafeAreaView } from 'react-native-safe-area-context';

function buildAutoTitle(transcription: string): string {
  const trimmed = transcription.trim();
  if (trimmed.length > 0) {
    return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
  }
  return `Note — ${new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export default function RecordScreen() {
  // Bug fix: the old Reset button had no way to clear the model hook's
  // internal committedTranscription (no reset/clear API is exposed by
  // useSpeechToText). Remounting the whole session subtree on a fresh key
  // guarantees a clean AudioRecorder + model instance instead of relying on
  // undocumented internals — this also means each session gets its own
  // onAudioReady registration, so nothing accumulates across sessions.
  const [sessionId, setSessionId] = useState(0);
  return <RecordingSession key={sessionId} onSessionReset={() => setSessionId((n) => n + 1)} />;
}

function RecordingSession({ onSessionReset }: { onSessionReset: () => void }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = createStyles(colors);
  const router = useRouter();

  const [recorder] = useState(() => {
    const instance = new AudioRecorder({
      sampleRate: AUDIO_CONFIG.sampleRate,
      bufferLengthInSamples: AUDIO_CONFIG.sampleRate * 0.1,
    });
    instance.enableFileOutput({ format: FileFormat.M4A, preset: FilePreset.High });
    return instance;
  });

  const model = useSpeechToText({ model: WHISPER_TINY_EN });

  const [captured, setCaptured] = useState<{ audioUri: string | null; duration: number }>({
    audioUri: null,
    duration: 0,
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'spokenAudio',
      iosOptions: ['allowBluetooth', 'defaultToSpeaker'],
    });

    recorder.onAudioReady(async ({ buffer }) => {
      try {
        const bufferArray = Array.from(buffer.getChannelData(0));
        model.streamInsert(bufferArray);
      } catch (error) {
        console.error('Audio buffer processing error:', error);
      }
    });
    // Registered once per session (see the remount-key comment above), not
    // re-registered on every Start press.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartStreaming = async () => {
    try {
      // Bug fix: this result was previously ignored — a denied permission
      // failed silently instead of telling the user anything.
      const permission = await AudioManager.requestRecordingPermissions();
      if (permission !== 'Granted') {
        Alert.alert('Permission Required', ERROR_MESSAGES.MICROPHONE_PERMISSION_DENIED);
        return;
      }

      // Bug fix: this result was previously ignored too.
      const startResult = await recorder.start();
      if (startResult.status === 'error') {
        Alert.alert('Recording Error', ERROR_MESSAGES.RECORDING_FAILED);
        return;
      }

      try {
        await model.stream();
      } catch (error) {
        console.error('Transcription error:', error);
        handleStopStreaming();

        if (error instanceof Error && error.message?.includes('BLANK')) {
          Alert.alert('No Speech Detected', 'Please speak clearly into the microphone.');
        } else {
          Alert.alert('Transcription Error', 'Failed to transcribe audio. Please try again.');
        }
      }

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.error('Failed to start streaming:', error);
      Alert.alert('Error', ERROR_MESSAGES.RECORDING_FAILED);
    }
  };

  const handleStopStreaming = async () => {
    try {
      const stopResult = await recorder.stop();
      model.streamStop();

      // Bug fix: audioUri/duration used to be hardcoded ('streaming_recording'
      // and 0) on every save. Now they come from the real file the recorder
      // just wrote.
      if (stopResult.status === 'success') {
        setCaptured({ audioUri: stopResult.paths[0] ?? null, duration: stopResult.duration });
      } else {
        setCaptured({ audioUri: null, duration: 0 });
      }

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      console.error('Failed to stop streaming:', error);
    }
  };

  const handleSaveTranscription = async () => {
    if (!model.committedTranscription) {
      Alert.alert('No Transcription', 'Nothing to save. Try recording some speech first.');
      return;
    }

    setIsSaving(true);
    try {
      const now = new Date();
      const note: Note = {
        id: now.getTime().toString(),
        title: buildAutoTitle(model.committedTranscription),
        transcription: model.committedTranscription,
        audioUri: captured.audioUri,
        duration: captured.duration,
        tags: [],
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };

      await storageService.saveNote(note);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      onSessionReset();
      router.push('/notes');
    } catch (error) {
      console.error('Failed to save note:', error);
      Alert.alert('Error', 'Failed to save note');
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (model.isGenerating) {
      handleStopStreaming();
    }
    onSessionReset();
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Record</Text>
          <Text style={styles.subtitle}>
            {model.isReady
              ? 'Ready to transcribe'
              : model.downloadProgress > 0
                ? `Downloading model… ${Math.round(model.downloadProgress * 100)}%`
                : 'Loading AI model…'}
          </Text>
        </View>

        {!model.isReady ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading Whisper model…</Text>
            <Text style={styles.progressText}>{Math.round(model.downloadProgress * 100)}%</Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${model.downloadProgress * 100}%` }]} />
            </View>
          </View>
        ) : (
          <>
            <View style={styles.recordButtonContainer}>
              <TouchableOpacity
                style={[styles.recordButton, model.isGenerating && styles.recordButtonRecording]}
                onPress={model.isGenerating ? handleStopStreaming : handleStartStreaming}
                disabled={!model.isReady || isSaving}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={model.isGenerating ? 'stop' : 'mic'}
                  size={56}
                  color={model.isGenerating ? '#ffffff' : colors.danger}
                />
              </TouchableOpacity>
              <Text style={styles.recordButtonText}>
                {model.isGenerating ? 'Stop Recording' : 'Start Recording'}
              </Text>
            </View>

            <View style={styles.transcriptionContainer}>
              <Text style={styles.transcriptionLabel}>
                {model.isGenerating ? 'Listening…' : 'Transcription'}
              </Text>

              <ScrollView style={styles.transcriptionScroll}>
                {model.committedTranscription || model.nonCommittedTranscription ? (
                  <Text style={styles.transcriptionText}>
                    <Text style={styles.committedText}>{model.committedTranscription}</Text>
                    {model.nonCommittedTranscription && (
                      <Text style={styles.nonCommittedText}> {model.nonCommittedTranscription}</Text>
                    )}
                  </Text>
                ) : (
                  <Text style={styles.waitingText}>
                    {model.isGenerating ? 'Speak now…' : 'Tap the microphone to start recording'}
                  </Text>
                )}
              </ScrollView>

              {(model.committedTranscription || model.nonCommittedTranscription) && !model.isGenerating && (
                <View style={styles.actionButtons}>
                  <TouchableOpacity style={styles.saveButton} onPress={handleSaveTranscription} disabled={isSaving}>
                    <Ionicons name="save" size={20} color="#ffffff" />
                    <Text style={styles.saveButtonText}>{isSaving ? 'Saving…' : 'Save'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.resetButton} onPress={handleReset} disabled={isSaving}>
                    <Ionicons name="refresh" size={20} color={colors.textMuted} />
                    <Text style={styles.resetButtonText}>Reset</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xl },
    header: { alignItems: 'center', marginBottom: Spacing.xxl },
    title: { fontSize: FontSize.xl, fontWeight: 'bold', color: colors.text, marginBottom: Spacing.xs },
    subtitle: { fontSize: FontSize.md, color: colors.textMuted, textAlign: 'center' },
    loadingContainer: { alignItems: 'center', justifyContent: 'center', flex: 1 },
    loadingText: { fontSize: FontSize.lg, fontWeight: '600', color: colors.text, marginBottom: Spacing.lg },
    progressText: { fontSize: FontSize.xl, fontWeight: 'bold', color: colors.tint, marginBottom: Spacing.lg },
    progressBar: { width: '80%', height: 8, backgroundColor: colors.surface, borderRadius: 4 },
    progressFill: { height: '100%', backgroundColor: colors.tint, borderRadius: 4 },
    recordButtonContainer: { alignItems: 'center', marginBottom: Spacing.xxl },
    recordButton: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: colors.background,
      borderWidth: 4,
      borderColor: colors.danger,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      marginBottom: Spacing.md,
    },
    recordButtonRecording: { backgroundColor: colors.danger, borderColor: colors.danger },
    recordButtonText: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    transcriptionContainer: { backgroundColor: colors.surface, padding: Spacing.lg, borderRadius: 12, flex: 1 },
    transcriptionLabel: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.text,
      marginBottom: Spacing.md,
      textAlign: 'center',
    },
    transcriptionScroll: { flex: 1 },
    transcriptionText: { fontSize: FontSize.lg, lineHeight: 26 },
    committedText: { color: colors.text, fontWeight: '600' },
    nonCommittedText: { color: colors.textMuted, fontStyle: 'italic' },
    waitingText: { fontSize: FontSize.md, color: colors.textMuted, textAlign: 'center', fontStyle: 'italic' },
    actionButtons: { flexDirection: 'row', justifyContent: 'space-around', marginTop: Spacing.lg },
    saveButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.success,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      borderRadius: 8,
      flex: 1,
      marginRight: Spacing.sm,
    },
    saveButtonText: { color: '#ffffff', fontSize: FontSize.md, fontWeight: '600', marginLeft: Spacing.sm },
    resetButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      borderRadius: 8,
      flex: 1,
      marginLeft: Spacing.sm,
    },
    resetButtonText: { color: colors.textMuted, fontSize: FontSize.md, fontWeight: '600', marginLeft: Spacing.sm },
  });
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: remaining errors confined to `app/(tabs)/two.tsx` only (fixed in Task 8).

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "fix: real audio capture + duration on Record screen, permission/start/stop error handling, working Reset, theming"
```

---

### Task 8: Notes screen (rename History → Notes, add search/pin/tags), update tab layout

Fixes: notes list never refreshed when returning to the tab. Adds: search, pinned section, tag chips, per-card quick actions.

Note on the earlier UI discussion: swipe-to-delete was floated as a possibility, but implementing a real swipe gesture needs `react-native-gesture-handler`, which isn't currently an installed dependency and this plan adds none. Instead each card gets a small "•••" button that opens an action sheet (`Alert.alert` with multiple buttons) for Pin/Unpin, Export, Delete — zero new dependencies, and the destructive action still requires a deliberate second tap plus a confirm dialog, same as before.

**Files:**
- Delete: `app/(tabs)/two.tsx`
- Create: `app/(tabs)/notes.tsx`
- Modify: `app/(tabs)/_layout.tsx` (rename the `two` tab registration to `notes`, update title/icon)

**Interfaces:**
- Consumes: `Colors`, `Spacing`, `FontSize` (Task 6); `storageService.getNotes`/`updateNote`/`deleteNote`/`exportNote`/`shareExportedFile` (Task 5); `Note` (Task 3)
- Produces: nothing consumed by other tasks (leaf screen), except the route path `/notes` that Task 7 already navigates to and Task 9 navigates back to

- [ ] **Step 1: Delete the old screen**

```bash
rm "app/(tabs)/two.tsx"
```

- [ ] **Step 2: Create `app/(tabs)/notes.tsx`**

```tsx
/**
 * Notes Screen
 * Search, pinned section, and card list of saved notes.
 */

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import storageService from '@/services/storageService';
import { Note } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function NotesScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = createStyles(colors);
  const router = useRouter();

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const loadNotes = useCallback(async () => {
    try {
      setLoading(true);
      const items = await storageService.getNotes();
      setNotes(items);
    } catch (error) {
      console.error('Failed to load notes:', error);
      Alert.alert('Error', 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, []);

  // Bug fix: the old screen only loaded on mount, so a note saved from the
  // Record tab didn't show up here until the app restarted.
  useFocusEffect(
    useCallback(() => {
      loadNotes();
    }, [loadNotes])
  );

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(q) ||
        note.transcription.toLowerCase().includes(q) ||
        note.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [notes, query]);

  const pinnedNotes = useMemo(() => filteredNotes.filter((note) => note.pinned), [filteredNotes]);
  const otherNotes = useMemo(() => filteredNotes.filter((note) => !note.pinned), [filteredNotes]);

  const handleTogglePin = async (note: Note) => {
    try {
      await storageService.updateNote(note.id, { pinned: !note.pinned });
      loadNotes();
    } catch (error) {
      console.error('Failed to update note:', error);
      Alert.alert('Error', 'Failed to update note');
    }
  };

  const handleDelete = (note: Note) => {
    Alert.alert('Delete Note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await storageService.deleteNote(note.id);
            loadNotes();
          } catch (error) {
            console.error('Failed to delete note:', error);
            Alert.alert('Error', 'Failed to delete note');
          }
        },
      },
    ]);
  };

  const handleExport = async (note: Note) => {
    try {
      const fileUri = await storageService.exportNote(note.id, { format: 'txt', includeMetadata: true });
      await storageService.shareExportedFile(fileUri);
    } catch (error) {
      console.error('Failed to export note:', error);
      Alert.alert('Error', 'Failed to export note');
    }
  };

  const handleOpenActions = (note: Note) => {
    Alert.alert(note.title, undefined, [
      { text: note.pinned ? 'Unpin' : 'Pin', onPress: () => handleTogglePin(note) },
      { text: 'Export', onPress: () => handleExport(note) },
      { text: 'Delete', style: 'destructive', onPress: () => handleDelete(note) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const renderNoteCard = (note: Note) => (
    <TouchableOpacity
      key={note.id}
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => router.push(`/note/${note.id}`)}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {note.pinned ? '📌 ' : ''}
          {note.title}
        </Text>
        <TouchableOpacity onPress={() => handleOpenActions(note)} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      <Text style={styles.cardSnippet} numberOfLines={2}>
        {note.transcription || 'No transcription text'}
      </Text>
      <View style={styles.cardMeta}>
        <Text style={styles.metaText}>
          {formatDuration(note.duration)} • {formatRelativeTime(note.createdAt)}
        </Text>
        {note.tags.length > 0 && (
          <View style={styles.tagRow}>
            {note.tags.slice(0, 2).map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagChipText}>{tag}</Text>
              </View>
            ))}
            {note.tags.length > 2 && <Text style={styles.metaText}>+{note.tags.length - 2}</Text>}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search notes"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading notes…</Text>
        </View>
      ) : filteredNotes.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="document-text-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyStateTitle}>{query ? 'No matching notes' : 'No Notes Yet'}</Text>
          <Text style={styles.emptyStateText}>
            {query ? 'Try a different search term.' : 'Record and save your first note to see it here.'}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {pinnedNotes.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Pinned</Text>
              {pinnedNotes.map(renderNoteCard)}
              <Text style={[styles.sectionLabel, { marginTop: Spacing.lg }]}>All Notes</Text>
            </>
          )}
          {otherNotes.map(renderNoteCard)}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginHorizontal: Spacing.lg,
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: 10,
    },
    searchInput: { flex: 1, color: colors.text, fontSize: FontSize.md },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { fontSize: FontSize.md, color: colors.textMuted },
    list: { flex: 1, paddingHorizontal: Spacing.lg },
    sectionLabel: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: Spacing.sm,
      marginTop: Spacing.xs,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: Spacing.md,
      marginBottom: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardTitle: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: colors.text, marginRight: Spacing.sm },
    cardSnippet: { fontSize: FontSize.sm, color: colors.textMuted, marginTop: Spacing.xs, lineHeight: 20 },
    cardMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
    metaText: { fontSize: FontSize.sm, color: colors.textMuted },
    tagRow: { flexDirection: 'row', gap: Spacing.xs },
    tagChip: { backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
    tagChipText: { fontSize: 11, color: colors.tint, fontWeight: '600' },
    emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xxl },
    emptyStateTitle: {
      fontSize: FontSize.lg,
      fontWeight: '600',
      color: colors.text,
      marginTop: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    emptyStateText: { fontSize: FontSize.md, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  });
}
```

- [ ] **Step 3: Update `app/(tabs)/_layout.tsx`**

Replace the second `<Tabs.Screen>` block (currently `name="two"`) with:

```tsx
      <Tabs.Screen
        name="notes"
        options={{
          title: 'Notes',
          tabBarIcon: ({ color }) => <TabBarIcon name="document-text" color={color} />,
          headerTitle: 'Notes',
        }}
      />
```

- [ ] **Step 4: Verify**

```bash
grep -rln "app/(tabs)/two\|'\\./two'\|\"two\"" --include="*.ts" --include="*.tsx" app
npx tsc --noEmit
```

Expected: grep returns nothing (no remaining references to the old `two` route); tsc reports errors only in `app/note/[id].tsx`'s absence — i.e. `router.push('/note/...')` calls with no matching route yet, which is expected and fixed in Task 9.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: replace History screen with a searchable, pinnable Notes screen; fix stale-list-on-focus bug"
```

---

### Task 9: Note Detail modal — view/edit, tags, pin, playback, export, delete

**Files:**
- Create: `app/note/[id].tsx`
- Modify: `app/_layout.tsx` (register the new modal route)

**Interfaces:**
- Consumes: `Colors`, `Spacing`, `FontSize` (Task 6); `storageService.getNotes`/`updateNote`/`deleteNote`/`exportNote`/`shareExportedFile` (Task 5); `Note` (Task 3); `useAudioPlayer`/`useAudioPlayerStatus` from `expo-audio`
- Produces: nothing consumed by other tasks (leaf screen)

- [ ] **Step 1: Create `app/note/[id].tsx`**

```tsx
/**
 * Note Detail Screen
 * View/edit a single note: title, transcript, tags, pin, playback, export, delete.
 */

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { FontSize, Spacing } from '@/constants/Spacing';
import storageService from '@/services/storageService';
import { Note } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const AUTOSAVE_DELAY_MS = 800;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = createStyles(colors);

  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [transcription, setTranscription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [pinned, setPinned] = useState(false);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const notes = await storageService.getNotes();
      const found = notes.find((n) => n.id === id) ?? null;
      if (!cancelled) {
        setNote(found);
        if (found) {
          setTitle(found.title);
          setTranscription(found.transcription);
          setTags(found.tags);
          setPinned(found.pinned);
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
      }
    };
  }, []);

  const persist = (updates: Partial<Note>) => {
    if (!id) return;
    storageService.updateNote(id, updates).catch((error) => {
      console.error('Failed to update note:', error);
    });
  };

  const scheduleAutosave = (updates: Partial<Note>) => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
    }
    autosaveTimer.current = setTimeout(() => persist(updates), AUTOSAVE_DELAY_MS);
  };

  const handleTitleChange = (text: string) => {
    setTitle(text);
    scheduleAutosave({ title: text });
  };

  const handleTranscriptionChange = (text: string) => {
    setTranscription(text);
    scheduleAutosave({ transcription: text });
  };

  const handleTogglePin = () => {
    const next = !pinned;
    setPinned(next);
    persist({ pinned: next });
  };

  const handleAddTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed || tags.includes(trimmed)) {
      setNewTag('');
      return;
    }
    const next = [...tags, trimmed];
    setTags(next);
    setNewTag('');
    persist({ tags: next });
  };

  const handleRemoveTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    persist({ tags: next });
  };

  const handleDelete = () => {
    Alert.alert('Delete Note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            if (id) await storageService.deleteNote(id);
            router.back();
          } catch (error) {
            console.error('Failed to delete note:', error);
            Alert.alert('Error', 'Failed to delete note');
          }
        },
      },
    ]);
  };

  const handleExport = async (format: 'txt' | 'json' | 'srt') => {
    if (!id) return;
    try {
      const fileUri = await storageService.exportNote(id, { format, includeMetadata: true });
      await storageService.shareExportedFile(fileUri);
    } catch (error) {
      console.error('Failed to export note:', error);
      Alert.alert('Error', 'Failed to export note');
    }
  };

  const handleExportPress = () => {
    Alert.alert('Export Note', undefined, [
      { text: 'Text (.txt)', onPress: () => handleExport('txt') },
      { text: 'JSON (.json)', onPress: () => handleExport('json') },
      { text: 'Subtitles (.srt)', onPress: () => handleExport('srt') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleClose = () => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      persist({ title, transcription });
    }
    router.back();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!note) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Note not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: Spacing.lg }}>
            <Text style={{ color: colors.tint }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleClose} hitSlop={8}>
          <Ionicons name="chevron-down" size={26} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleTogglePin} hitSlop={8}>
          <Ionicons name={pinned ? 'bookmark' : 'bookmark-outline'} size={22} color={colors.tint} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={handleTitleChange}
          placeholder="Note title"
          placeholderTextColor={colors.textMuted}
          multiline
        />

        <Text style={styles.metaText}>
          {note.createdAt.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>

        {note.audioUri && <NotePlayer uri={note.audioUri} colors={colors} />}

        <View style={styles.tagSection}>
          <View style={styles.tagRow}>
            {tags.map((tag) => (
              <TouchableOpacity key={tag} style={styles.tagChip} onPress={() => handleRemoveTag(tag)}>
                <Text style={styles.tagChipText}>{tag} ×</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.addTagRow}>
            <TextInput
              style={styles.addTagInput}
              value={newTag}
              onChangeText={setNewTag}
              placeholder="Add tag"
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={handleAddTag}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={handleAddTag} style={styles.addTagButton}>
              <Ionicons name="add" size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>

        <TextInput
          style={styles.transcriptionInput}
          value={transcription}
          onChangeText={handleTranscriptionChange}
          multiline
          textAlignVertical="top"
        />
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.bottomButton} onPress={handleExportPress}>
          <Ionicons name="share-outline" size={20} color={colors.tint} />
          <Text style={[styles.bottomButtonText, { color: colors.tint }]}>Export</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomButton} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={20} color={colors.danger} />
          <Text style={[styles.bottomButtonText, { color: colors.danger }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function NotePlayer({ uri, colors }: { uri: string; colors: typeof Colors.light }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const styles = createStyles(colors);

  return (
    <View style={styles.playerRow}>
      <TouchableOpacity onPress={() => (status.playing ? player.pause() : player.play())}>
        <Ionicons name={status.playing ? 'pause-circle' : 'play-circle'} size={40} color={colors.tint} />
      </TouchableOpacity>
      <Text style={styles.metaText}>
        {formatTime(status.currentTime)} / {formatTime(status.duration ?? 0)}
      </Text>
    </View>
  );
}

function createStyles(colors: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
    },
    scroll: { flex: 1, paddingHorizontal: Spacing.lg },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { color: colors.textMuted, fontSize: FontSize.md },
    titleInput: { fontSize: FontSize.xl, fontWeight: 'bold', color: colors.text, paddingVertical: Spacing.xs },
    metaText: { fontSize: FontSize.sm, color: colors.textMuted, marginBottom: Spacing.md },
    playerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    tagSection: { marginBottom: Spacing.md },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
    tagChip: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    tagChipText: { color: colors.tint, fontSize: FontSize.sm, fontWeight: '600' },
    addTagRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    addTagInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      color: colors.text,
    },
    addTagButton: {
      backgroundColor: colors.tint,
      borderRadius: 8,
      width: 32,
      height: 32,
      justifyContent: 'center',
      alignItems: 'center',
    },
    transcriptionInput: {
      fontSize: FontSize.md,
      lineHeight: 22,
      color: colors.text,
      minHeight: 200,
      paddingBottom: Spacing.xxl,
    },
    bottomBar: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingVertical: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    bottomButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    bottomButtonText: { fontSize: FontSize.md, fontWeight: '600' },
  });
}
```

- [ ] **Step 2: Register the route in `app/_layout.tsx`**

In `RootLayoutNav`, add the modal screen back (Task 2 removed the old `modal` entry — this replaces it with a real one):

```tsx
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="note/[id]" options={{ presentation: 'modal', headerShown: false }} />
      </Stack>
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

Expected: zero errors across the whole project.

- [ ] **Step 4: Commit**

```bash
git add app/note "app/_layout.tsx"
git commit -m "feat: add Note Detail modal — edit title/transcript/tags, pin, playback, export, delete"
```

---

### Task 10: README update, final sweep, manual smoke-test handoff

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Update `README.md`**

Update the **Features** section to describe Notes instead of History:

```markdown
## Features

- **Live streaming transcription** — audio is captured in 100 ms chunks and streamed straight into the Whisper model as you speak, with committed and in-progress (interim) text shown separately.
- **On-device inference** — runs fully offline through ExecuTorch; no server, no API keys, no network calls.
- **Notes** — recordings are saved as editable notes: title, transcript, and freeform tags, all editable after the fact. Pin the ones you want to keep at the top.
- **Audio playback** — each note keeps the actual recording (captured to an M4A file alongside the live transcription) so you can play it back from the note.
- **Search** — filter notes by title, transcript text, or tag.
- **Export & share** — export any note as `.txt`, `.json`, or `.srt` and share it through the native share sheet.
- **Haptic feedback** on start/stop/save for a more tactile recording experience.
```

Update the **Project Structure** section:

```markdown
## Project Structure

\`\`\`
app/
├── _layout.tsx              # Root stack + font loading
├── note/[id].tsx             # Note Detail modal — edit, tags, pin, playback, export, delete
└── (tabs)/
    ├── _layout.tsx           # Tab navigator (Record / Notes)
    ├── index.tsx             # Record screen — capture + live transcription
    └── notes.tsx              # Notes screen — search, pinned section, cards

services/
└── storageService.ts        # AsyncStorage persistence, export (txt/json/srt), sharing

constants/
├── config.ts                 # Audio, storage, and export configuration
├── Colors.ts                  # Light/dark theme tokens
└── Spacing.ts                 # Shared spacing/font-size scale

types/
└── index.ts                  # Shared TypeScript types
\`\`\`
```

Update the **How It Works** section, step 4-5:

```markdown
4. On stop, the recorder also finishes writing an M4A file (captured in parallel via `enableFileOutput`) — the note is saved with the real audio duration and a link to that file.
5. The Notes tab lists saved notes; tap one to edit its title/transcript/tags, play back the audio, export, or delete it.
```

- [ ] **Step 2: Full-project sweep**

```bash
grep -rln "TranscriptionItem\|EnhancedTranscriptionItem\|streaming_recording\|components/enhanced\|services/enhanced" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules
npx tsc --noEmit
```

Expected: both empty/clean.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README for the Notes feature (title/tags/pin/playback/search)"
```

- [ ] **Step 4: Hand off the manual smoke-test list**

This cannot be run in this environment (no physical device, no simulator support). Once built on-device, verify:
1. Record → Save → note appears in Notes immediately (no restart needed).
2. Open a note, edit title and transcript text, close it, reopen — edits persisted.
3. Play the note's audio; scrubber/time updates; pause works.
4. Add and remove a tag; pin and unpin a note (pinned section updates).
5. Search by a word that's only in the transcript body, and by a tag.
6. Export a note as .txt, .json, and .srt via the share sheet.
7. Delete a note; confirm it's gone and its audio file no longer takes up space.
8. Toggle the device's system light/dark mode; confirm both screens and the modal follow it (no leftover hardcoded white/black patches).
9. Deny microphone permission once (device Settings) and confirm the app now shows an alert instead of failing silently.

---

## Self-review notes

- **Spec coverage:** every section of the spec maps to a task — dead code removal (1–2), type/constant trimming (3–4), storage bug fixes (5), theming (6), Record screen bugs/audio capture (7), Notes screen + focus-refresh bug (8), Note Detail/playback (9), README + backward-compat verification (10, plus the `normalizeNote` defaulting logic embedded in Task 5).
- **Placeholder scan:** no TBD/TODO; every step has literal, complete code or an exact command.
- **Type consistency:** `Note`, `ExportOptions`, `StorageInfo`, `StorageServiceInterface` (Task 3) match the method names used in `storageService` (Task 5) and called from Tasks 7–9 (`saveNote`, `getNotes`, `updateNote`, `deleteNote`, `exportNote`, `shareExportedFile`, `getStorageInfo`, `clearAllData`). `Colors`/`Spacing`/`FontSize` (Task 6) are consumed with the same key names in Tasks 7–9. The one deliberate deviation from the original UI discussion (swipe-to-delete → "•••" action sheet) is called out explicitly in Task 8 with its rationale (no new dependency).
