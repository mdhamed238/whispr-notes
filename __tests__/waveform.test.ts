import { computePeaks } from '../services/waveform';

describe('computePeaks', () => {
  test('takes the max absolute sample per bucket', () => {
    expect(computePeaks(new Float32Array([0, 0.5, -1, 0.25]), 2)).toEqual([0.5, 1]);
  });

  test('empty audio gives a flat line of the requested length', () => {
    expect(computePeaks(new Float32Array(0), 4)).toEqual([0, 0, 0, 0]);
  });

  test('always returns exactly `buckets` values in [0, 1]', () => {
    const pcm = new Float32Array(1001).map((_, i) => Math.sin(i) * 1.7);
    const peaks = computePeaks(pcm, 48);
    expect(peaks).toHaveLength(48);
    for (const p of peaks) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  test('more buckets than samples still fills every bucket', () => {
    expect(computePeaks(new Float32Array([0.5]), 3)).toHaveLength(3);
  });
});
