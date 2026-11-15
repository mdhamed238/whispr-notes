/**
 * Pure export generators: turn a note (and optionally its timeline) into
 * file contents. No native imports, so all of this is unit-tested.
 */

import type { Note, NoteSummary, TranscriptSegment } from '../../types';

export type ExportScope = 'summary' | 'full';

/** Section names written into exports. English unless the caller translates them. */
export interface ExportLabels {
  summary: string;
  keyPoints: string;
  actionItems: string;
  decisions: string;
  transcript: string;
  tags: string;
  /** PDF footer. */
  madeWith: string;
  aiDisclaimer: string;
}

export const DEFAULT_EXPORT_LABELS: ExportLabels = {
  summary: 'Summary',
  keyPoints: 'Key points',
  actionItems: 'Action items',
  decisions: 'Decisions',
  transcript: 'Transcript',
  tags: 'Tags',
  madeWith: 'Transcribed and summarized on-device with WhisprNotes.',
  aiDisclaimer: 'AI summaries can contain mistakes.',
};

// ASCII and Latin-1 punctuation and spaces, general punctuation, and the
// CJK, full-width, Arabic and Devanagari marks that would be awkward in a
// file name. Letters and digits of every script are kept.
const NOT_FILE_NAME_SAFE =
  /[\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u00bf\u00d7\u00f7\u2000-\u206f\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\u060c\u061b\u061f\u06d4\u0964\u0965]+/g;

/**
 * File-name-safe slug: `Q3: Plan / Review!` → `q3-plan-review`. Titles in
 * other scripts keep their letters (`会议记录` stays `会议记录`), so exports of
 * non-Latin notes aren't all called "note".
 */
export function slugify(title: string): string {
  const cleaned = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(NOT_FILE_NAME_SAFE, '-')
    .replace(/^-+|-+$/g, '');
  // By code point, so a cut never lands inside a surrogate pair.
  const slug = Array.from(cleaned).slice(0, 60).join('').replace(/-+$/g, '');
  return slug || 'note';
}

export function formatSrtTimestamp(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  // Milliseconds are truncated rather than rounded: rounding up at .9995
  // could push a cue's start past its own end on a very short word.
  const totalMs = Math.floor(safeSeconds * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${milliseconds.toString().padStart(3, '0')}`;
}

/** `m:ss`, or `h:mm:ss` past an hour. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * Keeps only segments that can produce a valid cue, in playable order, so a
 * degenerate timeline (zero-length spans, out-of-order starts) never yields
 * a file that players reject.
 */
export function usableSegments(segments: TranscriptSegment[] | null | undefined): TranscriptSegment[] {
  if (!segments || segments.length === 0) return [];
  return segments
    .filter((segment) => segment.text.trim().length > 0 && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);
}

export function formatNoteDate(date: Date, locale = 'en-US'): string {
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  try {
    return date.toLocaleString(locale, options);
  } catch {
    return date.toLocaleString('en-US', options);
  }
}

interface TextOptions {
  labels?: ExportLabels;
  /** BCP 47 tag for the date line. */
  locale?: string;
}

function metaLine(note: Note, labels: ExportLabels, locale?: string): string {
  return [
    formatNoteDate(note.createdAt, locale),
    note.duration > 0 ? formatClock(note.duration) : null,
    note.tags.length > 0 ? `${labels.tags}: ${note.tags.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function summaryText(summary: NoteSummary, labels: ExportLabels): string {
  const section = (heading: string, items: string[]) =>
    items.length > 0 ? `\n${heading.toUpperCase()}\n${items.map((item) => `- ${item}`).join('\n')}\n` : '';
  return (
    `${labels.summary.toUpperCase()}\n${summary.overview.trim()}\n` +
    section(labels.keyPoints, summary.keyPoints) +
    section(labels.actionItems, summary.actionItems) +
    section(labels.decisions, summary.decisions)
  );
}

export function toText(note: Note, o: { scope: ExportScope } & TextOptions): string {
  const labels = o.labels ?? DEFAULT_EXPORT_LABELS;
  const parts = [`${note.title}\n${metaLine(note, labels, o.locale)}\n`];
  if (note.summary) parts.push(summaryText(note.summary, labels));
  if (o.scope === 'full' || !note.summary) {
    parts.push(
      note.summary
        ? `${labels.transcript.toUpperCase()}\n${note.transcription.trim()}\n`
        : `${note.transcription.trim()}\n`
    );
  }
  return parts.join('\n');
}

export function toSrt(note: Note, timeline: TranscriptSegment[] | null): string {
  const segments = usableSegments(timeline);

  // Fallback for notes with no timeline: one cue spanning the recording.
  if (segments.length === 0) {
    return `1\n00:00:00,000 --> ${formatSrtTimestamp(note.duration)}\n${note.transcription}\n\n`;
  }

  return segments
    .map(
      (segment, index) =>
        `${index + 1}\n${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end)}\n${segment.text.trim()}\n`
    )
    .join('\n');
}

/** `[mm:ss]` stamp, or `[h:mm:ss]` past an hour. */
export function stamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

export function toMarkdown(
  note: Note,
  o: { scope: ExportScope; segments: TranscriptSegment[] | null; timestamps: boolean; labels?: ExportLabels }
): string {
  const labels = o.labels ?? DEFAULT_EXPORT_LABELS;
  const front = [
    '---',
    `title: ${yamlString(note.title)}`,
    `date: ${note.createdAt.toISOString()}`,
    note.duration > 0 ? `duration: ${formatClock(note.duration)}` : null,
    note.tags.length > 0 ? `tags: [${note.tags.map(yamlString).join(', ')}]` : null,
    note.language ? `language: ${yamlString(note.language)}` : null,
    'source: WhisprNotes',
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  const parts: string[] = [front, `# ${note.title}`];
  const s = note.summary;
  if (s) {
    if (s.overview) parts.push(`## ${labels.summary}\n\n${s.overview.trim()}`);
    if (s.keyPoints.length) parts.push(`## ${labels.keyPoints}\n\n${s.keyPoints.map((i) => `- ${i}`).join('\n')}`);
    if (s.actionItems.length) parts.push(`## ${labels.actionItems}\n\n${s.actionItems.map((i) => `- [ ] ${i}`).join('\n')}`);
    if (s.decisions.length) parts.push(`## ${labels.decisions}\n\n${s.decisions.map((i) => `- ${i}`).join('\n')}`);
  }

  if (o.scope === 'full' || !s) {
    const segs = usableSegments(o.segments);
    const body =
      o.timestamps && segs.length > 0
        ? segs.map((seg) => `[${stamp(seg.start)}] ${seg.text.trim()}`).join('\n\n')
        : note.transcription.trim();
    parts.push(s ? `## ${labels.transcript}\n\n${body}` : body);
  }
  return `${parts.join('\n\n')}\n`;
}
