/**
 * Streaming WAV (16-bit PCM mono) writer.
 *
 * react-native-audio-api has no built-in "record to file" support, so we
 * build the WAV ourselves from the same raw Float32 PCM buffers that
 * onAudioReady already hands us for streaming transcription.
 *
 * This writes straight to disk as the audio arrives rather than buffering
 * the whole recording in memory and encoding it on stop. The previous
 * approach accumulated every sample into a JS number[] and, on stop,
 * synchronously ran a Float32 -> PCM16 pass plus a hand-rolled base64
 * encode over the entire recording. For a 5-minute note that meant ~4.8M
 * boxed doubles held in the heap and a ~12.8M-character base64 string
 * built on the JS thread — hundreds of ms on desktop V8, and enough to
 * visibly freeze the UI on device. It also put a hard ceiling on how long
 * a recording could be.
 *
 * Instead: write a placeholder header up front, append each ~3KB chunk as
 * it arrives (expo-file-system's FileHandle keeps a seekable offset), then
 * seek back and patch the header with the real length on stop. Memory is
 * O(chunk) instead of O(recording), stop is a 44-byte write, and recording
 * length is bounded by free disk space rather than the JS heap.
 */

import { Directory, File, Paths, type FileHandle } from 'expo-file-system';

const AUDIO_DIR_NAME = 'audio';
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2; // 16-bit
const CHANNEL_COUNT = 1; // mono — we only ever read getChannelData(0)

function buildWavHeader(dataLength: number, sampleRate: number): Uint8Array {
  const header = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(header.buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  const byteRate = sampleRate * CHANNEL_COUNT * BYTES_PER_SAMPLE;

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, CHANNEL_COUNT, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, CHANNEL_COUNT * BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  return header;
}

export interface WavCaptureResult {
  uri: string;
  durationSeconds: number;
}

export class WavFileWriter {
  private handle: FileHandle | null;
  private readonly file: File;
  private readonly sampleRate: number;
  private pcmByteLength = 0;

  // Chunks arrive at a constant size, so the PCM scratch buffer is
  // allocated once and reused for every write instead of per chunk.
  private scratch: Uint8Array | null = null;
  private scratchView: DataView | null = null;

  private constructor(file: File, handle: FileHandle, sampleRate: number) {
    this.file = file;
    this.handle = handle;
    this.sampleRate = sampleRate;
  }

  get uri(): string {
    return this.file.uri;
  }

  /** Duration of what has been written so far, in seconds. */
  get durationSeconds(): number {
    return computeDurationSeconds(this.pcmByteLength / BYTES_PER_SAMPLE, this.sampleRate);
  }

  static create(sampleRate: number): WavFileWriter {
    const directory = new Directory(Paths.document, AUDIO_DIR_NAME);
    if (!directory.exists) {
      directory.create({ intermediates: true, idempotent: true });
    }

    const file = new File(directory, `note-${Date.now()}.wav`);
    file.create({ overwrite: true });

    const handle = file.open();
    // Placeholder — dataLength is unknown until finalize() patches it.
    handle.writeBytes(buildWavHeader(0, sampleRate));

    return new WavFileWriter(file, handle, sampleRate);
  }

  write(samples: Float32Array): void {
    if (!this.handle) return;

    const byteLength = samples.length * BYTES_PER_SAMPLE;
    if (!this.scratch || this.scratch.byteLength !== byteLength) {
      this.scratch = new Uint8Array(byteLength);
      this.scratchView = new DataView(this.scratch.buffer);
    }

    const view = this.scratchView!;
    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(i * BYTES_PER_SAMPLE, value, true);
    }

    this.handle.writeBytes(this.scratch);
    this.pcmByteLength += byteLength;
  }

  /**
   * Patches the header with the real data length and closes the file.
   * Returns null (deleting the file) when no audio was ever written, so
   * callers don't end up with a valid-but-empty 44-byte WAV.
   */
  finalize(): WavCaptureResult | null {
    const handle = this.handle;
    if (!handle) return null;
    this.handle = null;
    this.scratch = null;
    this.scratchView = null;

    try {
      if (this.pcmByteLength === 0) {
        handle.close();
        this.deleteFile();
        return null;
      }

      handle.offset = 0;
      handle.writeBytes(buildWavHeader(this.pcmByteLength, this.sampleRate));
      handle.close();

      return {
        uri: this.file.uri,
        durationSeconds: this.durationSeconds,
      };
    } catch (error) {
      console.error('Failed to finalize WAV file:', error);
      try {
        handle.close();
      } catch {
        // Already closed or unusable — nothing more we can do here.
      }
      this.deleteFile();
      return null;
    }
  }

  /** Closes the handle and removes the partial file. */
  discard(): void {
    const handle = this.handle;
    this.handle = null;
    this.scratch = null;
    this.scratchView = null;
    if (handle) {
      try {
        handle.close();
      } catch (error) {
        console.warn('Failed to close WAV handle on discard:', error);
      }
    }
    this.deleteFile();
  }

  private deleteFile(): void {
    try {
      if (this.file.exists) {
        this.file.delete();
      }
    } catch (error) {
      console.warn('Failed to delete WAV file:', error);
    }
  }
}

export function computeDurationSeconds(sampleCount: number, sampleRate: number): number {
  return sampleRate > 0 ? sampleCount / sampleRate : 0;
}
