/**
 * Background job bookkeeping for the AI queue. Pure; persistence and
 * execution live in enhanceQueue.ts.
 */

export type JobKind = 'enhance' | 'summarize';

export interface Job {
  noteId: string;
  kind: JobKind;
  state: 'pending' | 'running' | 'failed';
  attempts: number;
  createdAt: string;
}

/** A job that crashed the app this many times is given up on. */
export const MAX_ATTEMPTS = 3;

/** Run at launch: jobs a killed app left "running" go back to pending. */
export function recoverJobs(jobs: Job[]): Job[] {
  return jobs.map((job) => {
    if (job.state !== 'running') return job;
    return { ...job, state: job.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' };
  });
}

/** Enhancements first (summaries read their text), then oldest first. */
export function nextJob(jobs: Job[]): Job | null {
  const pending = jobs.filter((job) => job.state === 'pending');
  if (pending.length === 0) return null;
  const rank = (job: Job) => (job.kind === 'enhance' ? 0 : 1);
  return pending.reduce((best, job) =>
    rank(job) < rank(best) || (rank(job) === rank(best) && job.createdAt < best.createdAt) ? job : best
  );
}
