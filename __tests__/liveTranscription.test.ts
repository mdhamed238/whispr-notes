import { consumeLiveTranscript } from '../services/liveTranscription';

const result = (text: string) => ({ text, language: 'en', duration: 1 });

test('replaces interim guesses and keeps final words emitted after Stop', async () => {
  const updates: { committed: string; nonCommitted: string }[] = [];
  async function* stream() {
    yield { committed: result(''), nonCommitted: result('Bye everyone') };
    yield { committed: result(''), nonCommitted: result('Hi everyone') };
    yield { committed: result('Hi everyone.'), nonCommitted: result(' Last') };
    yield { committed: result(' Last words.'), nonCommitted: result('') };
  }
  const text = await consumeLiveTranscript(stream(), (update) => updates.push(update));
  expect(updates[1]).toEqual({ committed: '', nonCommitted: 'Hi everyone' });
  expect(updates[2]).toEqual({ committed: 'Hi everyone.', nonCommitted: ' Last' });
  expect(text).toBe('Hi everyone. Last words.');
  expect(updates[3]).toEqual({ committed: 'Hi everyone. Last words.', nonCommitted: '' });
});

test('does not finish before a pending final stream update', async () => {
  let finish!: () => void;
  const stopped = new Promise<void>((resolve) => { finish = resolve; });
  async function* stream() {
    yield { committed: result('First.'), nonCommitted: result(' Last') };
    await stopped;
    yield { committed: result(' Last.'), nonCommitted: result('') };
  }
  let done = false;
  const task = consumeLiveTranscript(stream(), () => {}).then((text) => { done = true; return text; });
  await Promise.resolve();
  expect(done).toBe(false);
  finish();
  expect(await task).toBe('First. Last.');
});
