/**
 * On-device summaries and AI titles (Qwen3 via ExecuTorch).
 *
 * One LLM instance at a time, behind a mutex, unloaded after a minute idle
 * so its ~1 GB doesn't sit in memory. Long transcripts are summarized in
 * chunks, then merged (map-reduce). Progress and streamed text are published
 * per note so the note screen can show the summary being written.
 */
import { LLMModule, models, type Message } from 'react-native-executorch/legacy';

import * as notesRepo from '../db/notesRepo';
import { isProNow } from '../billing/entitlement';
import { summaryAllowance } from '../billing/quota';
import { peekSettings, updateSettings } from '../settings';
import { detectTier } from './device';
import { registerJobRunner } from './enhanceQueue';
import { buildMergeMessages, buildSummaryMessages, buildTitleMessages, chunkTranscript } from './prompts';
import { cleanTitle, parseSummaryResponse, stripThinking } from './summaryParser';
import { chooseLlm, type LlmId } from './tiers';

const IDLE_UNLOAD_MS = 60_000;
/** Below this there's nothing worth summarizing. */
const MIN_WORDS_FOR_SUMMARY = 25;

export type SummaryPhase = 'idle' | 'loading-model' | 'summarizing' | 'merging' | 'titling';
export interface SummaryState {
  phase: SummaryPhase;
  /** Model download progress while loading (0..1). */
  downloadProgress: number;
  /** Text streamed so far for the current step. */
  partial: string;
  /** e.g. part 2 of 4. */
  step: { index: number; total: number } | null;
}

const IDLE: SummaryState = { phase: 'idle', downloadProgress: 0, partial: '', step: null };
const states = new Map<string, SummaryState>();
const listeners = new Set<(noteId: string, state: SummaryState) => void>();

export function getSummaryState(noteId: string): SummaryState {
  return states.get(noteId) ?? IDLE;
}

export function subscribeSummaryState(listener: (noteId: string, state: SummaryState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setState(noteId: string, patch: Partial<SummaryState>) {
  const next = { ...getSummaryState(noteId), ...patch };
  if (next.phase === 'idle') states.delete(noteId);
  else states.set(noteId, next);
  listeners.forEach((l) => l(noteId, next));
}

let llm: { id: LlmId; module: LLMModule } | null = null;
let tokenSink: ((token: string) => void) | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let lock: Promise<unknown> = Promise.resolve();
let activeNoteId: string | null = null;

/** Serializes LLM use; the native module can only run one generation. */
function withLlm<T>(task: () => Promise<T>): Promise<T> {
  const run = lock.then(task, task);
  lock = run.catch(() => undefined);
  return run;
}

async function getLlm(noteId: string): Promise<LLMModule> {
  if (idleTimer) clearTimeout(idleTimer);
  const wanted = chooseLlm(peekSettings().tierOverride ?? detectTier());
  if (llm?.id === wanted) return llm.module;
  unload();
  setState(noteId, { phase: 'loading-model', downloadProgress: 0 });
  const source = wanted === 'qwen3-1.7b' ? models.llm.qwen3_1_7b({ quant: true }) : models.llm.qwen3_0_6b({ quant: true });
  const module = await LLMModule.fromModelName(
    source,
    (p) => setState(noteId, { downloadProgress: p }),
    (token) => tokenSink?.(token)
  );
  // Low temperature: summaries should be faithful, not creative.
  module.configure({ generationConfig: { temperature: 0.3, topP: 0.9 } });
  llm = { id: wanted, module };
  return module;
}

function unload() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  try {
    llm?.module.delete();
  } catch (error) {
    console.warn('Failed to unload LLM:', error);
  }
  llm = null;
}

function scheduleUnload() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => withLlm(async () => unload()), IDLE_UNLOAD_MS);
}

async function generate(module: LLMModule, noteId: string, messages: Message[]): Promise<string> {
  let partial = '';
  tokenSink = (token) => {
    partial += token;
    setState(noteId, { partial: stripThinking(partial) });
  };
  try {
    return await module.generate(messages);
  } finally {
    tokenSink = null;
  }
}

/** Stops the generation running for this note, if any. */
export function stop(noteId: string): void {
  if (activeNoteId === noteId) llm?.module.interrupt();
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * Writes a full summary (and, while the title is still machine-written, an
 * AI title). Throws when there's too little text to summarize.
 */
export async function summarize(noteId: string): Promise<void> {
  const note = await notesRepo.getNote(noteId);
  if (!note) return;
  if (wordCount(note.transcription) < MIN_WORDS_FOR_SUMMARY) {
    throw new Error('Too short to summarize');
  }

  await withLlm(async () => {
    activeNoteId = noteId;
    try {
      const module = await getLlm(noteId);
      const chunks = chunkTranscript(note.transcription);
      let raw: string;
      if (chunks.length === 1) {
        setState(noteId, { phase: 'summarizing', partial: '', step: null });
        raw = await generate(module, noteId, buildSummaryMessages(chunks[0], 'single'));
      } else {
        const partials: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          setState(noteId, { phase: 'summarizing', partial: '', step: { index: i + 1, total: chunks.length } });
          partials.push(stripThinking(await generate(module, noteId, buildSummaryMessages(chunks[i], 'partial'))));
        }
        setState(noteId, { phase: 'merging', partial: '', step: null });
        raw = await generate(module, noteId, buildMergeMessages(partials));
      }

      const { title, summary } = parseSummaryResponse(raw, llm?.id ?? 'unknown', new Date());
      if (!summary.overview && summary.keyPoints.length === 0) throw new Error('The model returned an empty summary');

      // Re-read: the user may have renamed the note while this ran.
      const latest = await notesRepo.getNote(noteId);
      if (!latest) return;
      await notesRepo.updateNote(noteId, {
        summary,
        ...(latest.titleIsAuto && title ? { title } : {}),
      });
      await updateSettings({ summaryLog: [...peekSettings().summaryLog, new Date().toISOString()].slice(-50) });
    } finally {
      activeNoteId = null;
      setState(noteId, { phase: 'idle' });
      scheduleUnload();
    }
  });
}

/** AI title only. Free for everyone; leaves user-written titles alone unless `force`. */
export async function generateTitle(noteId: string, force = false): Promise<void> {
  const note = await notesRepo.getNote(noteId);
  if (!note || (!note.titleIsAuto && !force) || wordCount(note.transcription) < 4) return;
  await withLlm(async () => {
    activeNoteId = noteId;
    try {
      const module = await getLlm(noteId);
      setState(noteId, { phase: 'titling', partial: '' });
      const title = cleanTitle(stripThinking(await generate(module, noteId, buildTitleMessages(note.transcription))).split('\n')[0] ?? '');
      const latest = await notesRepo.getNote(noteId);
      if (title && latest && (latest.titleIsAuto || force)) {
        await notesRepo.updateNote(noteId, { title, titleIsAuto: true });
      }
    } finally {
      activeNoteId = null;
      setState(noteId, { phase: 'idle' });
      scheduleUnload();
    }
  });
}

/**
 * Background step after a recording's transcript is final: a full summary
 * when the user wants automatic summaries and has allowance left, otherwise
 * just the free AI title.
 */
async function autoProcess(noteId: string): Promise<void> {
  const note = await notesRepo.getNote(noteId);
  if (!note) return;
  const allowance = summaryAllowance(peekSettings().summaryLog, new Date(), isProNow());
  const wantsSummary =
    peekSettings().autoSummarize && allowance.allowed && !note.summary && wordCount(note.transcription) >= MIN_WORDS_FOR_SUMMARY;
  try {
    if (wantsSummary) await summarize(noteId);
    else await generateTitle(noteId);
  } catch (error) {
    // Auto work is best-effort; the note is complete without it.
    console.warn('Automatic summary/title failed:', error);
  }
}

registerJobRunner('summarize', (noteId) => autoProcess(noteId));
