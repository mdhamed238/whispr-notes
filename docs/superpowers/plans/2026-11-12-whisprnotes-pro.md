# WhisprNotes Pro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Expo voice-transcription app into WhisprNotes: a paid, fully on-device voice-notes product with Large-v3 transcription, AI summaries and titles, import/export, insights, paywall, legal pages, brand and website.

**Architecture:** Phased. Each phase leaves the app shippable. Phase 1 replaces AsyncStorage with SQLite behind a repo that emits change events, so every screen reacts to background work. Phases 2–5 add global, screen-independent services (enhancement queue, summarizer, exporter, importer, billing), with all logic that can be pure kept in pure modules under Jest test.

**Tech Stack:** Expo SDK 57, RN 0.86, expo-router, react-native-executorch 0.10 (`/legacy`), whisper.rn, expo-sqlite (FTS5), expo-print, expo-document-picker, expo-device, react-native-svg, react-native-purchases (RevenueCat), jszip, fast-xml-parser, Jest (jest-expo).

**Spec:** `docs/superpowers/specs/2026-11-12-whisprnotes-pro-design.md`

## Global Constraints

- Install every Expo/RN package with `npx expo install <pkg>` (SDK 57 matching), then `yarn` keeps `yarn.lock` authoritative. Native packages pinned to exact versions (no `^`).
- Transcription/LLM imports come from `react-native-executorch/legacy` and `react-native-executorch-expo-resource-fetcher/legacy`.
- No network call may carry user content. Only allowed network: model downloads (Hugging Face URLs from the executorch registry + the whisper.cpp ggml URL below) and RevenueCat/store purchase calls.
- No analytics/crash/telemetry SDKs.
- iOS 17+, Android arm64-v8a. Physical devices only.
- Brand: name **WhisprNotes**; coral `#FF6A4D`, ink `#2A1D3A`, peach `#FFC9BB`. Interactive tint: light `#E8553B`, dark `#FF7A5C`.
- Contact: `mdhamed.off@gmail.com`. Seller: individual (owner's name), no company.
- Copy: plain, active voice; privacy claims must mention the two network uses (model downloads, purchases).
- Free: unlimited recording + live Base, 3 AI summaries per rolling 7 days, `.txt` export, plain share, auto-title. Pro: enhanced final pass (Large-v3-Turbo/Small), unlimited summaries, PDF/MD/SRT/audio export, bulk backup, import, Insights, language choice.
- RevenueCat entitlement id `pro`; product ids `whisprnotes_pro_monthly`, `whisprnotes_pro_yearly`, `whisprnotes_pro_lifetime`.
- Haptics always go through `services/haptics.ts` (respects the user toggle). The record-start haptic stays **before** `recorder.start()` (see existing comment in `app/(tabs)/index.tsx`).
- Pure logic lives in files that import no native modules, so Jest can load them.

**Deviation from spec, by design:** the Lite tier keeps today's Base timestamp pass (word timings + better text up to 10 min) rather than "no pass", so Lite doesn't regress. Free users on any tier also get this Base pass.

## Review Focus

1. **Android under-reports RAM.** An 8 GB S23 reports ~7.3 GiB in `Device.totalMemory`. Expect flagship tier. → test in Task 7.
2. **App killed mid-enhancement or mid-summary.** Note must not stay "Enhancing…" forever. Expect `running` jobs reset to `pending` and resumed on next launch. → test in Task 8.
3. **User edits while background work runs.** Expect the user's edit wins and the late result is dropped (transcript) or stored without overwriting edited fields (summary/title). → test in Task 2 (CAS) and Task 8.
4. **Interrupted model download** (network drop, app killed). Expect file not treated as installed; download restartable. → test in Task 7.
5. **LLM returns malformed output** (no headings, `<think>` block, empty). Expect a usable summary fallback, never a crash or empty card. → test in Task 9.

---

## Phase 1 — Foundation

### Task 1: Test tooling, brand tokens, app config cleanup

**Files:**
- Modify: `package.json` (scripts `test`, `typecheck`; devDeps `jest`, `jest-expo`, `@types/jest`), `app.json`, `constants/Colors.ts`
- Create: `jest.config.js`, `__tests__/smoke.test.ts`

- [ ] **Step 1:** `npx expo install jest-expo jest @types/jest -- --dev`. Add scripts: `"test": "jest"`, `"typecheck": "tsc --noEmit"`. `jest.config.js`: `{ preset: 'jest-expo', testMatch: ['**/__tests__/**/*.test.ts'] }`.
- [ ] **Step 2:** `__tests__/smoke.test.ts` asserts `1 + 1 === 2`. Run `yarn test` → PASS. Run `yarn typecheck` → record the baseline error count (should be 0; fix any pre-existing errors in this task).
- [ ] **Step 3:** `constants/Colors.ts`: replace blue tints with the brand tints from Global Constraints. Add exported `Brand = { coral: '#FF6A4D', ink: '#2A1D3A', peach: '#FFC9BB' }`. Light `background` `#FAF8F7`, `surface` `#F3EEEC`; dark `background` `#0D0B10`, `surface` `#17141C`, `card` `#1E1A24`. `navBackground` = `Brand.ink`.
- [ ] **Step 4:** `app.json`: `name` "WhisprNotes", `scheme` "whisprnotes", splash/adaptive `backgroundColor` `#FF6A4D`. Remove `WRITE_EXTERNAL_STORAGE`, `READ_EXTERNAL_STORAGE` and the duplicate bare `RECORD_AUDIO`. Remove duplicate `"audio"` in `UIBackgroundModes` if present. Mic usage strings: "WhisprNotes uses the microphone to record your notes. Audio is processed on this device and never uploaded." Keep bundle ids.
- [ ] **Step 5:** `yarn typecheck && yarn test` → both pass. Commit `chore: jest, brand tokens, app config cleanup`.

### Task 2: SQLite notes repository with change events

**Files:**
- Create: `services/db/schema.ts` (SQL strings + `SCHEMA_VERSION = 1`), `services/db/mapping.ts` (pure), `services/db/notesRepo.ts`, `services/db/migrateLegacy.ts`
- Modify: `types/index.ts`
- Delete (end of Task 6): `services/storageService.ts`
- Test: `__tests__/db/mapping.test.ts`

**Interfaces:**
- Produces (types):
  ```ts
  export type EnhancementState = 'none' | 'pending' | 'running' | 'done' | 'failed';
  export interface NoteSummary { overview: string; keyPoints: string[]; actionItems: string[]; decisions: string[]; model: string; generatedAt: string }
  export interface Note { id; title; transcription; audioUri; duration; tags; pinned; createdAt; updatedAt;
    summary: NoteSummary | null; language: string | null; source: 'recording' | 'import';
    enhancement: EnhancementState; enhancementProgress: number; titleIsAuto: boolean; contentHash: string | null }
  export type NoteSort = 'newest' | 'oldest' | 'longest' | 'title';
  ```
- Produces (`services/db/notesRepo.ts`):
  `listNotes(opts?: { query?: string; tag?: string; sort?: NoteSort }): Promise<Note[]>` · `getNote(id): Promise<Note | null>` · `createNote(note: Note): Promise<void>` · `updateNote(id, patch: Partial<Note>, opts?: { expectUpdatedAt?: Date }): Promise<boolean>` (false when CAS fails or not found) · `deleteNote(id): Promise<Note | null>` (removes row only; audio/timeline deleted by `purgeNoteFiles(note)` after the undo window) · `restoreNote(note: Note): Promise<void>` · `allTags(): Promise<{ tag: string; count: number }[]>` · `findByContentHash(hash): Promise<Note | null>` · `deleteAllData(): Promise<void>` (rows + `audio/`, `timelines/`, `exports/`, downloaded models untouched) · `subscribe(listener: (changedId: string | null) => void): () => void`
- Produces (`services/db/mapping.ts`): `rowToNote(row: NoteRow): Note`, `noteToRow(note: Note): NoteRow`, `toFtsQuery(input: string): string | null`

- [ ] **Step 1: Write failing tests** in `__tests__/db/mapping.test.ts`:
  - `noteToRow`→`rowToNote` round-trips a fully populated note (dates equal by `getTime()`, tags array, summary object).
  - `rowToNote` with `summary_json = null`, `tags_json = '[]'` gives `summary: null, tags: []`.
  - `rowToNote` with malformed `tags_json` (`'not json'`) gives `tags: []` (no throw).
  - `toFtsQuery('  meeting  notes ')` → `'"meeting"* "notes"*'`; `toFtsQuery('a"b')` → `'"ab"*'` (quotes stripped); `toFtsQuery('   ')` → `null`.
- [ ] **Step 2:** `yarn test mapping` → FAIL (module missing).
- [ ] **Step 3:** `npx expo install expo-sqlite`. Implement schema: table `notes` (columns mirroring `Note`, JSON text for tags/summary, ISO dates), indexes on `created_at`, `pinned`; FTS5 table `notes_fts(id UNINDEXED, title, transcription, tags)` kept in sync by triggers. `PRAGMA journal_mode=WAL`. Repo opens DB once (`openDatabaseAsync('whisprnotes.db')`), runs schema, then `migrateLegacy()`. All writes go through `db.withExclusiveTransactionAsync` or single statements; emit `subscribe` events after each write.
- [ ] **Step 4:** `migrateLegacy()`: if AsyncStorage key `transcriptions` exists and a `meta` row `legacy_migrated` is absent, normalize each item (reuse the logic of `StorageService.normalizeNote`, moved into `mapping.ts` as `normalizeLegacy(item: unknown): Note`), insert all in one transaction, set the flag, then remove the AsyncStorage key. Existing timeline sidecars remain valid (same ids). Add test: `normalizeLegacy({ id:'1', transcription:'hi', createdAt:'bad' })` returns a Note with valid `createdAt`, `source:'recording'`, `enhancement:'none'`, `titleIsAuto:true`.
- [ ] **Step 5:** `updateNote` with `expectUpdatedAt`: `UPDATE … WHERE id=? AND updated_at=?`; returns `changes > 0`. Test the SQL builder `buildUpdate(patch, expect?)` in mapping tests: with expect → WHERE clause contains `updated_at = ?` and params end with the ISO string.
- [ ] **Step 6:** `yarn test && yarn typecheck` → PASS. Commit `feat: SQLite notes repo with FTS and change events`.

### Task 3: Interaction primitives (haptics, toast, sheet, swipe, segmented)

**Files:**
- Create: `services/haptics.ts`, `services/settings.ts`, `components/ui/Toast.tsx` (+ `ToastProvider`, `useToast`), `components/ui/ActionSheet.tsx`, `components/ui/SwipeableRow.tsx`, `components/ui/SegmentedControl.tsx`
- Modify: `components/ui/AnimatedPressable.tsx`, `components/ui/Button.tsx`, `app/_layout.tsx` (providers, `GestureHandlerRootView`)
- Test: `__tests__/settings.test.ts`

**Interfaces:**
- `services/settings.ts`: `type Settings = { hapticsEnabled: boolean; tierOverride: DeviceTier | null; transcriptionLanguage: string /* 'auto' | ISO code */; autoSummarize: boolean; onboardingCompleted: boolean; summaryLog: string[] /* ISO dates */ }`; `DEFAULT_SETTINGS`; `mergeSettings(stored: unknown): Settings` (pure); `getSettings(): Promise<Settings>`; `updateSettings(patch): Promise<Settings>`; `useSettings(): [Settings, (patch) => void]`. Storage: AsyncStorage key `settings.v1`.
- `services/haptics.ts`: `haptic(kind: 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'): Promise<void>`; reads a module-level cached `hapticsEnabled` refreshed by `updateSettings`.
- `useToast()`: `show({ message: string; action?: { label: string; onPress(): void }; tone?: 'default' | 'success' | 'error'; durationMs?: number })`. Default duration 4000 ms; single toast at a time, slides up above tab bar; reduced-motion → fade only.
- `ActionSheet`: `open({ title?: string; actions: { label: string; icon?: IoniconName; destructive?: boolean; onPress(): void }[] })` via `useActionSheet()`; bottom sheet with backdrop, swipe-down to close, `haptic('selection')` on open.
- `SwipeableRow`: built on `react-native-gesture-handler` `ReanimatedSwipeable`; props `leftAction`, `rightAction` (`{ icon, color, onTrigger }`); fires `haptic('light')` when crossing the trigger threshold.

- [ ] **Step 1: Failing tests:** `mergeSettings(undefined)` equals `DEFAULT_SETTINGS`; `mergeSettings({ hapticsEnabled: false, junk: 1 })` keeps `hapticsEnabled:false` and drops `junk`; `mergeSettings({ summaryLog: 'x' })` → `summaryLog: []`.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Build the components. Replace every direct `expo-haptics` call in `components/` with `haptic()`. `AnimatedPressable`'s `haptic` prop maps to the same kinds.
- [ ] **Step 4:** Wrap root in `GestureHandlerRootView`, `ToastProvider`, `ActionSheetProvider`. `yarn typecheck` → PASS. Commit `feat: haptics service, toast, action sheet, swipe rows`.

### Task 4: Navigation shell

**Files:**
- Modify: `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `components/ui/FloatingTabBar.tsx`
- Create: `app/(tabs)/insights.tsx` (placeholder until Task 12), `app/(tabs)/settings.tsx`, `app/legal/[doc].tsx`, `app/models.tsx`, `app/paywall.tsx` (placeholder until Task 13), `app/onboarding.tsx` (placeholder until Task 14)

- [ ] **Step 1:** Root `Stack`: `(tabs)`; `note/[id]` as default card push with `gestureEnabled: true`, `animation: 'slide_from_right'` (Android) / default iOS push; `paywall` `presentation: 'modal'`; `onboarding` `presentation: 'fullScreenModal', gestureEnabled: false`; `legal/[doc]`, `models` pushes. All `headerShown: false` except legal/models which use a native header with brand tint.
- [ ] **Step 2:** Tabs: Record (`mic`), Notes (`document-text`), Insights (`stats-chart`), Settings (`settings`). FloatingTabBar: `haptic('selection')` on tab change, animated active pill (Reanimated layout transition), hides when keyboard is open, respects bottom safe area.
- [ ] **Step 3:** Settings screen sections: **AI models** (tier, current engine, link to `/models`), **Transcription** (language picker, auto-summarize toggle), **Feedback** (haptics toggle), **WhisprNotes Pro** (status, upgrade/restore → `/paywall`), **Data** (Import notes → Task 11, Back up all notes → Task 10, Your data → `/legal/data`, Delete all data with typed confirmation), **About** (Privacy, Terms, contact email, version). Rows not yet wired show but route to their placeholder.
- [ ] **Step 4:** Onboarding gate: in root layout, after settings load, if `!onboardingCompleted` → `router.replace('/onboarding')`. Placeholder onboarding has a "Continue" that sets the flag.
- [ ] **Step 5:** Manual check on device: all tabs switch with haptic; note push swipes back on iOS and back-button on Android. `yarn typecheck` → PASS. Commit `feat: four-tab navigation shell and settings`.

### Task 5: Notes screen overhaul

**Files:** Modify `app/(tabs)/notes.tsx`; Create `hooks/useNotes.ts`

**Interfaces:** `useNotes(opts: { query: string; tag: string | null; sort: NoteSort }): { notes: Note[]; loading: boolean; refresh(): Promise<void> }`, re-queries on `notesRepo.subscribe` events (debounced 50 ms) and on query change (debounced 150 ms).

- [ ] **Step 1:** Replace in-memory filter with `useNotes` (FTS). Tag filter chip row from `allTags()` (horizontal scroll, "All" first). Sort menu via `ActionSheet` (Newest, Oldest, Longest, Title).
- [ ] **Step 2:** `SwipeableRow` per card: swipe right = pin/unpin, swipe left = delete. Delete removes immediately with toast "Note deleted" + **Undo** (calls `restoreNote`); after toast expires, `purgeNoteFiles`. Long-press opens `ActionSheet` (Pin, Share as text, Export…, Delete).
- [ ] **Step 3:** Card shows: enhancement badge (`Enhancing 42%` when `running`), summary first line instead of raw snippet when `summary` exists, imported-note icon when `source==='import'`, duration chip hidden for duration 0.
- [ ] **Step 4:** Empty states: no notes → CTA buttons "Record a note" (switches tab) and "Import notes"; no search results → "No notes match 'q'".
- [ ] **Step 5:** Manual device check: pin via swipe, delete + undo restores with audio intact. Commit `feat: notes list with FTS search, tag filter, swipe actions, undo`.

### Task 6: Note detail overhaul and record-screen hardening

**Files:** Modify `app/note/[id].tsx`, `app/(tabs)/index.tsx`; Create `services/waveform.ts` (pure `computePeaks(pcm: Float32Array, buckets: number): number[]`), `hooks/useNote.ts`; Delete `services/storageService.ts`
- Test: `__tests__/waveform.test.ts`

- [ ] **Step 1: Failing tests:** `computePeaks(new Float32Array([0, .5, -1, .25]), 2)` → `[0.5, 1]`; `computePeaks(new Float32Array(0), 4)` → `[0,0,0,0]`; result length always equals `buckets`; values in [0,1].
- [ ] **Step 2:** Run FAIL → implement (max abs per bucket) → PASS.
- [ ] **Step 3:** `useNote(id)`: loads note + timeline, re-loads on `subscribe` events for that id, **without clobbering fields the user is editing** (only apply incoming `transcription`/`title` if the local field isn't dirty). This fixes the stale-title bug.
- [ ] **Step 4:** Detail layout: title (auto-title sparkle icon when `titleIsAuto`; tap "Regenerate title"), meta line, real waveform player (peaks computed once from the WAV via `decodeToPcm`, cached in sidecar `timelines/<id>.peaks.json`; tap/drag on waveform seeks; 0.75×/1×/1.5×/2× speed chip; skip ±15 s), `SegmentedControl` Summary | Transcript (Summary tab only when summary exists or can be generated), tags, Transcript in listen/edit modes as today. Bottom bar: Share (opens export sheet, Task 10), Summarize (Task 9), More (Delete, Duplicate). Keyboard-aware scroll. Autosave via `updateNote` (no CAS for user edits).
- [ ] **Step 5:** Record screen: brand styling; on Save → `router.push('/note/<id>')` and enqueue enhancement (Task 8 replaces the inline `runTimelinePass`; until then keep calling it but move it out of the session component into `services/ai/enhanceQueue.ts` stub). Interruptions: enable `AudioManager.observeAudioInterruptions(true)` and listen for `interruption` events; on `began` while recording → stop, auto-save the note, toast "Recording stopped by an interruption. Saved." Keep recording when the app backgrounds (iOS background audio already configured); show elapsed time on return. Add a "Discard" confirmation when leaving the tab with an unsaved transcript.
- [ ] **Step 6:** Delete `services/storageService.ts`; move SRT/text generators into Task 10's `services/export/generators.ts` (create it now with the existing `formatSrtTimestamp`, `usableSegments`, `toText`, `toSrt` moved verbatim). `yarn typecheck && yarn test` → PASS. Device check: record → save → land on note → title updates live when pass finishes. Commit `feat: note detail player, live refresh, record interruptions`.

## Phase 2 — On-device AI

### Task 7: Device tiers, engine choice, model manager

**Files:** Create `services/ai/tiers.ts` (pure), `services/ai/modelCatalog.ts` (pure data), `services/ai/modelManager.ts`; Modify `app/models.tsx`
- Test: `__tests__/ai/tiers.test.ts`

**Interfaces:**
- `type DeviceTier = 'flagship' | 'standard' | 'lite'`
- `resolveTier(d: { totalMemoryBytes: number | null; abis: string[]; platform: 'ios' | 'android' }): DeviceTier`. Thresholds in GiB: `≥ 7.0` flagship, `≥ 5.0` standard, else lite (marketed 8 GB → reports ~7.3; 6 GB → ~5.5). Android without `arm64-v8a` → lite. `null` memory → standard.
- `type EngineId = 'whisper-large-v3-turbo' | 'whisper-small' | 'whisper-base-en'`; `type LlmId = 'qwen3-1.7b' | 'qwen3-0.6b'`
- `chooseEngine(a: { tier: DeviceTier; isPro: boolean; override: DeviceTier | null; failedEngines: EngineId[] }): EngineId` — free → base; pro flagship → turbo; pro standard → small; lite → base; an engine in `failedEngines` falls back one step (turbo→small→base).
- `chooseLlm(tier): LlmId` — flagship → 1.7b, else 0.6b. Both via `models.llm.qwen3_*({ quant: true })`.
- `MODEL_CATALOG`: turbo = `{ url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin', fileName: 'ggml-large-v3-turbo-q5_0.bin', approxBytes: 574_000_000 }`. Executorch models (small, base, LLMs) are fetched by the library; catalog stores display name and approx size only.
- `modelManager`: `status(id): Promise<'absent' | 'downloading' | 'ready'>`, `download(id, onProgress: (fraction) => void): Promise<void>` (uses `@kesha-antonov/react-native-background-downloader` into `Paths.document/models/<file>.part`, renames to final name only after `isDownloadComplete(bytesWritten, contentLength)`), `remove(id)`, `diskUsage(): Promise<Record<string, number>>`. Pure helper `isDownloadComplete(written: number, expected: number | null): boolean` — true only when `expected` known and `written === expected`.

- [ ] **Step 1: Failing tests** (`tiers.test.ts`):
  - `resolveTier({ totalMemoryBytes: 7.3 * 2**30, abis: ['arm64-v8a'], platform: 'android' })` → `'flagship'` (Review Focus 1)
  - 11.2 GiB → flagship; 5.5 GiB → standard; 3.6 GiB → lite; `null` → standard; android `['armeabi-v7a']` with 12 GiB → lite
  - `chooseEngine({ tier:'flagship', isPro:false, override:null, failedEngines:[] })` → `'whisper-base-en'`
  - pro flagship → turbo; pro flagship with `failedEngines:['whisper-large-v3-turbo']` → small; pro with `override:'lite'` → base
  - `isDownloadComplete(10, 10)` true; `(9, 10)` false; `(10, null)` false (Review Focus 4)
- [ ] **Step 2:** Run FAIL → implement → PASS.
- [ ] **Step 3:** `npx expo install expo-device`. `app/models.tsx`: shows tier ("Your phone: Flagship"), active engine + LLM, each model's state (Ready / Download 550 MB / Downloading 37% / Remove), total disk usage, tier override picker. Free users see turbo/small rows with a Pro lock that opens paywall.
- [ ] **Step 4:** Commit `feat: device tiers, engine selection, model manager`.

### Task 8: Enhancement engines and persistent queue

**Files:** Create `services/ai/engines/types.ts`, `services/ai/engines/whisperRnEngine.ts`, `services/ai/engines/executorchEngine.ts`, `services/ai/segments.ts` (pure), `services/ai/enhanceQueue.ts`, `services/ai/jobState.ts` (pure); Modify `services/transcriptionTimeline.ts`, `app/_layout.tsx`
- Test: `__tests__/ai/segments.test.ts`, `__tests__/ai/jobState.test.ts`

**Interfaces:**
- `interface TranscriptionEngine { id: EngineId; transcribeFile(uri: string, o: { language: string; onProgress(f: number): void; signal: AbortSignal }): Promise<Timeline | null>; release(): Promise<void> }` (`Timeline` from `services/transcriptionTimeline.ts`)
- `whisperRnEngine`: `initWhisper({ filePath })` (GPU default on iOS), `context.transcribe(uri, { language: lang === 'auto' ? 'auto' : lang, tokenTimestamps: true, maxLen: 1, splitOnWord: true, onProgress })`; result segments are per-word with `t0/t1` in centiseconds → words; then `groupWordsIntoSegments`. Abort → call returned `stop()`. Throw `EngineLoadError` if init fails (queue records it in `failedEngines` setting).
- `executorchEngine(model: 'small' | 'base')`: legacy `SpeechToTextModule` instance, `transcribe(pcm, { verbose: true, language? })` (language only for multilingual small); progress reported as indeterminate (`onProgress(-1)`).
- `groupWordsIntoSegments(words: TranscriptWord[], o?: { maxGapSec?: number /*0.8*/; maxChars?: number /*84*/ }): TranscriptSegment[]` — new segment on gap > maxGap, on sentence-ending punctuation, or when text would exceed maxChars.
- `jobState.ts`: `type Job = { noteId: string; kind: 'enhance' | 'summarize'; state: 'pending' | 'running' | 'failed'; attempts: number }`; `recoverJobs(jobs: Job[]): Job[]` (running → pending; drop jobs with attempts ≥ 3 → failed); `nextJob(jobs): Job | null` (enhance before summarize, FIFO).
- `enhanceQueue`: `enqueue(noteId, kind)`, `cancel(noteId)`, `start()` on app launch (calls `recoverJobs`), persists jobs in SQLite table `jobs`. On completion: `updateNote(id, { transcription, title?, enhancement:'done', language }, { expectUpdatedAt: noteUpdatedAtWhenJobStarted })`; if CAS fails, keep the user's text and drop the timeline (existing rule), mark `done`. Writes timeline sidecar only on success. Updates `enhancementProgress` at most every 1 s. After enhance, if `autoSummarize` and quota allows → enqueue summarize. Releases engine after the queue drains.

- [ ] **Step 1: Failing tests:**
  - `groupWordsIntoSegments` with words `Hello(0-0.4) world.(0.5-0.9) Next(2.0-2.3)` → 2 segments: `"Hello world."` 0–0.9, `"Next"` 2.0–2.3.
  - long run of 30 short words with no gaps → every segment `text.length ≤ 84`.
  - empty input → `[]`.
  - `recoverJobs([{state:'running', attempts:1,…}])` → state `pending` (Review Focus 2); attempts 3 → `failed`.
  - `nextJob` returns enhance job before an earlier-queued summarize job.
- [ ] **Step 2:** Run FAIL → implement pure modules → PASS.
- [ ] **Step 3:** `npx expo install whisper.rn` (pin exact). Implement engines + queue. Remove `runTimelinePass` from the record screen; Save enqueues `enhance`.
- [ ] **Step 4:** Note detail shows a progress bar "Enhancing transcript with Large-v3… 42%" with Cancel; language label after completion. For non-English language settings, the Record screen shows a hint "Live preview is English-only; the final transcript uses your language."
- [ ] **Step 5:** Device check on S23 Ultra: 5-min recording enhances with turbo; kill app mid-pass → relaunch resumes. Write measured realtime factor into the README. Commit `feat: Large-v3-Turbo final pass with persistent queue`.

### Task 9: Summaries and AI titles

**Files:** Create `services/ai/prompts.ts` (pure), `services/ai/summaryParser.ts` (pure), `services/ai/summarizer.ts`, `services/billing/quota.ts` (pure)
- Test: `__tests__/ai/summaryParser.test.ts`, `__tests__/ai/prompts.test.ts`, `__tests__/billing/quota.test.ts`

**Interfaces:**
- `chunkTranscript(text: string, maxChars = 4000): string[]` — splits on sentence boundaries; no chunk exceeds maxChars unless a single sentence does.
- `buildSummaryMessages(chunk: string, mode: 'single' | 'partial'): Message[]`; `buildMergeMessages(partials: string[]): Message[]`; `buildTitleMessages(text: string): Message[]`. System prompt ends with `/no_think`. Output contract: markdown headings `## Title`, `## Summary`, `## Key points`, `## Action items`, `## Decisions`, bullets with `- `; "None" when empty.
- `parseSummaryResponse(raw: string, model: string, now: Date): { title: string | null; summary: NoteSummary }` — strips `<think>…</think>`, case-insensitive headings, drops "None" bullets, title trimmed to 60 chars without trailing punctuation/quotes.
- `fallbackTitle(text: string): string` — first sentence ≤ 60 chars, else first 57 chars + `…`; empty → `Note — <MMM d, HH:mm>`.
- `summarizer.summarize(noteId): Promise<void>` — loads LLM via legacy `LLMModule` with `chooseLlm(tier)`, map-reduce over chunks, `updateNote(id, { summary, ...(note.titleIsAuto && title ? { title } : {}) })`; never overwrites a user-edited title (`titleIsAuto === false`). `generateTitle(noteId)` for the regenerate button (free).
- `quota.ts`: `FREE_SUMMARIES_PER_WEEK = 3`; `summaryAllowance(log: string[], now: Date, isPro: boolean): { allowed: boolean; remaining: number | 'unlimited'; resetsAt: Date | null }` — rolling 7 × 24 h window.

- [ ] **Step 1: Failing tests:**
  - parser: full well-formed response → all fields; response wrapped in `<think>…</think>` → same result (Review Focus 5); no headings at all (`"The team agreed to ship Friday."`) → `overview` equals the trimmed text, lists empty, `title: null`; empty string → overview `''` and parse doesn't throw; `- None` bullets dropped; title `"\"Q3 Planning.\""` → `Q3 Planning`.
  - `chunkTranscript` of 10 000 chars of sentences → every chunk ≤ 4000, joined chunks equal input modulo whitespace.
  - `fallbackTitle('Ship it. Then rest.')` → `'Ship it.'`.
  - quota: 3 entries within last 7 days, free → `allowed:false, remaining:0`, `resetsAt` = oldest + 7 d; entries 8 days old ignored; pro → `remaining:'unlimited'`.
- [ ] **Step 2:** Run FAIL → implement → PASS.
- [ ] **Step 3:** Wire: Summarize button (free users see "2 of 3 free summaries left this week"; at 0 → paywall). Summary tab renders sections with copy buttons and a "Share summary" action. Streaming token display while generating (the `LLMModule` token callback) with Stop. The LLM unloads after 60 s idle.
- [ ] **Step 4:** Commit `feat: on-device meeting summaries and AI titles`.

## Phase 3 — Sharing and import

### Task 10: Export and backup

**Files:** Modify `services/export/generators.ts`; Create `services/export/pdfTemplate.ts` (pure), `services/export/exporter.ts`, `components/ExportSheet.tsx`
- Test: `__tests__/export/generators.test.ts`

**Interfaces:**
- `type ExportFormat = 'pdf' | 'md' | 'txt' | 'srt' | 'audio'`; `type ExportScope = 'summary' | 'full'`
- `toMarkdown(note, o: { scope; segments: TranscriptSegment[] | null; timestamps: boolean }): string` — YAML front matter (`title`, `date` ISO, `duration`, `tags`, `source: WhisprNotes`), `# Title`, summary sections, `## Transcript` (with `[mm:ss]` paragraph stamps when `timestamps` and segments exist).
- `toText(note, o: { scope }): string`; `toSrt(note, segments)` (existing behaviour).
- `buildPdfHtml(note, o: { scope; segments; timestamps }): string` — self-contained HTML (inline CSS, inline SVG logo, no remote URLs), A4, header with logo + title + date/duration, summary sections, transcript, footer "Transcribed on-device with WhisprNotes". All note text HTML-escaped.
- `exporter.exportNote(note, format, scope): Promise<string /* file uri */>` then `share(uri, mime)`; `audio` shares the WAV with a filename from the title (`slugify(title).wav`) and shows size in the sheet. `exporter.backupAll(): Promise<string>` — zip (jszip) of `<slug>.md` per note, sharing `whisprnotes-backup-YYYY-MM-DD.zip`.
- `ExportSheet`: format grid (PDF, Markdown, Text, Subtitles, Audio) with Pro locks per Global Constraints; scope toggle (Summary only / Summary + transcript) when a summary exists; timestamps toggle.

- [ ] **Step 1: Failing tests:** `toMarkdown` front matter contains `title: "Q3 \"plan\""` properly escaped; tags list; timestamps on → contains `[01:05]` for a segment at 65 s; `buildPdfHtml` escapes `<script>` in transcript to `&lt;script&gt;`, contains no `http` substring except none (assert `!/https?:\/\//.test(html)`); `slugify('Q3: Plan / Review!')` → `q3-plan-review`; `slugify('')` → `note`.
- [ ] **Step 2:** FAIL → implement → PASS. `npx expo install expo-print jszip`.
- [ ] **Step 3:** Wire ExportSheet into note detail and the notes long-press menu; "Back up all notes" in Settings (Pro). Success → `haptic('success')`. Commit `feat: PDF/Markdown/text/SRT/audio export and backup`.

### Task 11: Import

**Files:** Create `services/import/parsers.ts` (pure), `services/import/importer.ts`, `app/import.tsx` (modal report screen); Modify `app.json` (document types), `app/_layout.tsx` (incoming file URL handling)
- Test: `__tests__/import/parsers.test.ts`

**Interfaces:**
- `type ImportedNote = { title: string; body: string; tags: string[]; createdAt: Date | null; updatedAt: Date | null }`
- `parseMarkdown(fileName: string, content: string): ImportedNote` — strip BOM, normalize CRLF; front matter (`title`, `tags` list or comma string, `date`/`created`/`updated`); title fallback order: front matter → first `# ` heading (removed from body) → file name without extension; inline `#tags` (not inside code, not headings) added to tags.
- `parseText(fileName, content): ImportedNote` — title = first non-empty line if ≤ 80 chars (removed from body), else file name.
- `parseEnex(xml: string): ImportedNote[]` — fast-xml-parser; ENML → text via `enmlToText(html)` (block tags → newlines, `<li>` → `- `, entities decoded, tags stripped).
- `contentHash(title, body): string` — stable FNV-1a hex over normalized whitespace.
- `importer.importFiles(assets: { uri: string; name: string; mimeType?: string }[]): Promise<ImportReport>`; `type ImportReport = { imported: number; duplicates: number; failed: { name: string; reason: string }[] }`. Handles `.md`, `.markdown`, `.txt`, `.enex`, `.zip` (walks entries, ignores `__MACOSX/`, non-text files). Notion export file names `Title 1a2b3c….md` → strip the trailing 32-hex id. Skips notes whose hash exists. Imported notes: `source:'import'`, `audioUri:null`, `duration:0`, `titleIsAuto:false`. One transaction per file batch.

- [ ] **Step 1: Failing tests:**
  - md with front matter `title: Standup\ntags: [work, team]\ndate: 2025-03-01` → title, tags, createdAt
  - md without front matter, `# Heading\nbody #idea` → title `Heading`, body without heading, tags `['idea']`
  - `﻿` BOM + CRLF content parses same as clean LF
  - empty `.md` → title from file name, body `''`
  - `parseText('x.txt', 'Groceries\nmilk')` → title `Groceries`, body `milk`
  - ENEX with two `<note>` elements → 2 notes; `<div>a</div><div>b</div>` → `a\nb`; `&amp;` decoded
  - `notionTitle('Weekly sync 3f2a9c0b1d2e4f5a6b7c8d9e0f1a2b3c.md')` → `Weekly sync`
  - `contentHash` equal for bodies differing only in trailing whitespace
- [ ] **Step 2:** FAIL → implement → PASS. `npx expo install expo-document-picker fast-xml-parser`.
- [ ] **Step 3:** Settings → "Import notes" opens `getDocumentAsync({ multiple: true, type: ['text/*', 'application/zip', 'application/xml', '*/*'] })`, runs importer, shows `app/import.tsx` report (counts, failures with reasons, "View notes" button). Pro-gated.
- [ ] **Step 4:** "Open in WhisprNotes": iOS `CFBundleDocumentTypes` + `LSSupportsOpeningDocumentsInPlace: false` for `public.plain-text`, `net.daringfireball.markdown`, `public.zip-archive`; Android intent-filter `VIEW` for `text/plain`, `text/markdown`, `application/zip` (file + content schemes). Root layout handles the initial/incoming URL by routing to `/import?uri=…`. Commit `feat: import from md, txt, Evernote, Notion/Obsidian zip`.

## Phase 4 — Insights

### Task 12: Insights screen

**Files:** Create `services/insights/stats.ts` (pure), `components/charts/BarChart.tsx`, `components/charts/HourHeatmap.tsx`; Modify `app/(tabs)/insights.tsx`
- Test: `__tests__/insights/stats.test.ts`

**Interfaces:** `computeInsights(notes: Note[], now: Date): Insights` where `Insights = { totalNotes; recordedNotes; totalMinutes; totalWords; avgWordsPerMinute: number | null; currentStreak; longestStreak; last14Days: { date: string /* YYYY-MM-DD local */; minutes: number; notes: number }[]; byHour: number[] /* 24 */; topTags: { tag; count }[] /* ≤5 */; summariesGenerated }`. Streaks count local calendar days with ≥1 recorded note; current streak alive if last recording was today or yesterday. WPM ignores notes with `duration < 5` and imported notes.

- [ ] **Step 1: Failing tests:** empty → zeros and `avgWordsPerMinute: null`; notes on today, yesterday, 2 days ago → current 3; notes today and 3 days ago → current 1, longest 1; imported 0-duration note excluded from WPM and minutes; `last14Days` length 14 ending today; a note at 23:30 local counts for that day (construct dates with local `new Date(y, m, d, 23, 30)`).
- [ ] **Step 2:** FAIL → implement → PASS. `npx expo install react-native-svg`.
- [ ] **Step 3:** Screen: hero stat row (minutes recorded, words, streak with flame), 14-day bar chart (tap a bar → tooltip with date/minutes, `haptic('selection')`), time-of-day heatmap, top tags (tap → Notes filtered by tag), "Time saved" estimate (words ÷ 40 wpm typing − minutes recorded, floor 0). Free users see the first stat row and a blurred, locked remainder with "Unlock Insights". Footer: "Calculated on this phone. Never sent anywhere." Commit `feat: on-device insights with charts`.

## Phase 5 — Business, trust, brand

### Task 13: Purchases and paywall

**Files:** Create `services/billing/purchases.ts`, `hooks/usePro.ts`; Modify `app/paywall.tsx`, `app.json` (`extra.revenueCat.iosKey`, `extra.revenueCat.androidKey` placeholders `""`)

**Interfaces:** `initPurchases(): Promise<void>` (no-op + warning when key empty); `usePro(): { isPro: boolean; loading: boolean; offerings: PurchasesOffering | null; purchase(pkg): Promise<boolean>; restore(): Promise<boolean> }`. Entitlement `pro`. `isPro` cached in settings (`proCache: { isPro, checkedAt }`) and used when offline. `__DEV__` only: Settings → "Developer: toggle Pro" for testing without store setup.

- [ ] **Step 1:** `npx expo install react-native-purchases`. Implement. `Purchases.configure({ apiKey })` without passing any app user id (anonymous).
- [ ] **Step 2:** Paywall: logo, headline "Your meetings, perfectly captured. Privately.", 5 benefit rows matching Pro list, plan cards (Yearly preselected with "Save X%" computed from offering prices, Monthly, Lifetime), trial text from offering, Continue, Restore, Terms + Privacy links, "Cancel anytime in your store settings". Success → confetti-free `haptic('success')`, toast "Welcome to Pro", dismiss.
- [ ] **Step 3:** Gate every Pro surface through `usePro()` (Tasks 7, 9, 10, 11, 12). Device check with `__DEV__` toggle. Commit `feat: RevenueCat purchases and paywall`.

### Task 14: Onboarding, legal content, Your data

**Files:** Create `content/legal/privacy.md`, `content/legal/terms.md`, `content/legal/data.md`, `content/legal/index.ts` (exports strings), `components/Markdown.tsx` + `services/markdown.ts` (pure tokenizer); Modify `app/onboarding.tsx`, `app/legal/[doc].tsx`, `docs/legal/README.md` ("not legal advice — have reviewed")
- Test: `__tests__/markdown.test.ts`

- [ ] **Step 1: Failing tests:** `tokenizeMarkdown('# A\n\npara **b**\n- x\n- y')` → `[{type:'h1',text:'A'},{type:'p',spans:[…bold b…]},{type:'list',items:['x','y']}]`; links `[t](https://x)` → link span.
- [ ] **Step 2:** FAIL → implement (h1–h3, paragraphs, bold, italic, links, bullet lists only) → PASS.
- [ ] **Step 3:** Write legal docs (effective date 2026-11-12; controller = owner as individual; contact `mdhamed.off@gmail.com`):
  - Privacy: data stays on device; what is stored (audio, transcripts, summaries, tags, settings, stats) and where (app sandbox); network uses: model downloads from Hugging Face (receives IP + standard request headers, no user content), purchases via Apple/Google + RevenueCat (anonymous app user id, purchase receipts); no analytics, no ads, no tracking, no account; backups: OS device backups (iCloud/Google) may include app data per the user's OS settings; deletion via Delete all data or uninstall; children; changes; contact.
  - Terms: license, subscriptions/auto-renew/trials per store terms, refunds via the stores, acceptable use (recording consent laws are the user's responsibility — prominent), AI output may be inaccurate, no warranty, limitation of liability, termination, governing law = owner's country of residence (placeholder line to confirm), Apple EULA reference.
  - Your data: a plain table of each data type → where stored → leaves device? (all "No" except the two network rows).
- [ ] **Step 4:** Onboarding (4 swipeable pages with page dots, haptic per page): (1) "Speak. It's written." value prop with animated waveform; (2) "Your voice never leaves this phone." privacy; (3) "Models install once." tier, sizes to download now ("Base 150 MB now; Large-v3 550 MB when you go Pro"), Wi-Fi recommendation, "WhisprNotes uses the internet only for these downloads and for purchases."; (4) mic permission with "Allow microphone" → sets `onboardingCompleted`. Recording consent note: "Make sure everyone agrees to be recorded."
- [ ] **Step 5:** Commit `feat: onboarding, privacy policy, terms, your-data screen`.

### Task 15: Brand assets

**Files:** Create `assets/brand/logo.svg`, `assets/brand/mark.svg` (page + waveform without tile), `scripts/generate-icons.mjs`, `components/brand/LogoMark.tsx`; Regenerate `assets/images/icon.png`, `adaptive-icon.png`, `adaptive-icon-monochrome.png`, `splash-icon.png`, `favicon.png`; Modify `app.json`

- [ ] **Step 1:** SVG from Direction B (100-unit box): tile `#FF6A4D` rx 22; page path `M35 20 H59 L73 34 V73 a7 7 0 0 1 -7 7 H35 a7 7 0 0 1 -7 -7 V27 a7 7 0 0 1 7 -7 Z` white; fold `M59 20 V29 a5 5 0 0 0 5 5 H73 Z` `#FFC9BB`; text line rect `x36 y40 w18 h4.5 rx2.25` `#2A1D3A`; bars at x 38/44/50/56/62, heights 8/18/12/22/10, width 4, centered y 60, `#FF6A4D`.
- [ ] **Step 2:** `scripts/generate-icons.mjs` (devDep `sharp`): icon.png 1024 full-bleed square (iOS masks corners; no rx), adaptive foreground 1024 transparent with mark scaled to 66% safe zone, monochrome white mark, splash-icon 512 mark, favicon 48. Run `node scripts/generate-icons.mjs` → files exist with correct dimensions (`sips -g pixelWidth`).
- [ ] **Step 3:** `app.json`: `android.adaptiveIcon.backgroundColor` `#FF6A4D`, `monochromeImage`; splash background coral light / ink dark (`expo-splash-screen` plugin `dark` config). `LogoMark` (react-native-svg) used on onboarding, paywall, Settings About, empty states. Commit `feat: WhisprNotes logo, app icon and splash`.

### Task 16: Website on Vercel

**Files:** Create `website/` — `build.mjs` (devDep `marked`; renders `content/legal/*.md` into pages), `src/index.html`, `src/support.html`, `src/styles.css`, `src/logo.svg`, output `website/dist/`, `website/vercel.json` (`cleanUrls: true`)

- [ ] **Step 1:** Landing: logo, headline, 3 feature blocks (On-device Large-v3, Meeting summaries, Private by design), "How privacy works" section mirroring the Your-data table, pricing summary, store badges as "Coming soon" text, footer links Privacy / Terms / Support, contact email as text. Responsive, light/dark, no third-party scripts or trackers.
- [ ] **Step 2:** `node website/build.mjs` → `dist/index.html`, `dist/privacy.html`, `dist/terms.html`, `dist/support.html`. Open locally to check.
- [ ] **Step 3:** Deploy `website/dist` to Vercel (production, default `*.vercel.app` domain). Put the resulting Privacy/Terms URLs into `content/legal/index.ts` (`LEGAL_URLS`) for paywall/store links. Commit `feat: marketing and legal website`.

### Task 17: Docs and final verification

**Files:** Modify `README.md`; Create `docs/store/listing.md` (App Store + Play: name, subtitle ≤30 chars, promo text, description, keywords ≤100 chars, privacy label answers "Data Not Collected", Play Data safety answers, screenshot shot list); Delete `app-improvements.md` content that is now done (keep as history section in README instead).

- [ ] **Step 1:** README: WhisprNotes overview, tiers table, measured performance from Task 8, architecture (repo, queue, engines, summarizer), setup (`yarn`, dev client), RevenueCat setup steps, store checklist (individual accounts, EU trader info, Play 12-tester/14-day closed test).
- [ ] **Step 2:** `yarn typecheck && yarn test` → all PASS. `npx expo prebuild --clean --no-install` succeeds for both platforms (then discard generated dirs; they're gitignored).
- [ ] **Step 3:** Device smoke list on Android flagship: onboarding → record 1 min → save → enhance (turbo) → summarize → export PDF → share audio → import a `.md` → insights → paywall (dev toggle) → delete all data. Record results in the PR description.
- [ ] **Step 4:** Commit `docs: README and store listing`.
