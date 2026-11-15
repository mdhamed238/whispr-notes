/**
 * Waveform peaks for the note player: the max absolute amplitude in each of
 * `buckets` equal slices of the recording, clamped to [0, 1]. Pure, so the
 * shape of the bars is tested rather than eyeballed.
 */
export function computePeaks(pcm: Float32Array, buckets: number): number[] {
  const peaks = new Array<number>(buckets).fill(0);
  if (pcm.length === 0 || buckets <= 0) return peaks;

  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * pcm.length) / buckets);
    // At least one sample per bucket, even when there are fewer samples
    // than buckets.
    const end = Math.max(start + 1, Math.floor(((b + 1) * pcm.length) / buckets));
    let max = 0;
    for (let i = start; i < end && i < pcm.length; i++) {
      const v = Math.abs(pcm[i]);
      if (v > max) max = v;
    }
    peaks[b] = Math.min(1, max);
  }
  return peaks;
}

/**
 * Scales peaks so the loudest bar fills the height. Speech rarely gets near
 * full scale, so unscaled bars would all look flat.
 */
export function normalizePeaks(peaks: number[], floor = 0.06): number[] {
  const max = Math.max(...peaks, 0);
  if (max <= 0) return peaks.map(() => floor);
  return peaks.map((p) => Math.max(floor, p / max));
}

/**
 * Reduces a run of loudness values (one per captured chunk) to `buckets`
 * bars, keeping the loudest value in each slice.
 */
export function bucketPeaks(values: number[], buckets: number): number[] {
  const peaks = new Array<number>(buckets).fill(0);
  if (values.length === 0 || buckets <= 0) return peaks;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * values.length) / buckets);
    const end = Math.max(start + 1, Math.floor(((b + 1) * values.length) / buckets));
    let max = 0;
    for (let i = start; i < end && i < values.length; i++) {
      if (values[i] > max) max = values[i];
    }
    peaks[b] = Math.min(1, max);
  }
  return peaks;
}

/**
 * Peaks from 16-bit little-endian PCM fed in pieces, so a recording of any
 * length is measured in constant memory instead of being decoded whole.
 * `stride` skips samples: a waveform drawn in 64 bars doesn't need them all.
 */
export function createPcm16PeakReader(totalSamples: number, buckets: number, stride = 4) {
  const peaks = new Array<number>(buckets).fill(0);
  let sample = 0;
  return {
    push(bytes: Uint8Array): void {
      if (totalSamples <= 0 || buckets <= 0) return;
      const step = Math.max(1, stride) * 2;
      for (let i = 0; i + 1 < bytes.length; i += step) {
        const index = sample + i / 2;
        if (index >= totalSamples) break;
        let value = bytes[i] | (bytes[i + 1] << 8);
        if (value >= 0x8000) value -= 0x10000;
        const level = Math.abs(value) / 0x8000;
        const bucket = Math.min(buckets - 1, Math.floor((index * buckets) / totalSamples));
        if (level > peaks[bucket]) peaks[bucket] = level;
      }
      sample += Math.floor(bytes.length / 2);
    },
    result(): number[] {
      return peaks.map((p) => Math.min(1, p));
    },
  };
}
