# Audio Transcription App

An Expo / React Native app that records speech and transcribes it **on-device** in real time using OpenAI's Whisper (Tiny, English) via [`react-native-executorch`](https://github.com/software-mansion/react-native-executorch). No audio ever leaves the phone.

## Features

- **Live streaming transcription** — audio is captured in 100 ms chunks and streamed straight into the Whisper model as you speak, with committed and in-progress (interim) text shown separately.
- **On-device inference** — runs fully offline through ExecuTorch; no server, no API keys, no network calls.
- **Notes** — recordings are saved as editable notes: title, transcript, and freeform tags, all editable after the fact. Pin the ones you want to keep at the top.
- **Audio playback** — each note keeps the actual recording (the same audio samples fed to the model are also encoded into a real WAV file on-device) so you can play it back from the note.
- **Search** — filter notes by title, transcript text, or tag.
- **Export & share** — export any note as `.txt`, `.json`, or `.srt` and share it through the native share sheet.
- **Haptic feedback** on start/stop/save for a more tactile recording experience.

## Requirements

This app **must run on a physical iOS or Android device** — simulators/emulators aren't supported.

| | |
|---|---|
| Node.js | 18+ |
| iOS | Physical device, iOS 16+ |
| Android | Physical device, Android 13+ (API 33+) |
| Expo CLI | via `npx expo` (no global install needed) |

On-device model inference (`react-native-executorch`) and real-time audio capture (`react-native-audio-api`) both need native hardware, so this is a [dev client](https://docs.expo.dev/develop/development-builds/introduction/) build, not Expo Go.

## Getting Started

```bash
git clone https://github.com/mdhamed238/audio-transcription-app.git
cd audio-transcription-app
npm install

# build & run a development client on a connected device
npm run ios      # iOS device
npm run android   # Android device
```

On first launch, the Whisper Tiny model downloads and initializes — this takes a few seconds and only happens once.

## How It Works

1. `AudioRecorder` (`react-native-audio-api`) captures 16kHz mono audio and streams 100ms buffers as they're recorded.
2. Each buffer is pushed into the model via `useSpeechToText().streamInsert()` — no need to wait for the recording to finish.
3. The hook exposes `committedTranscription` (finalized text) and `nonCommittedTranscription` (in-flight guess) so the UI can update live.
4. On stop, the same audio samples fed to the model are also encoded into a real WAV file on-device (`services/wavEncoder.ts`) — the note is saved with the real audio duration and a link to that file.
5. The Notes tab lists saved notes; tap one to edit its title/transcript/tags, play back the audio, export, or delete it.

## Project Structure

```
app/
├── _layout.tsx              # Root stack + font loading
├── note/[id].tsx             # Note Detail modal — edit, tags, pin, playback, export, delete
└── (tabs)/
    ├── _layout.tsx           # Tab navigator (Record / Notes)
    ├── index.tsx             # Record screen — capture + live transcription
    └── notes.tsx              # Notes screen — search, pinned section, cards

services/
├── storageService.ts        # AsyncStorage persistence, export (txt/json/srt), sharing
└── wavEncoder.ts              # PCM WAV encoding for captured audio

constants/
├── config.ts                 # Audio, storage, and export configuration
├── Colors.ts                  # Light/dark theme tokens
└── Spacing.ts                 # Shared spacing/font-size scale

types/
└── index.ts                  # Shared TypeScript types
```

## Tech Stack

- [Expo SDK 54](https://expo.dev) / React Native 0.81 / React 19
- [expo-router](https://docs.expo.dev/router/introduction/) for file-based navigation
- [`react-native-executorch`](https://github.com/software-mansion/react-native-executorch) — on-device Whisper Tiny (EN) inference
- [`react-native-audio-api`](https://github.com/software-mansion/react-native-audio-api) — low-level streaming audio capture
- [`expo-audio`](https://docs.expo.dev/versions/latest/sdk/audio/) — note playback
- TypeScript, `@react-native-async-storage/async-storage`, `expo-sharing`, `expo-haptics`

## Building

Native builds are managed with [EAS](https://docs.expo.dev/eas/) via the included `Makefile`:

```bash
make preview-ios       # preview build, iOS
make dev-android       # development build, Android
make build MODE=production PLATFORM=all
```

## Known Limitations

- **English only** — uses the fixed Whisper Tiny EN model; no language selection yet.
- **Device-only** — no simulator/emulator or web fallback for recording/transcription.
- **No automated tests configured** — no test runner is wired up in `package.json` yet.

## Status

Core loop — record, transcribe live, save, review, export — is implemented and working end to end on-device. Treat this as an actively-developed personal project rather than a polished release: expect rough edges around error states and no CI yet.

## License

No license file yet — all rights reserved by default until one is added.
