/**
 * Every on-device model WhisprNotes can use, with what the user needs to
 * know about it. Pure data.
 */
import type { EngineId, LlmId } from './tiers';

export type ModelId = EngineId | LlmId;

export interface ModelInfo {
  id: ModelId;
  name: string;
  purpose: string;
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
    purpose: 'Most accurate transcripts, 99 languages',
    approxBytes: 574_000_000,
    delivery: 'manual',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    pro: true,
  },
  'whisper-small': {
    id: 'whisper-small',
    name: 'Whisper Small',
    purpose: 'Accurate transcripts, multilingual',
    approxBytes: 490_000_000,
    delivery: 'library',
    pro: true,
  },
  'whisper-base-en': {
    id: 'whisper-base-en',
    name: 'Whisper Base (English)',
    purpose: 'Live transcript while you speak',
    approxBytes: 150_000_000,
    delivery: 'library',
    pro: false,
  },
  'qwen3-1.7b': {
    id: 'qwen3-1.7b',
    name: 'Qwen3 1.7B',
    purpose: 'Summaries and titles',
    approxBytes: 1_200_000_000,
    delivery: 'library',
    pro: false,
  },
  'qwen3-0.6b': {
    id: 'qwen3-0.6b',
    name: 'Qwen3 0.6B',
    purpose: 'Summaries and titles',
    approxBytes: 500_000_000,
    delivery: 'library',
    pro: false,
  },
};

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
