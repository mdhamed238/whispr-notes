# Store listing — WhisprNotes

## URLs

- Marketing / support URL: https://whisprnotes-app.vercel.app (support page: /support)
- Privacy Policy URL: https://whisprnotes-app.vercel.app/privacy
- Terms of Use (EULA) URL: https://whisprnotes-app.vercel.app/terms

## Names

- **App name (30):** WhisprNotes: AI Voice Notes
- **iOS subtitle (30):** Private meeting transcripts
- **Play short description (80):** Record, transcribe and summarize meetings on your phone. Private, no cloud.

## Keywords (iOS, 100 chars, comma-separated, no spaces)

`transcribe,meeting,minutes,dictation,voice,memo,recorder,whisper,summary,offline,private,notes,ai`

## Promotional text (iOS, 170)

Whisper Large-v3 transcripts and AI meeting summaries that run entirely on your phone. No account, no uploads, no ads.

## Description

Your meetings, transcribed and summarized. On your phone.

WhisprNotes turns meetings, lectures, interviews and spoken ideas into accurate transcripts and clear summaries, without sending a single word to the cloud. Speech recognition and AI run on your device, so your recordings stay yours.

**Accurate, in your language**
• Transcripts in 37 languages on every phone, free
• Whisper Large-v3 Turbo accuracy in 99 languages on capable phones (Pro)
• Live preview while you speak, in every language (needs a reasonably fast phone)
• Pause and resume a recording
• Tap any word to hear that moment again

**Summaries that save the follow-up**
• Overview, key points, action items with owners, and decisions
• Written in the language you spoke
• Meeting, lecture, interview, memo and brief styles, plus your own instructions (Pro)
• Smart titles for every note

**Ask your notes (Pro)**
• Ask a question about any note and get the answer from its transcript, on your phone

**Bring in what you already have**
• Transcribe existing audio files: voice memos, lectures, call recordings (Pro)
• Import from Notion, Obsidian, Bear, Evernote, Markdown and text files
• Full-text search across transcripts, summaries and tags

**Share it your way**
• Text and Markdown, free
• Branded PDF, subtitles and the original audio (Pro)
• One-tap backup of all your notes

**Private by design**
• No account, no analytics, no ads, nothing uploaded
• Works in airplane mode after a one-time model download
• Delete everything with one tap

**Insights**
• Minutes recorded, streaks and your last two weeks, free
• Speaking pace, time saved and your busiest hours and days (Pro)

**In your language**
The app is available in English, French, Spanish, German, Italian, Arabic, Portuguese, Dutch, Turkish, Russian, Hindi, Japanese, Korean, Chinese, Polish, Indonesian, Ukrainian, Swedish, Vietnamese and Czech.

WhisprNotes Pro is a one-time lifetime purchase: $4.99 USD base, with localized prices shown in your store before you buy. One payment, no subscription. Restore your purchase on the same store account.

Always get consent before recording others.

Privacy Policy: https://whisprnotes-app.vercel.app/privacy · Terms of Use: https://whisprnotes-app.vercel.app/terms

## Localized listings

The app ships in 20 languages (see `i18n/languages.ts`). Add a store listing for each language you
want to rank in; the in-app strings in `i18n/locales/` are a starting point for the short texts,
but titles, keywords and descriptions should be written for each market rather than translated.

## App Store privacy ("nutrition label")

Data collected by the app or its partners:

| Data type | Collected | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Purchases → Purchase History | Yes (RevenueCat) | No | No | App Functionality |
| Usage data, diagnostics, crash data, identifiers | No | — | — | — |
| Audio, user content, contacts, location, name, email… | No | — | — | — |

Notes:
- Recordings, transcripts and summaries never leave the device, so they are **not collected**.
- The app has no analytics, crash-reporting or launch-counting SDK, so there is no usage data,
  diagnostics or device ID to declare. Don't add one without updating this label first.
- RevenueCat uses an anonymous, device-generated ID; no name/email. If App Review asks, point to the
  Privacy Policy section "Purchases".
- No App Tracking Transparency prompt is needed: nothing here is "tracking" as Apple defines it
  (no linking with third-party data, no advertising).
- The same answers are declared in the app's privacy manifest (`app.json` → `ios.privacyManifests`).
  Keep the two in step.

## Google Play Data safety

- **Data collected:**
  - Financial info → Purchase history (RevenueCat / Google Play Billing), for App functionality.
  - Nothing else: no app activity, no crash logs or diagnostics, no device or other IDs.
- **Data shared:** None (RevenueCat acts as a processor).
- **Encrypted in transit:** Yes.
- **Users can request deletion:** Yes (contact email; on-device data deletable in app).
- **Audio:** Not collected (processed on device only).
- Foreground service declaration: microphone (recording while the screen is off / app in background) and media playback.

## Screenshots (6.9" iPhone and Android phone)

1. Record screen mid-sentence, live waveform: "Speak. It's written. Live, on your phone."
2. Note with summary tab (key points, action items): "Meeting summaries in seconds."
3. Transcript with a highlighted word while playing: "Tap any word to hear it again."
4. Ask this note, with a question and its answer: "Ask your notes anything."
5. Export sheet with PDF selected: "Share as PDF, Markdown, subtitles or audio."
6. Insights screen: "See the hours of typing you've saved."
7. Privacy screen ("What's stored"): "Your voice never leaves this phone."

Localize the screenshots for the largest markets (the record screen's language chip makes a good
"works in your language" shot).

## Review notes (App Store)

- The app downloads on-device AI models from huggingface.co on first use; no account is required.
- Microphone is used only while recording; background audio mode keeps a recording running when the screen locks.
- To test Pro, use the sandbox purchase flow.
