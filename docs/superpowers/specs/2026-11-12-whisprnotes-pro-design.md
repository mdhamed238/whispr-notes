# WhisprNotes Pro — Design

Date: 2026-11-12 · Branch: `feat/whisprnotes-pro` (cut from `feat/transcript-timeline-sdk57`)

## Intent

Turn the current portfolio app ("Audio Transcription", Expo SDK 57, on-device Whisper via
`react-native-executorch`) into **WhisprNotes**, a paid, privacy-first voice-notes product a
solo developer can ship to the App Store and Google Play.

**Who pays:** primarily professionals recording meetings, who want an accurate transcript plus
a shareable summary (PDF / Markdown / text) and the audio itself. Secondarily, individuals who
take notes by speaking.

**The pitch:** studio-grade transcription and AI summaries that run entirely on your phone.
Recordings, transcripts and summaries never leave the device. The privacy promise is the
product's moat, so it must be literally true and stated honestly.

## Goals

1. **Fix every known bug and flaw** in the existing app (see "Known defects" below).
2. **Accuracy:** Whisper **Large-v3-Turbo** on capable devices (target: Galaxy S23 Ultra class),
   with automatic fallback.
3. **AI on device:** meeting summary (summary, key points, action items, decisions) and an
   auto-generated title from content.
4. **Sharing:** export a note/summary as PDF, Markdown, plain text; share the audio.
5. **Import:** bring notes in from `.md` / `.txt` files and common app exports.
6. **Insights:** personal on-device stats and graphs.
7. **Monetization:** freemium with a Pro subscription and a lifetime option.
8. **Trust & legal:** privacy statement, Terms & Conditions, "what data we collect and why"
   screen, onboarding that explains first-launch model downloads.
9. **Pro feel:** smooth native navigation, consistent haptics, polished interactions,
   branded logo and app icon.

## Non-goals

- Cloud sync, accounts, server backend. (Possible later; not in this project.)
- Speaker diarization ("who said what"). No dependable offline path today.
- Real-time translation.
- Running Large-v3 for the *live* transcript (too slow on any phone).
- A web build. The app is native-only; `app/+html.tsx` / web config can stay but isn't a target.

## Anti-goals (failure even if it "works")

- Any network call carrying user content (audio, text, summaries, stats, identifiers).
- Third-party analytics/crash SDKs that phone home. Insights are computed locally only.
- Privacy copy that overstates: the app **does** use the network for (a) one-time model
  downloads and (b) App Store / Play purchases via RevenueCat. Copy must say so.
- Data loss: an edit, recording, or import silently dropped.
- Blocking the UI for minutes (long transcription/summary passes must be backgrounded with
  progress and be cancellable).

## Constraints

- Expo SDK 57, React Native 0.86, new architecture, dev-client builds (not Expo Go). Physical
  devices only. Native modules pinned to exact versions (README explains why). Install with
  `npx expo install` so versions match SDK 57.
- Transcription via executorch must import from `react-native-executorch/legacy` (word
  timestamps; see memory note / README).
- iOS 17+, Android arm64-v8a only.
- Solo developer: individual store accounts. Legal docs list the developer's name, website
  and email as contact; no company. Docs must carry a "not legal advice — have reviewed"
  note in the repo, not in the app.
- Package manager: Yarn (`yarn.lock` is authoritative).

## Approaches considered

### Transcription engine
| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | **Hybrid.** Live transcript stays on executorch Whisper Base EN (streaming + VAD, already tuned). After Stop, a **final pass** re-transcribes the saved WAV with the best engine the device supports. | Two inference runtimes in the app (+ a few MB binary). Best live latency *and* best final accuracy. Reuses the existing post-save timeline pass. |
| B | Large-v3 for everything incl. live | Not workable: too slow for live streaming on any phone. |
| C | Full Large-v3 (non-turbo) for final pass | ~1.1 GB, 3–5× slower for marginal gain. Could be a later "max accuracy" toggle. |

### Summary/title LLM
executorch `useLLM` with **Qwen3-1.7B (8da4w quant)** on flagship tier, **Qwen3-0.6B** on lower
tiers. Chosen because it's the same runtime already in the app (no extra native dep) and the
models are in the library's registry. Alternative (llama.rn / GGUF) rejected: another native
runtime for no clear quality gain at this size.

### Storage
**expo-sqlite** with an FTS5 virtual table for search. Rejected: keeping AsyncStorage (the
whole-array read-modify-write race is the main data-loss bug); op-sqlite+SQLCipher (encryption
at rest is not in scope; files are already sandboxed by the OS and the OS encrypts at rest).

### Purchases
**RevenueCat** (`react-native-purchases`). Network is used only for purchase/restore/receipt
validation; entitlement is cached so Pro keeps working offline. Rejected: raw StoreKit/Billing
(much more code for a solo dev).

## Decisions (made with the owner)

### Device tiers & model selection
Determined at first launch from `expo-device` (`totalMemory`, arm64) and re-checkable in
Settings:

| Tier | Criteria | Final-pass model | LLM |
|---|---|---|---|
| **Flagship** | ≥ 8 GB RAM | Whisper **Large-v3-Turbo** (`whisper.rn`, ggml q5_0 ~550 MB; Core ML encoder on iOS) | Qwen3-1.7B |
| **Standard** | 6–8 GB | Whisper **Small** (executorch, multilingual) | Qwen3-0.6B |
| **Lite** | < 6 GB | none (keep streamed Base text) | Qwen3-0.6B, or summaries disabled if load fails |

- The user can override in Settings (e.g. force Base to save storage/battery).
- If the large model fails to load or runs out of memory, the app falls back one tier
  automatically and remembers it.
- Final pass for long recordings: process in chunks with progress shown on the note
  ("Enhancing transcript… 42%"). The note is usable during the pass. Cancellable.
- Large-v3-Turbo is multilingual. Expose a **language** setting (Auto / specific) for the final
  pass. Live transcript remains English-only Base; for non-English recordings the live text is
  a rough preview and the final pass is the real transcript (communicate that in UI).
- Word timestamps from the final pass feed the existing timeline sidecar (tap-a-word playback,
  real SRT).

### First-launch onboarding
3–4 screens: value prop → privacy promise ("Your voice never leaves this phone") → model
download explanation (sizes, Wi-Fi recommended, network used only for this and purchases) →
mic permission. Downloads continue in the background with visible progress; the app is usable
with Base as soon as Base is ready.

### Monetization (freemium)
- **Free:** unlimited recording with live Base transcript, 3 AI summaries per week, `.txt`
  export and plain share.
- **Pro:** Large-v3 / Small final pass ("Enhanced transcription"), unlimited summaries & AI
  titles, PDF / Markdown / SRT export, audio sharing, import, Insights, languages.
- **Prices:** ~$7.99/month, ~$49.99/year (with free trial), ~$99 lifetime (non-consumable).
  Exact prices set in store consoles; app reads them from RevenueCat offerings.
- Paywall: one well-designed screen, shown from gated actions and from Settings. Restore
  purchases button. No dark patterns.
- Auto-title stays free: it's part of a good first impression.

### Insights (on-device only)
Total notes, minutes recorded, words transcribed, words-per-minute, recording streak, activity
per day/week (bar chart), time-of-day distribution, top tags. Computed from SQLite.

### Export & share
Per note: **PDF** (styled, branded, includes summary + transcript, optional timestamps),
**Markdown**, **Text**, **SRT**, **Audio** (m4a if compression is achievable offline, else
WAV with size shown). Share summary only, or summary + transcript. Bulk export all notes as a
zip of Markdown (backup). JSON export is dropped from the UI (low value to users); the
Markdown backup replaces it.

### Import
Pick files with `expo-document-picker`: `.md`, `.txt` (multi-select), `.zip` of an
Obsidian/Bear/Notion Markdown export, Evernote `.enex`. Title from front-matter / first
heading / filename; tags from front-matter / `#hashtags`; dates preserved when present.
Imported notes have no audio. Also register as a share target for text/`.md`/`.txt` files
("Open in WhisprNotes"). Duplicate detection by title+content hash.

### Legal & trust
In-app screens (and Markdown sources in `docs/legal/` for hosting on the owner's website):
Privacy Policy, Terms of Use (with Apple standard EULA reference), "Your data" screen listing
exactly what is stored, where, and what touches the network. App Store privacy label:
"Data Not Collected" (RevenueCat purchase data is handled by Apple/Google and RevenueCat —
documented in the policy). Delete-all-data button in Settings.

### Brand
Name **WhisprNotes**. Update app name, slug-facing strings, bundle display name (keep existing
bundle identifiers unless the owner changes them). Logo: a simple mark and app icon; owner picks
from 3–4 directions shown on a preview page before implementation. Assets: SVG source, iOS icon,
Android adaptive icon (foreground + background + monochrome), splash.

### Navigation & UX
- Tabs: **Record · Notes · Insights · Settings**. Note detail as a native stack push (not a
  modal) with swipe-back; full-screen recorder retains its current feel.
- Consistent haptics map: selection (taps, toggles), light (pin, word seek), medium (record
  start — before mic opens, see existing comment), success/error notifications (save, export,
  purchase), rigid on destructive confirm. A Settings toggle to disable haptics.
- Swipe actions on note cards (pin / delete with undo toast), long-press context menu,
  tag filter chips on Notes, sort options, undo for delete.
- Skeletons, empty states with call-to-action, toasts instead of `Alert` for non-blocking
  feedback, keyboard-aware editors, reduced-motion respect.
- Summary appears on the note as a card above the transcript (Summary / Transcript segmented
  control).

## Known defects to fix (from audit)

1. AsyncStorage whole-array read-modify-write race → SQLite migration (one-time import of the
   `transcriptions` key + existing timeline sidecars kept as-is).
2. Record-screen Save navigates to `/notes` while the timeline pass still holds the model; the
   pass then rewrites the title even if the user is viewing the note (CAS only checks equality
   at write time; detail screen state goes stale). Detail screen must refresh when the pass lands.
3. Notes list export always uses `.txt`; actions use `Alert` sheets.
4. Decorative fake waveform in the player → real waveform from the WAV (downsampled peaks,
   computed once and cached in the sidecar).
5. Duplicate/legacy Android permissions (`WRITE/READ_EXTERNAL_STORAGE`) and duplicated
   `RECORD_AUDIO` entries in `app.json`.
6. No background/interruption handling during recording (phone call, app backgrounded): at
   minimum, stop cleanly and save what was captured; ideally keep recording in background
   (audio capture continues; transcription catches up via the final pass).
7. `app.json` name "Audio Transcription", white splash, generic icon.
8. Title autogeneration is a 40-char truncation → LLM title (fallback: first sentence).
9. Search is in-memory substring → FTS5.

## Left to the builder

- Exact component structure, file layout, state management (keep it simple; React state +
  small hooks; no Redux).
- Chunking strategy and thread handling for the final pass.
- Whether audio compression to m4a is feasible offline with the existing deps; if not, share
  WAV and show size.
- Chart library (prefer `react-native-svg`-based, lightweight).
- PDF HTML template design within the brand.
- Prompt wording for summary/title (must output structured sections; keep within the model's
  context; chunk-and-merge for long transcripts).
- Test coverage: unit tests for pure logic (import parsers, export generators, SRT, tiering,
  stats) with Jest.
