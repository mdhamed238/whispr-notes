import { resolveExecutorchLanguage } from '../../services/ai/language';

describe('resolveExecutorchLanguage', () => {
  test('an explicit supported language is used as is', () => {
    expect(resolveExecutorchLanguage('fr', 'en-US')).toBe('fr');
  });
  test('auto falls back to the phone language', () => {
    expect(resolveExecutorchLanguage('auto', 'ar_MA')).toBe('ar');
  });
  test('an unsupported phone language falls back to English', () => {
    expect(resolveExecutorchLanguage('auto', 'sw-KE')).toBe('en');
  });
});
