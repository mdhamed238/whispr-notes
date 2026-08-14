# Notes App Transformation — Design

## Overview

The app currently has a working two-screen loop (Record → History) plus roughly 9,000 lines
of unreferenced "enhanced" code from an earlier, abandoned rewrite attempt (`components/enhanced/*`,
`services/enhanced/*`, unused contexts, an unused model manager, an empty service file). None of it
is imported by the live app.

This change:
1. Removes all dead code and dead/duplicate config.
2. Fixes real bugs in the live Record/History flow.
3. Evolves "History" into "Notes": notes get a title, freeform tags, pinning, and are
   editable after saving. Recordings now capture a real audio file (not just streamed
   buffers), so notes get playback.
4. Reworks the UI to use a proper light/dark theme (the app already ships theme
   infrastructure — `Colors.ts`, `useColorScheme` — that the actual screens never use)
   and a redesigned Notes list / Note Detail screen.

No new external dependencies. `expo-audio` and `expo-av` are both already installed and
both currently unused; this change puts `expo-audio` to use (playback) and removes
`expo-av`, which becomes fully redundant once that happens.

## Non-goals

Kept deliberately out of scope, to avoid resurrecting the complexity that made the
original "enhanced" branch dead weight:

- No database (`expo-sqlite` etc.) — AsyncStorage-as-JSON-array is adequate at the
  personal-scale item counts this app will ever see. Search/filter stays a client-side
  `.filter()` over the in-memory list; no search-index service.
- No fixed `category` enum — freeform `tags: string[]` is the only organizing concept.
- No test framework — none is configured today (per README); adding one is a separate
  decision, not a side effect of this change.
- No waveform/audio-level visualizer, no cloud sync, no batch operations UI, no export
  templates — all were dead code in the old `enhanced/` tree and nothing in this task
  calls for reviving them.
- No app rename / license changes, beyond fixing the stray `"audio-transcription-app-temp"`
  package name while `package.json` is already being touched.

## Dead code removal

Confirmed via import-graph grep (zero references from any file reachable from
`app/_layout.tsx`):

- `components/enhanced/` — all 10 files (AudioVisualizer, BatchOperationsModal,
  ExportModal, OptimizedRecordingScreen, RecordingControls, SearchAndFilter, TagManager,
  TranscriptionDetailScreen, TranscriptionEditor, TranscriptionListItem,
  VirtualizedTranscriptionList)
- `services/enhanced/` — all 7 files (audioService, cacheService, cloudService,
  exportService, memoryService, paginationService, searchService, templateService)
- `services/modelManager.ts`, `services/streamingTranscriptionService.ts` (empty, 0 bytes)
- `contexts/AppContext.tsx`, `contexts/SettingsContext.tsx`, `contexts/PerformanceContext.tsx`
  (never provided/wrapped in `app/_layout.tsx` — orphaned)
- `hooks/useOptimizedCallback.ts`, `hooks/usePerformanceOptimization.ts`
- `utils/performance/` — both files (only consumed by the dead cluster above)
- Stock Expo template leftovers, unused by the real app: `app/modal.tsx`,
  `components/EditScreenInfo.tsx`, `components/StyledText.tsx`,
  `components/__tests__/StyledText-test.js`, `components/ExternalLink.tsx`,
  `components/Themed.tsx`
- `app/+not-found.tsx` — currently imports `Themed`; rewritten to plain themed
  `View`/`Text` using the new `Colors` tokens instead (kept, since it's a real
  expo-router route, just de-coupled from the deleted `Themed` component)
- `expo-av` dependency removed from `package.json`

Types/constants cleanup (not full-file deletions, but trimming dead exports):

- `types/index.ts`: remove `EnhancedTranscriptionItem`, `ModelInfo`,
  `TranscriptionProgress`, `AudioRecordingState`, `TranscriptionError`, `AudioError`,
  `AudioServiceInterface`, `TranscriptionServiceInterface`, `ModelManagerInterface`,
  everything under the "Enhanced types for new functionality" heading, `AppContextType`,
  `SettingsContextType`, `PerformanceContextType`, `EnhancedAudioServiceInterface`,
  `SearchServiceInterface`, `SettingsServiceInterface`, `PerformanceServiceInterface`,
  and the duplicate `AUDIO_CONFIG`/`DEFAULT_SETTINGS`/`MODEL_CONFIG`/`STORAGE_KEYS`
  constants (these already live in `constants/config.ts`, with contradictory values in
  the two copies — e.g. two different Whisper model URLs, neither of which is actually
  used since the app loads `WHISPER_TINY_EN` from `react-native-executorch` directly).
- `constants/config.ts`: remove `MODEL_CONFIG`, `RECORDING_LIMITS`,
  `TRANSCRIPTION_CONFIG`, `FILE_PATHS`, `PERFORMANCE_THRESHOLDS`, `APP_INFO`,
  `DEBUG_CONFIG` (all dead — zero references outside the deleted cluster). Keep and
  wire in `UI_CONFIG.MAX_HISTORY_ITEMS` (replaces the magic number `1000` currently
  hardcoded in `storageService.saveTranscription`) and `ERROR_MESSAGES` (replaces
  ad-hoc inline alert strings in the Record/Notes screens).

## Bug fixes

1. **`storageService.clearAllData()` writes to the wrong key.** After clearing the
   `TRANSCRIPTIONS` key it immediately writes `JSON.stringify({ lastCleanup: ... })`
   back into that same key — a plain object where an array is expected. The next
   `getTranscriptions()` call chokes on `.map()` and silently returns `[]` (caught and
   swallowed). Fix: write the cleanup timestamp to the dedicated `'last_cleanup'` key
   that `getLastCleanupDate()` actually reads from.
2. **Notes list doesn't refresh on focus.** `two.tsx` loads transcriptions once in a
   mount-only `useEffect`. Recording and saving a new note, then switching to the
   History/Notes tab, shows stale data until the app restarts. Fix: reload on
   `useFocusEffect` (from `expo-router`/`@react-navigation/native`).
3. **Recording permission and start/stop results are ignored.**
   `AudioManager.requestRecordingPermissions()` returns a granted/denied status that's
   never checked; `recorder.start()` returns `{status, message}` that's never checked
   either. A denied permission currently fails silently instead of telling the user.
   Fix: check both, alert on denial/failure, don't flip into "recording" UI state on
   failure.
4. **SRT export mis-formats timestamps over 59 seconds.**
   `generateSrtExport` does `duration.toString().padStart(2, '0')` directly into the
   seconds field with no minutes/hours math — a 125-second note exports as
   `00:00:125,000`, which is not valid SRT. Fix: proper `HH:MM:SS,mmm` formatting.
5. **Recordings never had a real audio file.** `audioUri` was hardcoded to the string
   `'streaming_recording'` on every save, and `duration` was hardcoded to `0`. Every
   delete/storage-info call then did a pointless `FileSystem.getInfoAsync` against that
   fake path. Fix: real file + real duration, see "Audio capture" below.
6. **Reset button doesn't clear the displayed transcript.** `handleReset` only calls
   `handleStopStreaming` if still generating; the hook's `committedTranscription` has
   no public clear/reset method, so old text lingers after Reset or after Save. Fix:
   remount the recorder/model subtree by keying it on a `sessionId` that increments on
   Reset and after a successful Save — forces a fresh hook instance instead of relying
   on an undocumented internal reset.

## Data model

```ts
interface Note {
  id: string;
  title: string;
  transcription: string;
  audioUri: string | null;   // real file path from AudioRecorder file output; null if capture failed
  duration: number;          // seconds, from AudioRecorder.stop() result
  tags: string[];
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

Backward compatibility: existing on-device records were saved under the old
`TranscriptionItem` shape (no `title`/`tags`/`pinned`/`updatedAt`, `audioUri` is the
fake placeholder string). `storageService.getTranscriptions()` (renamed to something
`Note`-appropriate, see below) fills in defaults on read rather than requiring a
migration step: missing `title` → derived from the first ~40 characters of
`transcription`; missing `tags` → `[]`; missing `pinned` → `false`; missing `updatedAt`
→ same as `createdAt`; `audioUri === 'streaming_recording'` → normalized to `null`
(no real file exists for those old entries, so playback is simply unavailable for them).

## Storage service

`services/storageService.ts` keeps its filename and singleton export shape but its
methods and internal type move from `TranscriptionItem` to `Note`:

- `saveTranscription` → `saveNote`
- `getTranscriptions` → `getNotes` (applies the backward-compat defaults above)
- `updateTranscription` → `updateNote` (also stamps `updatedAt = new Date()`)
- `deleteTranscription` → `deleteNote` (unchanged logic, still best-effort deletes the
  associated audio file)
- `exportTranscription` → `exportNote` (txt/json/srt content generation updated for
  the new fields; SRT duration bug fixed here)
- `clearAllData` — bug fixed as above
- `MAX_ITEMS` magic number replaced by `UI_CONFIG.MAX_HISTORY_ITEMS`

## Audio capture (Record screen)

> **Correction (post-implementation):** the design below assumed
> `AudioRecorder.enableFileOutput()`/`FileFormat`/`FilePreset` and an async
> `start()`/`stop()` returning `{status, paths, duration, size}`. That API
> does not exist in the installed `react-native-audio-api` version (0.9.1) —
> it was researched against a newer library version than what's actually
> pinned. `start()`/`stop()` are synchronous `void` in 0.9.1, confirmed
> directly against `node_modules/react-native-audio-api/lib/typescript/core/AudioRecorder.d.ts`.
> Discovered mid-implementation (Task 7); the shipped app instead
> hand-encodes a 16-bit PCM WAV file (`services/wavEncoder.ts`) from the
> same PCM samples already flowing through `onAudioReady` for streaming
> transcription, computing duration from sample count / sample rate rather
> than any recorder-provided result. See the implementation plan
> (`docs/superpowers/plans/2026-08-14-notes-app-transformation.md`, Task 7)
> for the corrected design and rationale. The bullets below describe the
> original, superseded design and are kept for historical context only.

- Before `recorder.start()`, call
  `recorder.enableFileOutput({ format: FileFormat.M4A, preset: FilePreset.High })` —
  M4A/AAC over WAV for a much smaller on-device footprint for voice notes kept
  long-term.
- `onAudioReady` buffer callback keeps feeding `model.streamInsert(...)` exactly as
  today, unchanged — file capture happens in parallel via the recorder itself, not by
  us re-encoding the streamed buffers.
- On `recorder.stop()`, read `{status, paths, duration, size}`:
  - `status === 'success'` → `audioUri = paths[0]`, real `duration` used for the note.
  - `status === 'error'` → save proceeds text-only (`audioUri: null`, `duration: 0`),
    alert is not shown for this specific failure since the transcript itself still
    saved fine — only the audio capture was lost.
- Recorder/model subtree remounted via `key={sessionId}` on Reset and after Save, per
  bug fix #6 above.
- Auto-title on save: first ~40 characters of the committed transcript (falls back to
  a timestamp string, e.g. "Note — Aug 14, 2:30 PM", if the transcript is empty —
  shouldn't happen given the existing "nothing to save" guard, but keeps `title` non-empty).
- After save, navigate to the Notes tab so the new note is immediately visible (works
  together with bug fix #2's focus-refresh).

## Screens & navigation

- `app/(tabs)/two.tsx` → renamed `app/(tabs)/notes.tsx`. Tab label "History" → "Notes".
- New `app/note/[id].tsx`, presented as a modal (`Stack.Screen` with
  `presentation: 'modal'` in `app/_layout.tsx`, replacing the now-deleted `modal`
  route registration).
- **Record** (`app/(tabs)/index.tsx`): state-driven header (idle / listening /
  processing), transcript in a scrollable card, single primary record/stop button.
  No inline editing — Save writes the note with the auto title and routes to Notes.
- **Notes** (`app/(tabs)/notes.tsx`): search bar at top (client-side filter over
  title + transcription + tags), a "Pinned" section when any notes are pinned, then
  all notes as cards below — title, 2-line snippet, relative time, duration badge,
  up to 2-3 tag chips (+n overflow). Swipe-to-delete replaces the always-visible trash
  icon. Tap opens Note Detail.
- **Note Detail** (`app/note/[id].tsx`): editable title + transcript body, autosaved
  via `updateNote` 800ms after the last keystroke and flushed on every screen-dismissal
  path (button, swipe, hardware back — not just per-keystroke), play/pause + elapsed/total
  time via `expo-audio`'s `useAudioPlayer`/`useAudioPlayerStatus` (hidden entirely when
  `audioUri` is `null`; no seek/scrubber control — that was scoped out during
  implementation to avoid a new dependency or hand-rolled gesture code), tag editor
  (add/remove chips), pin toggle, export (txt/json/srt via existing share sheet), delete.

## Theming

`constants/Colors.ts` expands from its current 5 keys (`text`, `background`, `tint`,
`tabIconDefault`, `tabIconSelected`) to include `surface`, `card`, `border`,
`textMuted`, `danger`, `success`, `accent` for both `light` and `dark`. A new
`constants/Spacing.ts` holds a small shared spacing scale (4/8/12/16/24/32) and 3-4 font
sizes. Every screen switches from hardcoded hex literals to `Colors[colorScheme][...]`
and the shared spacing constants — this is the fix for the current inconsistency where
the app ships dark-mode infrastructure that the actual screens never use.

## Error handling

- Permission-denied and recorder start/stop failures surface via `Alert` instead of
  failing silently (bug fix #3).
- File-output capture failure degrades to a text-only note rather than blocking the
  save (see "Audio capture" above).
- `clearAllData` key bug fixed (bug fix #1).
- No new logging/error-reporting service — that class of thing is exactly what the
  deleted `PerformanceContext`/`memoryService` cluster over-built for a personal app;
  not reviving it.

## Testing / verification

No test runner is configured in this repo (per README), and none is added as a side
effect of this change. Verification for this change:

- `tsc --noEmit` as the compile-time safety net.
- Manual on-device smoke test (this environment can't run the app itself — physical
  device required, no simulator support): record → save → appears in Notes, edit
  title/tags/text, playback, pin, search/filter, export, delete, light/dark mode.

## Out of scope (explicit)

SQLite/database migration, fixed category taxonomy, resurrecting any `enhanced/`
component or service, cloud sync, batch operations, export templates, audio
waveform/level visualizer, adding a test framework, app rename/licensing beyond the
stray package name fix.
