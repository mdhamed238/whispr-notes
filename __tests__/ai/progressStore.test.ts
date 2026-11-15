import { getEnhanceProgress, setEnhanceProgress, subscribeEnhanceProgress } from '../../services/ai/progressStore';

describe('progressStore', () => {
  test('publishes whole-percent steps only', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeEnhanceProgress(listener);
    setEnhanceProgress('n1', { phase: 'transcribing', fraction: 0.101 });
    setEnhanceProgress('n1', { phase: 'transcribing', fraction: 0.104 });
    setEnhanceProgress('n1', { phase: 'transcribing', fraction: 0.2 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getEnhanceProgress('n1')).toEqual({ phase: 'transcribing', fraction: 0.2 });
    unsubscribe();
    setEnhanceProgress('n1', null);
  });

  test('a phase change is published even at the same fraction, and unknown progress is kept as -1', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeEnhanceProgress(listener);
    setEnhanceProgress('n2', { phase: 'model', fraction: 0 });
    setEnhanceProgress('n2', { phase: 'transcribing', fraction: 0 });
    setEnhanceProgress('n2', { phase: 'transcribing', fraction: -1 });
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getEnhanceProgress('n2')?.fraction).toBe(-1);
    unsubscribe();
    setEnhanceProgress('n2', null);
  });

  test('clearing removes the entry and tells listeners once', () => {
    setEnhanceProgress('n3', { phase: 'transcribing', fraction: 0.5 });
    const listener = jest.fn();
    const unsubscribe = subscribeEnhanceProgress(listener);
    setEnhanceProgress('n3', null);
    setEnhanceProgress('n3', null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getEnhanceProgress('n3')).toBeNull();
    unsubscribe();
  });
});
