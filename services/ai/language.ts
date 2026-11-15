/** Which language a recording is transcribed in, and what each engine is told. Pure. */
import { AUTO_LANGUAGE, languageInfo } from '../../constants/languages';
import type { EngineId } from './tiers';

/**
 * The multilingual ExecuTorch model needs an explicit language (no "auto"),
 * so "auto" falls back to the given locale's language, then English.
 */
export function resolveExecutorchLanguage(requested: string, deviceLocale: string): string {
  return languageInfo(requested)?.code ?? languageInfo(deviceLocale)?.code ?? 'en';
}

/**
 * The language a recording is expected to be in: the user's choice, or with
 * "Automatic" the language they use the app in. Never 'auto'.
 */
export function effectiveLanguage(setting: string, appLanguage: string): string {
  return resolveExecutorchLanguage(setting === AUTO_LANGUAGE ? '' : setting, appLanguage);
}

/**
 * Which model writes the live preview while recording. English streams word
 * by word through the English-only model; every other language runs the
 * multilingual model over a sliding window (services/livePreview.ts).
 */
export function livePreviewEngine(setting: string, appLanguage: string): 'whisper-base-en' | 'whisper-base' {
  return effectiveLanguage(setting, appLanguage) === 'en' ? 'whisper-base-en' : 'whisper-base';
}

/**
 * What an engine is asked to transcribe in. Only Large-v3 Turbo is trusted to
 * detect the spoken language by itself; the compact models are told, because
 * their detection confuses close languages and a wrong guess ruins the
 * whole transcript.
 */
export function engineLanguage(engine: EngineId, setting: string, appLanguage: string): string {
  if (engine === 'whisper-base-en') return 'en';
  if (engine === 'whisper-large-v3-turbo' && setting === AUTO_LANGUAGE) return AUTO_LANGUAGE;
  return effectiveLanguage(setting, appLanguage);
}

/**
 * The language a summary is written in: 'transcript' keeps the note's own
 * language (null when unknown, and the model is told to match the text),
 * 'app' uses the interface language, anything else is a fixed language.
 * Choosing a language other than the transcript's is part of Pro.
 */
export function resolveSummaryLanguage(
  setting: string,
  noteLanguage: string | null,
  appLanguage: string,
  isPro: boolean
): string | null {
  const own = languageInfo(noteLanguage)?.code ?? null;
  if (!isPro || setting === 'transcript') return own;
  if (setting === 'app') return languageInfo(appLanguage)?.code ?? own;
  return languageInfo(setting)?.code ?? own;
}
