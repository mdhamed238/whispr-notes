import { Job, MAX_ATTEMPTS, nextJob, recoverJobs } from '../../services/ai/jobState';

const job = (over: Partial<Job>): Job => ({
  noteId: '1',
  kind: 'enhance',
  state: 'pending',
  attempts: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('recoverJobs', () => {
  test('a job left running by a killed app is pending again', () => {
    expect(recoverJobs([job({ state: 'running', attempts: 1 })])[0].state).toBe('pending');
  });
  test('a job that keeps crashing is given up on', () => {
    expect(recoverJobs([job({ state: 'running', attempts: MAX_ATTEMPTS })])[0].state).toBe('failed');
  });
  test('pending and failed jobs are left alone', () => {
    const jobs = [job({ state: 'pending' }), job({ noteId: '2', state: 'failed' })];
    expect(recoverJobs(jobs)).toEqual(jobs);
  });
});

describe('nextJob', () => {
  test('enhancement runs before an earlier-queued summary', () => {
    const summary = job({ noteId: 'a', kind: 'summarize', createdAt: '2026-01-01T00:00:00.000Z' });
    const enhance = job({ noteId: 'b', kind: 'enhance', createdAt: '2026-01-02T00:00:00.000Z' });
    expect(nextJob([summary, enhance])).toBe(enhance);
  });
  test('first in, first out within a kind', () => {
    const older = job({ noteId: 'a', createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = job({ noteId: 'b', createdAt: '2026-01-02T00:00:00.000Z' });
    expect(nextJob([newer, older])).toBe(older);
  });
  test('nothing to do when no job is pending', () => {
    expect(nextJob([job({ state: 'failed' }), job({ state: 'running' })])).toBeNull();
  });
});

describe('review fixes', () => {
  const { isTransientEngineError, restoredEnhancement } = require('../../services/ai/jobState');
  test('network and download failures are transient, not a broken engine', () => {
    expect(isTransientEngineError(new Error('Network request failed'))).toBe(true);
    expect(isTransientEngineError(new Error('Failed to load whisper-small: download failed: timeout'))).toBe(true);
    expect(isTransientEngineError(new Error('The Internet connection appears to be offline.'))).toBe(true);
    expect(isTransientEngineError(new Error('Failed to load: out of memory'))).toBe(false);
  });
  test('a restored note never comes back mid-enhancement', () => {
    expect(restoredEnhancement('running')).toBe('none');
    expect(restoredEnhancement('pending')).toBe('none');
    expect(restoredEnhancement('done')).toBe('done');
  });
});
