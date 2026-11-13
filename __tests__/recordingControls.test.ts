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
