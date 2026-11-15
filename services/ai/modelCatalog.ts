/**
 * Every on-device model WhisprNotes can use, with what the user needs to
 * know about it. Pure data.
 *
 * Sizes are the Content-Length of the files as served (checked 2026-11-15).
 * ExecuTorch ships a different Whisper file per platform: Core ML at half
 * precision on iOS, XNNPACK at full precision on Android, which is two to
 * three times larger. Showing the iOS figure on Android told people to
 * expect 150 MB for what is a 399 MB download.
 */
import { Platform } from 'react-native';

import type { EngineId, LlmId } from './tiers';

const ios = Platform.OS === 'ios';

export type ModelId = EngineId | LlmId;

export interface ModelInfo {
  id: ModelId;
  name: string;
  approxBytes: number;
  /** 'manual': downloaded by modelManager; 'library': fetched by ExecuTorch on first use. */
  delivery: 'manual' | 'library';
  url?: string;
  fileName?: string;
  pro: boolean;
}

export const MODEL_CATALOG: Record<ModelId, ModelInfo> = {
  'whisper-large-v3-turbo': {
    id: 'whisper-large-v3-turbo',
    name: 'Whisper Large-v3 Turbo',
    approxBytes: 574_041_195,
    delivery: 'manual',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    pro: true,
  },
  'whisper-small': {
    id: 'whisper-small',
    name: 'Whisper Small',
    approxBytes: ios ? 484_940_213 : 1_128_717_824,
    delivery: 'library',
    pro: true,
  },
  'whisper-base': {
    id: 'whisper-base',
    name: 'Whisper Base (multilingual)',
    // q5_1: a fifth of the full-precision file for a small accuracy cost.
    approxBytes: 59_707_625,
    delivery: 'manual',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
    fileName: 'ggml-base-q5_1.bin',
    pro: false,
  },
  'whisper-base-en': {
    id: 'whisper-base-en',
    name: 'Whisper Base (English)',
    approxBytes: ios ? 146_287_992 : 398_646_144,
    delivery: 'library',
    pro: false,
  },
  'qwen3-1.7b': {
    id: 'qwen3-1.7b',
    name: 'Qwen3 1.7B',
    approxBytes: 1_303_738_496,
    delivery: 'library',
    pro: false,
  },
  'qwen3-0.6b': {
    id: 'qwen3-0.6b',
    name: 'Qwen3 0.6B',
    approxBytes: 505_686_400,
    delivery: 'library',
    pro: false,
  },
};

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** Models WhisprNotes downloads and stores itself (whisper.cpp weights). */
export const MANUAL_MODELS = (Object.keys(MODEL_CATALOG) as ModelId[]).filter(
  (id) => MODEL_CATALOG[id].delivery === 'manual'
);
