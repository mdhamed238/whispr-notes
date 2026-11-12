/** Language resolution for engines that can't auto-detect. Pure. */

// Languages the ExecuTorch Whisper tokenizer accepts that we offer in the UI.
const SUPPORTED = new Set(['en', 'fr', 'ar', 'es', 'de', 'it', 'pt', 'nl', 'tr', 'ru', 'hi', 'ja', 'ko', 'zh']);

/**
 * The multilingual ExecuTorch model needs an explicit language (no "auto"),
 * so "auto" falls back to the phone's own language, then English.
 */
export function resolveExecutorchLanguage(requested: string, deviceLocale: string): string {
  if (SUPPORTED.has(requested)) return requested;
  const fromLocale = deviceLocale.split(/[-_]/)[0]?.toLowerCase() ?? 'en';
  return SUPPORTED.has(fromLocale) ? fromLocale : 'en';
}
