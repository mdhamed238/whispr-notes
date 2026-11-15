import { RecordingControls } from '../services/recordingControls';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('locks repeated Record taps before microphone startup finishes', async () => {
  const startup = deferred<boolean>();
  const phases: string[] = [];
  const controls = new RecordingControls((phase) => phases.push(phase));
  const start = jest.fn(() => startup.promise);
  const first = controls.start(start);
  expect(controls.phase).toBe('starting');
  expect(await controls.start(start)).toBe(false);
  expect(start).toHaveBeenCalledTimes(1);
  startup.resolve(true);
  expect(await first).toBe(true);
  expect(phases).toEqual(['starting', 'recording']);
});

test('shows stopping immediately and blocks new recordings until final transcript is drained', async () => {
  const drain = deferred<void>();
  const controls = new RecordingControls(() => {});
  await controls.start(async () => true);
  const finish = jest.fn(() => drain.promise);
  const stopped = controls.stop(finish);
  expect(controls.phase).toBe('stopping');
  expect(await controls.start(async () => true)).toBe(false);
  const repeatedStop = controls.stop(finish);
  await Promise.resolve();
  expect(finish).toHaveBeenCalledTimes(1);
  expect(controls.phase).toBe('stopping');
  drain.resolve();
  await Promise.all([stopped, repeatedStop]);
  expect(controls.phase).toBe('idle');
  expect(await controls.start(async () => true)).toBe(true);
});

test('permission denial and failed startup leave Record usable', async () => {
  const controls = new RecordingControls(() => {});
  expect(await controls.start(async () => false)).toBe(false);
  expect(controls.phase).toBe('idle');
  await expect(controls.start(async () => { throw new Error('microphone unavailable'); })).rejects.toThrow('microphone unavailable');
  expect(controls.phase).toBe('idle');
  expect(await controls.start(async () => true)).toBe(true);
});

test('a stop failure allows retrying Stop without starting a second microphone', async () => {
  const controls = new RecordingControls(() => {});
  await controls.start(async () => true);
  await expect(controls.stop(async () => { throw new Error('microphone busy'); })).rejects.toThrow('microphone busy');
  expect(controls.phase).toBe('recording');
  expect(await controls.start(async () => true)).toBe(false);
  await controls.stop(async () => {});
  expect(controls.phase).toBe('idle');
});

test('pause and resume only apply from the matching phase', () => {
  const phases: string[] = [];
  const controls = new RecordingControls((phase) => phases.push(phase));
  const pause = jest.fn();
  const resume = jest.fn();
  expect(controls.pause(pause)).toBe(false);
  expect(controls.resume(resume)).toBe(false);
  expect(pause).not.toHaveBeenCalled();
  expect(resume).not.toHaveBeenCalled();
  expect(phases).toEqual([]);
});

test('a recording can be paused, resumed and paused again', async () => {
  const phases: string[] = [];
  const controls = new RecordingControls((phase) => phases.push(phase));
  await controls.start(async () => true);
  const pause = jest.fn();
  const resume = jest.fn();
  expect(controls.pause(pause)).toBe(true);
  expect(controls.inSession).toBe(true);
  // A second Pause tap while paused does nothing.
  expect(controls.pause(pause)).toBe(false);
  expect(controls.resume(resume)).toBe(true);
  expect(controls.resume(resume)).toBe(false);
  expect(controls.pause(pause)).toBe(true);
  expect(pause).toHaveBeenCalledTimes(2);
  expect(resume).toHaveBeenCalledTimes(1);
  expect(phases).toEqual(['starting', 'recording', 'paused', 'recording', 'paused']);
});

test('a paused recording can be stopped, and cannot be started over', async () => {
  const controls = new RecordingControls(() => {});
  await controls.start(async () => true);
  controls.pause(() => {});
  expect(await controls.start(async () => true)).toBe(false);
  const finish = jest.fn(async () => {});
  await controls.stop(finish);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(controls.phase).toBe('idle');
  expect(controls.inSession).toBe(false);
});

test('a microphone that refuses to pause or resume leaves the phase unchanged', async () => {
  const controls = new RecordingControls(() => {});
  await controls.start(async () => true);
  expect(() => controls.pause(() => { throw new Error('busy'); })).toThrow('busy');
  expect(controls.phase).toBe('recording');
  controls.pause(() => {});
  expect(() => controls.resume(() => { throw new Error('busy'); })).toThrow('busy');
  expect(controls.phase).toBe('paused');
});

test('a failed stop from a paused recording returns to paused', async () => {
  const controls = new RecordingControls(() => {});
  await controls.start(async () => true);
  controls.pause(() => {});
  await expect(controls.stop(async () => { throw new Error('microphone busy'); })).rejects.toThrow('microphone busy');
  expect(controls.phase).toBe('paused');
  await controls.stop(async () => {});
  expect(controls.phase).toBe('idle');
});
