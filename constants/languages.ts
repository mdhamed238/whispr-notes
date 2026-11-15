/**
 * Languages WhisprNotes can transcribe and summarize. Pure data.
 *
 * Every code here is accepted by both speech engines (whisper.cpp and the
 * ExecuTorch Whisper tokenizer) and is one Qwen3 writes competently, so a
 * language offered in the UI works end to end: transcript, summary, title.
 */

/** Writing system, used to size LLM chunks (tokens per character differ a lot). */
export type Script = 'latin' | 'cyrillic' | 'greek' | 'arabic' | 'hebrew' | 'indic' | 'thai' | 'cjk';

export interface LanguageInfo {
  /** ISO 639-1 code, as Whisper expects it. */
  code: string;
  /** English name, used when instructing the summary model. */
  name: string;
  /** The language's own name, shown in pickers. */
  endonym: string;
  script: Script;
  /** Written right to left. */
  rtl?: boolean;
  /** Written without spaces between words. */
  unspaced?: boolean;
}

export const AUTO_LANGUAGE = 'auto';

export const LANGUAGES: LanguageInfo[] = [
  { code: 'en', name: 'English', endonym: 'English', script: 'latin' },
  { code: 'fr', name: 'French', endonym: 'Français', script: 'latin' },
  { code: 'es', name: 'Spanish', endonym: 'Español', script: 'latin' },
  { code: 'de', name: 'German', endonym: 'Deutsch', script: 'latin' },
  { code: 'it', name: 'Italian', endonym: 'Italiano', script: 'latin' },
  { code: 'pt', name: 'Portuguese', endonym: 'Português', script: 'latin' },
  { code: 'nl', name: 'Dutch', endonym: 'Nederlands', script: 'latin' },
  { code: 'ar', name: 'Arabic', endonym: 'العربية', script: 'arabic', rtl: true },
  { code: 'tr', name: 'Turkish', endonym: 'Türkçe', script: 'latin' },
  { code: 'ru', name: 'Russian', endonym: 'Русский', script: 'cyrillic' },
  { code: 'uk', name: 'Ukrainian', endonym: 'Українська', script: 'cyrillic' },
  { code: 'pl', name: 'Polish', endonym: 'Polski', script: 'latin' },
  { code: 'cs', name: 'Czech', endonym: 'Čeština', script: 'latin' },
  { code: 'sv', name: 'Swedish', endonym: 'Svenska', script: 'latin' },
  { code: 'da', name: 'Danish', endonym: 'Dansk', script: 'latin' },
  { code: 'no', name: 'Norwegian', endonym: 'Norsk', script: 'latin' },
  { code: 'fi', name: 'Finnish', endonym: 'Suomi', script: 'latin' },
  { code: 'el', name: 'Greek', endonym: 'Ελληνικά', script: 'greek' },
  { code: 'ro', name: 'Romanian', endonym: 'Română', script: 'latin' },
  { code: 'hu', name: 'Hungarian', endonym: 'Magyar', script: 'latin' },
  { code: 'bg', name: 'Bulgarian', endonym: 'Български', script: 'cyrillic' },
  { code: 'hr', name: 'Croatian', endonym: 'Hrvatski', script: 'latin' },
  { code: 'sk', name: 'Slovak', endonym: 'Slovenčina', script: 'latin' },
  { code: 'ca', name: 'Catalan', endonym: 'Català', script: 'latin' },
  { code: 'he', name: 'Hebrew', endonym: 'עברית', script: 'hebrew', rtl: true },
  { code: 'fa', name: 'Persian', endonym: 'فارسی', script: 'arabic', rtl: true },
  { code: 'ur', name: 'Urdu', endonym: 'اردو', script: 'arabic', rtl: true },
  { code: 'hi', name: 'Hindi', endonym: 'हिन्दी', script: 'indic' },
  { code: 'bn', name: 'Bengali', endonym: 'বাংলা', script: 'indic' },
  { code: 'ta', name: 'Tamil', endonym: 'தமிழ்', script: 'indic' },
  { code: 'id', name: 'Indonesian', endonym: 'Bahasa Indonesia', script: 'latin' },
  { code: 'ms', name: 'Malay', endonym: 'Bahasa Melayu', script: 'latin' },
  { code: 'vi', name: 'Vietnamese', endonym: 'Tiếng Việt', script: 'latin' },
  { code: 'th', name: 'Thai', endonym: 'ไทย', script: 'thai', unspaced: true },
  { code: 'ja', name: 'Japanese', endonym: '日本語', script: 'cjk', unspaced: true },
  { code: 'ko', name: 'Korean', endonym: '한국어', script: 'cjk' },
  { code: 'zh', name: 'Chinese', endonym: '中文', script: 'cjk', unspaced: true },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

/** Accepts a bare code or a locale tag (`pt-BR`, `zh_Hans`). */
export function languageInfo(code: string | null | undefined): LanguageInfo | null {
  if (!code) return null;
  return BY_CODE.get(code.split(/[-_]/)[0].toLowerCase()) ?? null;
}

export function isSupportedLanguage(code: string | null | undefined): boolean {
  return languageInfo(code) !== null;
}

/** The language's own name; unknown codes fall back to the code itself. */
export function languageLabel(code: string | null | undefined): string {
  return languageInfo(code)?.endonym ?? (code ? code.toUpperCase() : '');
}

export function isRtlLanguage(code: string | null | undefined): boolean {
  return languageInfo(code)?.rtl === true;
}

export function isUnspacedLanguage(code: string | null | undefined): boolean {
  return languageInfo(code)?.unspaced === true;
}
