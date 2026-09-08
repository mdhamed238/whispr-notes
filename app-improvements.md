# whispr-notes — Areas of Improvement (audited)

**App:** Expo SDK 54 / React Native 0.81, on-device Whisper via `react-native-executorch` 0.9.3, offline inference, real-time streaming transcription, local history, export to txt/json/srt.

**Audit basis:** every claim below was checked against the source at `main` (ea4568f) on 2026-09-08, and against the `react-native-executorch` v0.9.3 API read from the library's tagged GitHub source (`node_modules` is not installed locally, so library facts cite upstream paths, not local ones).

**Legend:** ✅ implemented · 🟡 partial · ❌ absent · ⚠️ premise wrong / claim removed

---

## 0. "Reportedly already implemented" — all confirmed ✅

Every Section 0 claim from the previous draft is correct. Sourced below so it doesn't need re-litigating.

| Claim | Verdict | Evidence |
|---|---|---|
| Whisper **Base**, not Tiny | ✅ | `app/(tabs)/index.tsx:127` — `model: models.speech_to_text.whisper_base_en()`. The legacy `whisper-tiny` config was deleted in commit `c5a1391`. |
| **FSMN VAD** gating inference | ✅ | `app/(tabs)/index.tsx:126` — `vad: models.vad.fsmn_vad()`; consumed at `:265` — `model.stream({ useVAD: true, vadDetectionMargin: 300 })`. The RMS loop at `:210-214` is a UI level meter only, not a gate. |
| **Editable transcripts** | ✅ | `app/note/[id].tsx:293-299` (transcript `TextInput`), `:250-257` (title). Debounced 800 ms autosave `:100-108`, flushed on every dismissal path via `beforeRemove` `:116-122` and unmount `:126-131`. |
| **Tagging** | ✅ | Model `types/index.ts:11`; add/remove `app/note/[id].tsx:150-166`; chips `:270-290`; shown on cards `app/(tabs)/notes.tsx:325-332`; included in txt/json export `services/storageService.ts:199,219`. |
| **Full-text search** | ✅ | `app/(tabs)/notes.tsx:103-112` — case-insensitive `includes()` over title + transcript + tags, in memory. |
| Multilingual `decode` bug | ✅ documented | `app/(tabs)/index.tsx:116-124` and `README.md:110`. |

**Two corrections to how Section 0 framed these:**

- *"restore the language picker"* — no language picker ever existed. `git log --all -S` finds only the removal of an unused legacy `language: string` settings field (`126b1fc`) and a dead `TRANSCRIPTION_CONFIG.LANGUAGE` constant (`c5a1391`). The multilingual attempt was never committed, so there is no diff to revert to and no reproduction to run. Re-doing it is a fresh implementation, not a revert.
- Tagging is **write-only from the detail screen**. The record screen always saves `tags: []` (`app/(tabs)/index.tsx:353`), and there is no tag-filter or tag-browse UI — tags are only reachable through free-text search.

---

## 1. Architecture & engineering quality

### 1.1 Lockfile drift — the app does not install ❌ *(not in the original draft; highest ROI in this document)*

`package.json:35` and `yarn.lock:4418` both specify `react-native-executorch@0.9.3`. `package-lock.json:32` still pins `^0.5.12`, and its resolved tree carries Expo 53 transitives against an Expo 54 app.

The README's setup instructions say `npm install` (`README.md:66`). Following them installs 0.5.12, which predates the VAD streaming API introduced in 0.9.0 — `models.vad.fsmn_vad()` and `stream({ useVAD })` do not exist there, so `app/(tabs)/index.tsx` fails at runtime. Both lockfiles are committed, so the repo also has no single source of truth for a CI cache key.

- **ROI:** impact **high** (repo is un-runnable for anyone following the README; blocks any CI work), effort **trivial**.
- **Fix:** pick one package manager, delete the other lockfile, regenerate, and align the README.

### 1.2 Migrate AsyncStorage → SQLite 🟡 *(justification upgraded)*

Current state: `services/storageService.ts` is the only persistence layer (`AsyncStorage`, key `transcriptions`, `constants/config.ts:15`). No `expo-sqlite`, no MMKV.

The draft justified this as "a must-do once note count grows past ~100". The stronger argument is **correctness, not scale**: every mutation is a read-modify-write of the entire array (`:25-32`, `:85-100`, `:109-117`) with no transaction and no concurrency guard. The note-detail autosave (`app/note/[id].tsx:87`) and the list screen's pin toggle (`app/(tabs)/notes.tsx:132`) can interleave and silently drop a write today, at any note count. Secondary: `getNotes()` parses and re-dates all notes on every screen focus (`notes.tsx:78` via `useFocusEffect`), capped at 1000 (`config.ts:20`).

- **ROI:** impact **high**, effort **medium**. Feasibility **high** — 10 call sites across 3 files, all behind the `storageService` singleton (`index.tsx:359`; `notes.tsx:78,132,152,167,168`; `note/[id].tsx:67,87,182,196,197`). The interface in `types/index.ts:27-34` can be kept verbatim, so the swap is one file plus a migration read of the old key.
- **Decide before starting:** `expo-sqlite` has **no encryption**. If §3.2 (encryption at rest) matters, the driver choice is `op-sqlite` + SQLCipher, and that decision is cheap now and expensive later.
- Full-text search then becomes FTS5 rather than an `Array.filter`, which is what makes the migration worth writing up.

### 1.3 Background / lock-screen recording 🟡

More is in place than the draft assumed — and less works than the config implies.

Present: `UIBackgroundModes: ["audio"]` (`app.json:20-23`); Android `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (`app.json:36-43`); the `react-native-audio-api` plugin with `iosBackgroundMode: true`, `androidForegroundService: true`, `androidFSTypes: ["mediaPlayback","microphone"]` (`app.json:53-71`); and an audio session configured `playAndRecord` / `spokenAudio` (`app/(tabs)/index.tsx:198-202`).

Absent: any `AppState` handling, interruption observers (call, Siri, another app taking the session), lock-screen/now-playing metadata, or explicit foreground-service lifecycle. Nothing keeps the `for await` stream loop (`index.tsx:266-272`) or the `useSpeechToText` model alive across a background transition, and nothing recovers them on return. The `/ios` and `/android` dirs are gitignored, so the generated Info.plist/manifest can't be inspected from the repo.

- **Note:** `app.json:21-23` lists `"audio"` **twice** in `UIBackgroundModes`. Harmless, but it is the kind of thing a reviewer notices.
- **ROI:** impact **high** (the real UX gap for a voice-notes app), effort **high**, feasibility **medium** — sustained *ExecuTorch inference* in the background is the risky part, not audio capture.
- **Do the cheap experiment first:** on device, start a recording, background the app, and see how far it actually gets. The answer decides whether this is "wire up AppState + a foreground service" (days) or "buffer audio in the background and transcribe on return" (a different feature). Scope only after that.

### 1.4 CI pipeline + unit tests ❌

No `.github/`, no workflow YAML anywhere, no `*.test.*` / `*.spec.*` / `__tests__`, no jest config, no `test` script (`package.json:5-10`). `react-test-renderer` sits in devDependencies (`:44`) unused, left over from the Expo template. The README concedes both (`:115`, `:119`).

- **ROI:** impact **high** for a portfolio repo, effort **low-medium**. Feasibility **high**: the highest-value logic is already pure and device-free —
  - `services/wavEncoder.ts:32-57` `buildWavHeader` (byte-exact RIFF assertions) and `:192-194` `computeDurationSeconds`;
  - `services/storageService.ts:13-20` `formatSrtTimestamp` (this is where the real `00:00:125,000` bug lived, `:227-229`), `:64-81` `normalizeNote` legacy-shape handling, and the three `generate*Export` methods `:191-233`.
- Fix §1.1 first — CI can't install the project until the lockfile is coherent.

### 1.5 Benchmark writeup ❌

No benchmark scripts, no instrumentation, no timing around `stream()`/`streamInsert`. The perf rationale in `services/wavEncoder.ts:1-23` ("~4.8M boxed doubles", "~12.8M-character base64") is reasoned estimation, not measurement — which is exactly the gap a writeup would close.

- **ROI:** impact **high** (this is the artifact that demonstrates systems judgement), effort **medium**, feasibility **high**. `SpeechToTextModule` exposes `encode()` and `decode()` publicly, and `transcribe()` returns `duration` — enough to measure without touching native code.
- **Must be split per platform:** iOS loads a CoreML fp16 `.pte` and Android an XNNPACK fp32 one (`WHISPER_BASE_EN.modelSource` branches on `Platform.OS` in the library's `constants/modelUrls.ts`). A single blended number would be meaningless. It also means the README's "CPU-only inference" limitation (`:111`) is correct *for Android only*.

---

## 2. Model & ML

### 2.1 Profile inference cadence ⚠️ *(premise corrected — still the cheapest win)*

The draft said "current chunking may be aggressive — test increasing to 300–500 ms". That targets the wrong knob. Two separate parameters exist:

- **Capture buffer** — `bufferLengthInSamples: 16000 * 0.1` = 100 ms (`app/(tabs)/index.tsx:107`). Raising it reduces JS-bridge wakeups and RMS/WAV-write calls, but does **not** change how often the model runs.
- **Inference cadence** — `StreamingOptions.timeout`, "how long the streamer waits between model inferences", default **100 ms**. The app never passes it (`index.tsx:265` sets only `useVAD` and `vadDetectionMargin`), so it is running at the most aggressive setting available.

So the actual experiment is: pass `timeout: 300` (then 500) to `stream()` and measure CPU/battery against perceived latency. `vadDetectionMargin` is already deliberately tuned down to 300 ms from the library's 500 ms default (`:261-264`) and trades commit latency, not CPU — leave it alone while varying `timeout`.

- **ROI:** impact **medium**, effort **trivial** (a one-line change per run). Highest information-per-minute item in the document. Do it as part of §1.5 so the numbers land in the writeup.

### 2.2 `verbose: true` → real timestamps ✅ feasible *(promoted from §3 "may not be buildable")*

The draft filed timestamp data under stretch goals, conditional on "whether react-native-executorch exposes word/character-level timestamps". It does, confirmed in the v0.9.3 type definitions:

- `DecodingOptions.verbose` — "if set, transcription result is presented with timestamps";
- `StreamingOptions extends DecodingOptions`, so `stream({ verbose: true })` is valid, not just `transcribe()`;
- `TranscriptionResult.segments?: TranscriptionSegment[]`, each with `start`, `end`, `text`, and `words?: Word[]` where `Word = { word, start, end }` — seconds, word-level.

The app currently reads only `.text` (`index.tsx:266-270`) and stores no timing (`types/index.ts:5-15`).

This single change unlocks two things that are otherwise blocked:

- **Real SRT export.** Today's SRT is one cue spanning the entire note — `startTime = '00:00:00,000'` hard-coded, end = total duration (`services/storageService.ts:226-233`). It is a `.srt`-shaped `.txt`. With segments it becomes a genuine subtitle file.
- **Timestamp-linked playback** (§3.1) — the only missing piece was the timing data. Audio and a working player already exist.

- **ROI:** impact **high**, effort **low** for capture (add `verbose: true`, persist `segments` on the `Note`), **medium** for the UI. Feasibility **high**.
- **Measure it:** verbose payloads are larger per stream tick and land on the JS thread during recording. Confirm it doesn't regress live-transcription smoothness before shipping; if it does, run `transcribe({ verbose: true })` once over the saved WAV after stop instead — the file is already on disk (`wavEncoder.ts:96`) and `expo-audio`/`AudioContext` can decode it back to 16 kHz PCM.

### 2.3 Moonshine ⚠️ **removed — not available**

`react-native-executorch` 0.9.3 does not ship Moonshine. `SpeechToTextModelName` is a closed union: `whisper-tiny-en | whisper-base-en | whisper-small-en | whisper-tiny | whisper-base | whisper-small`, and the model registry contains no Moonshine entry. It shipped in v0.3.0 and was dropped since. Using it would mean exporting and hosting your own `.pte` **and** working around a typed config that won't accept it.

**Replacement item, if latency/battery is the real goal:** A/B `whisper_tiny_en()` against the current `whisper_base_en()` — same API, one-line change, ~40 MB vs ~380 MB download, and it gives the accuracy/speed trade-off curve the Moonshine item was actually after. Folds into §1.5. Effort **trivial**.

### 2.4 Fix the multilingual `decode` bug 🟡

The bug is real and well documented (`index.tsx:116-124`), and the intent is supported: `WHISPER_BASE` is registered `isMultilingual: true`, and `SpeechToTextLanguage` includes `'en'`, `'fr'`, and `'ar'`. The library also enforces the coupling the comment warns about — `validateOptions()` throws if `language` is passed to a non-multilingual model *and* if it is omitted for a multilingual one, so the model swap and the language argument must change together.

Two things the draft got wrong: this is not "the blocker for a multilingual feature that otherwise exists" (nothing exists), and there is no reverted commit to inspect.

- **Concrete debugging path, absent from the draft:** `encode()` and `decode()` are public on `SpeechToTextModule`. The failure can be reproduced outside the recording pipeline — feed a fixed WAV through `transcribe({ language: 'fr' })` first (no VAD, no streaming, no audio capture), and only then narrow to `encode` → `decode` with a hand-built token sequence. That isolates model/tokenizer from the streaming machinery, which the in-app repro cannot.
- **ROI:** impact **medium** (a differentiator, but the app has no multilingual users yet), effort **unknown — that is the point**. Timebox the isolated repro above; if it fails there too, it is an upstream issue to file, not app work.

### 2.5 Chunk overlap handling ⚠️ *(mostly out of scope)*

The library explicitly "handles the 30-second window limitation of Whisper models automatically to ensure context isn't lost between chunks". The app does naive concatenation — `transcriptRef.current.committed += committed.text` (`index.tsx:268`) — which matches the library's own documented example. There is no app-level window to reconcile.

- **What remains:** verify committed segments join with correct spacing across VAD boundaries (does `committed.text` carry a leading space?). That is a five-minute check and a possible one-line fix, not a workstream. Effort **trivial**, impact **low**.

---

## 3. Stretch goals

### 3.1 Timestamp-linked playback ❌ — **feasible, reclassified from "may not be buildable"**

Everything except the timing data already exists: per-note WAV on disk (`services/wavEncoder.ts:91-104`), `audioUri` + `duration` on the note (`index.tsx:351-352`), and a working `expo-audio` player with `seekTo` (`app/note/[id].tsx:317-376`). The 32-bar waveform there is decorative — generated from `Math.sin(i * 1.8)` (`:326-329`), not from audio.

With §2.2 landed, tap-a-word-to-seek is `player.seekTo(word.start)`.

- **ROI:** impact **high** (the standout demo feature, and the one reviewers remember), effort **medium**, feasibility **high**, blocked only on §2.2.
- Getting a real waveform from the PCM would complete it, but that is independent and optional.

### 3.2 Local encryption at rest ❌

No `expo-secure-store`, no `expo-crypto`, no crypto anywhere in `.ts`/`.tsx`. Notes are plaintext JSON in AsyncStorage (`storageService.ts:32`); audio is plaintext WAV in the documents directory (`wavEncoder.ts:91-97`). The only "encryption" string in the repo is the App Store compliance flag at `app.json:24`.

Two constraints the draft missed:

1. **It has to happen with the SQLite migration, not after.** `expo-sqlite` cannot encrypt; SQLCipher means `op-sqlite`. Migrating twice is the expensive path.
2. **Encrypting the DB alone is theater.** The WAV files carry the same speech the transcripts do. Either encrypt both or state plainly in the README that audio is stored unencrypted under OS file protection.

- **ROI:** impact **medium** (reinforces the privacy-first positioning; text-sized data makes the overhead negligible, as the draft says), effort **medium**, feasibility **high** — but sequence it with §1.2.

### 3.3 Speaker diarization ❌ — agree with the draft: skip

No trace in source; the only relic is a `speakerDetection: boolean` field in a settings type deleted in `126b1fc`, never implemented. No diarization model in the executorch registry, so it would mean a second model running alongside Whisper. The draft's reasoning holds: expensive on-device, and low value for single-speaker personal notes.

---

## 4. Low-value additions — confirmed skip

The draft's skip list stands as written: cloud sync, user-facing model choice, real-time translation, social features, gamification, a from-scratch design system, iOS 12 support, a web version, and monetization. Nothing in the code argues for any of them, and the first two actively conflict with the offline/privacy positioning and with §1.5's "model choice is an internal benchmark question".

One item needs re-labelling: **"more export formats — diminishing returns"** is right, but the existing SRT isn't finished (§2.2 — one cue for the whole note). That is a correctness fix to a shipped format, not a new format.

---

## 5. Found during the audit, absent from the draft

- **Lockfile drift** — see §1.1. Repo does not install correctly via the documented path.
- **Duplicated `"audio"`** in `UIBackgroundModes` (`app.json:21-23`).
- **Lost-update race** in `storageService` — see §1.2. Real today, not a scale problem.
- **Unused `react-test-renderer`** devDependency (`package.json:44`) — remove it, or make it earn its place under §1.4.
- **32-bit Android shows an indefinite loading state** rather than explaining why (`README.md:113`, self-acknowledged). `isAvailable === false` is detectable; a clear error beats a permanent spinner. Trivial effort, real polish.
- **Working tree is dirty** — `.cursorrules` deleted but unstaged; `app-improvements.md` untracked.

**Worth stating plainly:** the README is unusually well-calibrated. Every feature claim in `README.md:12-22` checks out against source, the 115 MB/hour figure is arithmetically right, and "Known Limitations" (`:108-115`) volunteers the decode bug, the missing tests, the CPU-only Android path, and the never-evicted model cache. No overclaiming was found. That is worth preserving as the codebase changes.

---

## Roadmap — reordered by verified ROI and feasibility

Ordered by (impact × confidence) ÷ effort, with dependencies respected. The draft's "verify Section 0" step is done — it was accurate — so it drops off.

**Tier 1 — do now (hours, unblocks everything else)**

1. **Fix the lockfile drift** (§1.1). One package manager, one lockfile, README aligned. Nobody — CI included — can install the repo correctly until this is done.
2. **Cadence profiling: `stream({ timeout })` at 100 / 300 / 500 ms** (§2.1), plus a `whisper_tiny_en` vs `whisper_base_en` A/B (§2.3). One-line changes; produces the numbers Tier 2 writes up.
3. **Housekeeping**: de-duplicate `UIBackgroundModes` (§1.3), drop or use `react-test-renderer`, commit the `.cursorrules` deletion.

**Tier 2 — the highest-leverage build (days)**

4. **`verbose: true` → persist `segments` on the note** (§2.2). Unblocks items 5 and 6 and fixes SRT on the way through. Measure the live-transcription cost; fall back to post-stop `transcribe()` over the saved WAV if it regresses.
5. **Real multi-cue SRT export** (§2.2) — small once 4 lands, and it corrects a format the app already advertises.
6. **Timestamp-linked playback** (§3.1) — tap a word, `seekTo(word.start)`. The demo feature, now confirmed buildable.

**Tier 3 — production credibility (days)**

7. **Tests + CI** (§1.4). Start with the pure logic: `buildWavHeader`, `formatSrtTimestamp`, `normalizeNote`, the three export generators. Needs item 1 first.
8. **Benchmark writeup** (§1.5) — latency, WER, battery, iOS CoreML vs Android XNNPACK reported separately, folding in item 2's numbers.

**Tier 4 — architecture (a week+)**

9. **SQLite migration** (§1.2), driven by the lost-update race, not note count. **Choose the driver against item 11 first** — `op-sqlite`/SQLCipher if encryption is wanted, `expo-sqlite` if not. Move search to FTS5 while you're there.
10. **Background recording — experiment first** (§1.3). Spend an hour finding out what survives backgrounding today, then scope. Do not commit to a design before that answer exists.
11. **Encryption at rest** (§3.2) — same PR family as item 9, and cover the WAV files, not just the database.

**Tier 5 — timeboxed / speculative**

12. **Multilingual decode bug** (§2.4) — reproduce in isolation via `transcribe({ language })` on a fixed WAV. Timebox it; if it fails there, file upstream rather than absorbing it.
13. **Committed-segment spacing check** (§2.5) — five minutes, possibly nothing.

**Dropped from the draft:** Moonshine (not in 0.9.3 — replaced by the whisper_tiny A/B in item 2), app-level chunk-overlap reconciliation (the library owns it), and "verify Section 0" (done — it was correct).

**Still skipped:** everything in §4, plus speaker diarization (§3.3).
