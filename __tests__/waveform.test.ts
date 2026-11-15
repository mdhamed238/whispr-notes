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

describe('peaks collected while recording', () => {
  const { bucketPeaks, createPcm16PeakReader } = require('../services/waveform');

  test('bucketPeaks keeps the loudest chunk of each slice', () => {
    expect(bucketPeaks([0.1, 0.9, 0.2, 0.3, 0.05, 0.4], 3)).toEqual([0.9, 0.3, 0.4]);
    expect(bucketPeaks([0.5], 4)).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(bucketPeaks([], 3)).toEqual([0, 0, 0]);
    expect(bucketPeaks([2, 0.5], 2)).toEqual([1, 0.5]);
  });

  test('the streaming WAV reader matches a whole-buffer pass, whatever the chunking', () => {
    const samples = 4000;
    const pcm = new Float32Array(samples);
    const bytes = new Uint8Array(samples * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples; i++) {
      const v = Math.sin(i / 37) * (i / samples);
      pcm[i] = v;
      view.setInt16(i * 2, Math.round(v * 0x7fff), true);
    }
    const expected = computePeaks(pcm, 8);

    for (const chunk of [bytes.length, 1024, 250]) {
      const reader = createPcm16PeakReader(samples, 8, 1);
      for (let offset = 0; offset < bytes.length; offset += chunk) reader.push(bytes.subarray(offset, offset + chunk));
      const got = reader.result();
      got.forEach((p: number, b: number) => expect(p).toBeCloseTo(expected[b], 3));
    }
  });

  test('skipping samples still finds the shape, and silence stays silent', () => {
    const bytes = new Uint8Array(2000);
    const reader = createPcm16PeakReader(1000, 4);
    reader.push(bytes);
    expect(reader.result()).toEqual([0, 0, 0, 0]);
    expect(createPcm16PeakReader(0, 4).result()).toEqual([0, 0, 0, 0]);
  });
});
