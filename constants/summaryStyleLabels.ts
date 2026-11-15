import type { TKey } from '@/i18n';
import type { SummaryStyle } from '@/services/ai/summaryStyles';

/** Translation key for each summary style's name. */
export const STYLE_LABELS: Record<SummaryStyle, TKey> = {
  meeting: 'summary.style.meeting',
  lecture: 'summary.style.lecture',
  interview: 'summary.style.interview',
  memo: 'summary.style.memo',
  brief: 'summary.style.brief',
};
