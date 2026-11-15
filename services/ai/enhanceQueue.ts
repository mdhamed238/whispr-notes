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
import { getAppLanguage } from '../../i18n';
import * as notesRepo from '../db/notesRepo';
import { getDb } from '../db/database';
import { isProNow } from '../billing/entitlement';
import { peekSettings, updateSettings } from '../settings';
import { releaseLiveWhisperNow } from '../liveWhisper';
import { saveTimeline } from '../timelineStore';
import { detectTier } from './device';
import { createExecutorchEngine } from './engines/executorchEngine';
import { AbortedError, EngineLoadError, type TranscriptionEngine } from './engines/types';
import { createWhisperRnEngine } from './engines/whisperRnEngine';
import { Job, JobKind, isTransientEngineError, nextJob, recoverJobs } from './jobState';
import { effectiveLanguage, engineLanguage } from './language';
import { MODEL_CATALOG } from './modelCatalog';
import * as modelManager from './modelManager';
import { setEnhanceProgress } from './progressStore';
import { chooseEngine, fallbackEngine, handlesLongAudio, type EngineId } from './tiers';

/** ExecuTorch engines transcribe the whole file in one call; past this they'd stall for too long. */
const EXECUTORCH_MAX_SECONDS = 1800;

type Runner = (noteId: string, signal: AbortSignal, job: Job) => Promise<void>;
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
    const jobs = await loadJobs();
    const recovered = recoverJobs(jobs);
    for (const [i, job] of recovered.entries()) {
      // Only jobs a killed app left running need touching.
      if (jobs[i].state !== 'running') continue;
      await saveJob(job);
      if (job.kind === 'enhance') {
        await notesRepo
          .updateNote(job.noteId, { enhancement: job.state === 'failed' ? 'failed' : 'pending', enhancementProgress: 0 })
          .catch(() => undefined);
      }
    }
    // Notes that claim work in progress with no job behind it (e.g. a
    // cancel racing the pump) would show "Enhancing…" forever.
    const db = await getDb();
    const orphans = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM notes WHERE enhancement IN ('pending', 'running')
       AND id NOT IN (SELECT note_id FROM jobs WHERE kind = 'enhance')`
    );
    for (const { id } of orphans) {
      await notesRepo.updateNote(id, { enhancement: 'none', enhancementProgress: 0 }).catch(() => undefined);
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
        if (runner) await runner(job.noteId, controller.signal, running);
        await removeJob(job.noteId, job.kind);
      } catch (error) {
        if (error instanceof AbortedError || controller.signal.aborted) {
          await removeJob(job.noteId, job.kind);
        } else if (error instanceof EngineLoadError && !isTransientEngineError(error)) {
          // A real load failure (memory, corrupt model): remember it and
          // retry on the next engine down (chooseEngine skips failed ones).
          console.warn(error.message);
          const failed = new Set(peekSettings().failedEngines);
          failed.add(error.engine);
          await updateSettings({ failedEngines: [...failed] });
          const spoken = effectiveLanguage(peekSettings().transcriptionLanguage, getAppLanguage());
          const giveUp = fallbackEngine(error.engine, spoken) === null;
          await saveJob({ ...running, state: giveUp ? 'failed' : 'pending' });
          if (giveUp) {
            await notesRepo.updateNote(job.noteId, { enhancement: 'failed', enhancementProgress: 0 }).catch(() => undefined);
          }
          await releaseEngine();
        } else {
          // Includes transient load failures (model still downloading while
          // offline): the note is marked failed and can be re-transcribed,
          // without blacklisting the engine.
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
  // The live preview keeps its model for a moment after a recording; free it
  // first so two speech models are never loaded together.
  await releaseLiveWhisperNow();
  engine =
    id === 'whisper-large-v3-turbo' || id === 'whisper-base'
      ? await createWhisperRnEngine(id)
      : await createExecutorchEngine(id === 'whisper-small' ? 'small' : 'base');
  return engine;
}

/**
 * The engine for this recording and the language to give it, or null when
 * nothing on this phone can do it (the transcript it already has is kept).
 */
function pickEngine(durationSeconds: number): { id: EngineId; language: string } | null {
  const settings = peekSettings();
  const appLanguage = getAppLanguage();
  const pro = isProNow();
  const turboReady = modelManager.status('whisper-large-v3-turbo') === 'ready';
  const failed = [...settings.failedEngines];
  // Turbo is a large download the user starts themselves: skip it until installed.
  if (!turboReady) failed.push('whisper-large-v3-turbo');

  let id: EngineId | null = chooseEngine({
    tier: detectTier(),
    isPro: pro,
    override: settings.tierOverride,
    failedEngines: failed,
    language: effectiveLanguage(settings.transcriptionLanguage, appLanguage),
  });
  // Long recordings need an engine that reads the file in windows.
  if (!handlesLongAudio(id) && durationSeconds > EXECUTORCH_MAX_SECONDS) {
    const longForm: EngineId[] = pro && turboReady ? ['whisper-large-v3-turbo', 'whisper-base'] : ['whisper-base'];
    id = longForm.find((candidate) => !settings.failedEngines.includes(candidate)) ?? null;
  }
  if (!id || settings.failedEngines.includes(id)) return null;
  return { id, language: engineLanguage(id, settings.transcriptionLanguage, appLanguage) };
}

/** Resolves with the task, or rejects as soon as the signal aborts. */
function raceAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new AbortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Fetches a model WhisprNotes hosts itself (the multilingual Base model) the
 * first time a recording needs it. Cancelling the note's job stops the wait,
 * not the download: the next recording will want the model too.
 */
async function ensureModel(id: EngineId, noteId: string, signal: AbortSignal): Promise<void> {
  if (MODEL_CATALOG[id].delivery !== 'manual' || modelManager.status(id) === 'ready') return;
  setEnhanceProgress(noteId, { phase: 'model', fraction: modelManager.progress(id) });
  const unsubscribe = modelManager.subscribeModels((modelId, _status, fraction) => {
    if (modelId === id) setEnhanceProgress(noteId, { phase: 'model', fraction });
  });
  try {
    await raceAbort(modelManager.ensure(id), signal);
  } finally {
    unsubscribe();
  }
}

async function runEnhance(noteId: string, signal: AbortSignal, job: Job): Promise<void> {
  const note = await notesRepo.getNote(noteId);
  if (!note?.audioUri) return;

  const picked = pickEngine(note.duration);
  if (!picked) {
    // Nothing here can transcribe it; keep whatever text the note has.
    await notesRepo.updateNote(noteId, { enhancement: 'none', enhancementProgress: 0 });
    return;
  }

  // Cancelled before getting here: don't resurrect the banner.
  if (signal.aborted) return;
  await notesRepo.updateNote(noteId, { enhancement: 'running', enhancementProgress: 0 });
  const transcriptAtStart = note.transcription;

  try {
    await ensureModel(picked.id, noteId, signal);
    setEnhanceProgress(noteId, { phase: 'transcribing', fraction: 0 });

    const e = await getEngine(picked.id);
    const result = await e.transcribeFile(note.audioUri, {
      language: picked.language,
      languageHint: getAppLanguage(),
      // A job that already took the app down once is retried conservatively.
      safeMode: job.attempts > 1,
      onProgress: (fraction) => setEnhanceProgress(noteId, { phase: 'transcribing', fraction }),
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

    // Summary or AI title next (the runner decides which, see summarizer).
    if (runners.summarize) {
      await saveJob({ noteId, kind: 'summarize', state: 'pending', attempts: 0, createdAt: new Date().toISOString() });
    }
  } finally {
    setEnhanceProgress(noteId, null);
  }
}
