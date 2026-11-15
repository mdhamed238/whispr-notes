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

describe('continuing after a pause', () => {
  const { joinTranscript } = require('../services/liveTranscription');

  test('text from before the pause stays in front of the new stream', async () => {
    const updates: { committed: string; nonCommitted: string }[] = [];
    async function* stream() {
      yield { committed: result(''), nonCommitted: result('and then') };
      yield { committed: result('And then we left.'), nonCommitted: result('') };
    }
    const text = await consumeLiveTranscript(stream(), (update) => updates.push(update), 'We arrived early.');
    expect(updates[0]).toEqual({ committed: 'We arrived early.', nonCommitted: 'and then' });
    expect(updates[1]).toEqual({ committed: 'We arrived early. And then we left.', nonCommitted: '' });
    expect(text).toBe('We arrived early. And then we left.');
  });

  test('joining never doubles or drops the space', () => {
    expect(joinTranscript('', 'Hello')).toBe('Hello');
    expect(joinTranscript('Hello', '')).toBe('Hello');
    expect(joinTranscript('Hello', 'there')).toBe('Hello there');
    expect(joinTranscript('Hello ', 'there')).toBe('Hello there');
    expect(joinTranscript('Hello', ' there')).toBe('Hello there');
    expect(joinTranscript('今日は', '会議です', true)).toBe('今日は会議です');
  });
});
