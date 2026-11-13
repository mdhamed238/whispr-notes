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
