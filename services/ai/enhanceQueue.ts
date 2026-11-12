/**
 * Persistent background queue for on-device AI work on saved notes:
 * - `enhance`: re-transcribe the recording with the best engine this phone
 *   (and plan) allows, attaching word timings;
 * - `summarize`: write the summary and AI title (runner registered by the
 *   summarizer).
 *
 * Jobs live in SQLite, so a job interrupted by the app being killed resumes
 * on the next launch (see jobState.recoverJobs). The queue runs one job at a
 * time and doesn't start new work while a recording is in progress, so the
 * live transcript keeps the CPU.
 *
 * Results are written with compare-and-swap: if the user edited the
 * transcript while the job ran, their text wins and the result is dropped.
 */
import * as notesRepo from '../db/notesRepo';
import { getDb } from '../db/database';
import { isProNow } from '../billing/entitlement';
import { peekSettings, updateSettings } from '../settings';
import { saveTimeline } from '../timelineStore';
import { detectTier } from './device';
import { createExecutorchEngine } from './engines/executorchEngine';
import { AbortedError, EngineLoadError, type TranscriptionEngine } from './engines/types';
import { createWhisperRnEngine } from './engines/whisperRnEngine';
import { Job, JobKind, nextJob, recoverJobs } from './jobState';
import * as modelManager from './modelManager';
import { chooseEngine, type EngineId } from './tiers';

/** ExecuTorch engines transcribe the whole file in one call; past this they'd stall for too long. */
const EXECUTORCH_MAX_SECONDS = 1800;
const PROGRESS_WRITE_INTERVAL_MS = 1000;

type Runner = (noteId: string, signal: AbortSignal) => Promise<void>;
const runners: Partial<Record<JobKind, Runner>> = { enhance: runEnhance };

export function registerJobRunner(kind: JobKind, runner: Runner): void {
  runners[kind] = runner;
}

let started = false;
let busy = false;
let recordingActive = false;
let current: { job: Job; controller: AbortController } | null = null;
let engine: TranscriptionEngine | null = null;

type JobRow = { note_id: string; kind: string; state: string; attempts: number; created_at: string };
const toJob = (r: JobRow): Job => ({
  noteId: r.note_id,
  kind: r.kind as JobKind,
  state: r.state as Job['state'],
  attempts: r.attempts,
  createdAt: r.created_at,
});

async function loadJobs(): Promise<Job[]> {
  const db = await getDb();
  return (await db.getAllAsync<JobRow>('SELECT * FROM jobs')).map(toJob);
}

async function saveJob(job: Job): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO jobs (note_id, kind, state, attempts, created_at) VALUES (?, ?, ?, ?, ?)',
    job.noteId,
    job.kind,
    job.state,
    job.attempts,
    job.createdAt
  );
}

async function removeJob(noteId: string, kind?: JobKind): Promise<void> {
  const db = await getDb();
  if (kind) await db.runAsync('DELETE FROM jobs WHERE note_id = ? AND kind = ?', noteId, kind);
  else await db.runAsync('DELETE FROM jobs WHERE note_id = ?', noteId);
}

/** Call once at launch. */
export async function start(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const recovered = recoverJobs(await loadJobs());
    for (const job of recovered) {
      await saveJob(job);
      if (job.kind === 'enhance') {
        await notesRepo
          .updateNote(job.noteId, { enhancement: job.state === 'failed' ? 'failed' : 'pending', enhancementProgress: 0 })
          .catch(() => undefined);
      }
    }
  } catch (error) {
    console.warn('Failed to recover AI jobs:', error);
  }
  void pump();
}

export async function enqueue(noteId: string, kind: JobKind): Promise<void> {
  await saveJob({ noteId, kind, state: 'pending', attempts: 0, createdAt: new Date().toISOString() });
  if (kind === 'enhance') {
    await notesRepo.updateNote(noteId, { enhancement: 'pending', enhancementProgress: 0 }).catch(() => undefined);
  }
  void pump();
}

/** Cancels queued and running work for a note. */
export async function cancel(noteId: string, kind?: JobKind): Promise<void> {
  if (current && current.job.noteId === noteId && (!kind || current.job.kind === kind)) {
    current.controller.abort();
  }
  await removeJob(noteId, kind);
  if (!kind || kind === 'enhance') {
    await notesRepo.updateNote(noteId, { enhancement: 'none', enhancementProgress: 0 }).catch(() => undefined);
  }
}

export function isJobRunning(noteId: string, kind: JobKind): boolean {
  return current?.job.noteId === noteId && current.job.kind === kind;
}

/** The record screen flips this so heavy passes wait while the mic is live. */
export function setRecordingActive(active: boolean): void {
  recordingActive = active;
  if (!active) void pump();
}

async function pump(): Promise<void> {
  if (busy || recordingActive) return;
  busy = true;
  try {
    for (;;) {
      if (recordingActive) break;
      const job = nextJob(await loadJobs());
      if (!job) break;

      const running: Job = { ...job, state: 'running', attempts: job.attempts + 1 };
      await saveJob(running);
      const controller = new AbortController();
      current = { job: running, controller };

      try {
        const runner = runners[job.kind];
        if (runner) await runner(job.noteId, controller.signal);
        await removeJob(job.noteId, job.kind);
      } catch (error) {
        if (error instanceof AbortedError || controller.signal.aborted) {
          await removeJob(job.noteId, job.kind);
        } else if (error instanceof EngineLoadError) {
          // Remember the engine that can't load here and retry the job on
          // the next one down (chooseEngine skips failed engines).
          console.warn(error.message);
          const failed = new Set(peekSettings().failedEngines);
          failed.add(error.engine);
          await updateSettings({ failedEngines: [...failed] });
          await saveJob({ ...running, state: error.engine === 'whisper-base-en' ? 'failed' : 'pending' });
          await releaseEngine();
        } else {
          console.warn(`AI job ${job.kind} failed for ${job.noteId}:`, error);
          await saveJob({ ...running, state: 'failed' });
          if (job.kind === 'enhance') {
            await notesRepo.updateNote(job.noteId, { enhancement: 'failed', enhancementProgress: 0 }).catch(() => undefined);
          }
        }
      } finally {
        current = null;
      }
    }
  } finally {
    busy = false;
    // Free the large models' memory once there's nothing left to do.
    if (!current) await releaseEngine();
  }
}

async function releaseEngine(): Promise<void> {
  const e = engine;
  engine = null;
  await e?.release().catch(() => undefined);
}

async function getEngine(id: EngineId): Promise<TranscriptionEngine> {
  if (engine?.id === id) return engine;
  await releaseEngine();
  engine =
    id === 'whisper-large-v3-turbo'
      ? await createWhisperRnEngine()
      : await createExecutorchEngine(id === 'whisper-small' ? 'small' : 'base');
  return engine;
}

/** Picks the engine, skipping Turbo when its weights aren't downloaded yet. */
function pickEngine(durationSeconds: number): EngineId {
  const settings = peekSettings();
  const failed = [...settings.failedEngines];
  if (modelManager.status('whisper-large-v3-turbo') !== 'ready') failed.push('whisper-large-v3-turbo');
  let id = chooseEngine({ tier: detectTier(), isPro: isProNow(), override: settings.tierOverride, failedEngines: failed });
  // Long recordings need the engine that streams through the file.
  if (id !== 'whisper-large-v3-turbo' && durationSeconds > EXECUTORCH_MAX_SECONDS) {
    id = modelManager.status('whisper-large-v3-turbo') === 'ready' ? 'whisper-large-v3-turbo' : id;
  }
  return id;
}

async function runEnhance(noteId: string, signal: AbortSignal): Promise<void> {
  const note = await notesRepo.getNote(noteId);
  if (!note?.audioUri) return;

  const engineId = pickEngine(note.duration);
  if (engineId !== 'whisper-large-v3-turbo' && note.duration > EXECUTORCH_MAX_SECONDS) {
    // Too long for a one-shot pass on this engine; keep the live transcript.
    await notesRepo.updateNote(noteId, { enhancement: 'none', enhancementProgress: 0 });
    return;
  }

  await notesRepo.updateNote(noteId, { enhancement: 'running', enhancementProgress: 0 });
  const transcriptAtStart = note.transcription;

  let lastWrite = 0;
  const onProgress = (fraction: number) => {
    const now = Date.now();
    if (now - lastWrite < PROGRESS_WRITE_INTERVAL_MS) return;
    lastWrite = now;
    void notesRepo.updateNote(noteId, { enhancementProgress: fraction }).catch(() => undefined);
  };

  const e = await getEngine(engineId);
  const result = await e.transcribeFile(note.audioUri, {
    language: peekSettings().transcriptionLanguage,
    onProgress,
    signal,
  });

  const stored = await notesRepo.getNote(noteId);
  if (!stored) return;
  // The user's edit wins outright; timings would describe replaced words.
  if (!result || stored.transcription !== transcriptAtStart) {
    await notesRepo.updateNote(noteId, { enhancement: 'done', enhancementProgress: 1 });
    return;
  }

  const written = await notesRepo.updateNote(
    noteId,
    { transcription: result.text, language: result.language, enhancement: 'done', enhancementProgress: 1 },
    { expectUpdatedAt: stored.updatedAt }
  );
  if (!written) {
    // An edit landed between the read and the write: keep it.
    await notesRepo.updateNote(noteId, { enhancement: 'done', enhancementProgress: 1 });
    return;
  }
  // Only once the text it describes is the stored text.
  if (result.segments.length > 0) saveTimeline(noteId, result.segments);

  if (peekSettings().autoSummarize && runners.summarize) {
    await saveJob({ noteId, kind: 'summarize', state: 'pending', attempts: 0, createdAt: new Date().toISOString() });
  }
}
