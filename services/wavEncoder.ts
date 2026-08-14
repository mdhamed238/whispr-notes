/**
 * Minimal WAV (16-bit PCM mono) encoder.
 *
 * The installed react-native-audio-api version (0.9.1) has no built-in
 * "record to file" support — AudioRecorder.start()/stop() are synchronous
 * void, and there's no enableFileOutput/FileFormat/FilePreset API (that
 * exists only in newer versions of the library, not the one this project
 * has pinned). We already receive raw Float32 PCM buffers via
 * onAudioReady for streaming transcription, so this module turns those
 * same accumulated samples into a real, playable WAV file.
 */

function floatTo16BitPCM(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(i * 2, value, true);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += CHARS[b0 >> 2];
    result += CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    result += i + 1 < bytes.length ? CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < bytes.length ? CHARS[b2 & 0x3f] : '=';
  }
  return result;
}

function buildWavHeader(dataLength: number, sampleRate: number): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (16-bit mono)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  return header;
}

export function encodeWavBase64(samples: number[], sampleRate: number): string {
  const pcmBytes = floatTo16BitPCM(samples);
  const header = buildWavHeader(pcmBytes.length, sampleRate);
  const wavBytes = new Uint8Array(header.length + pcmBytes.length);
  wavBytes.set(header, 0);
  wavBytes.set(pcmBytes, header.length);
  return bytesToBase64(wavBytes);
}

export function computeDurationSeconds(sampleCount: number, sampleRate: number): number {
  return sampleRate > 0 ? sampleCount / sampleRate : 0;
}
