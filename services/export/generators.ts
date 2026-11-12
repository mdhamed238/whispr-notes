/**
 * Pure export generators: turn a note (and optionally its timeline) into
 * file contents. No native imports, so all of this is unit-tested.
 */

import type { Note, NoteSummary, TranscriptSegment } from '../../types';

export type ExportScope = 'summary' | 'full';

/** File-name-safe slug: `Q3: Plan / Review!` → `q3-plan-review`. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
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

export function formatNoteDate(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function metaLine(note: Note): string {
  return [
    formatNoteDate(note.createdAt),
    note.duration > 0 ? formatClock(note.duration) : null,
    note.tags.length > 0 ? `Tags: ${note.tags.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function summaryText(summary: NoteSummary): string {
  const section = (heading: string, items: string[]) =>
    items.length > 0 ? `\n${heading}\n${items.map((item) => `- ${item}`).join('\n')}\n` : '';
  return (
    `SUMMARY\n${summary.overview.trim()}\n` +
    section('KEY POINTS', summary.keyPoints) +
    section('ACTION ITEMS', summary.actionItems) +
    section('DECISIONS', summary.decisions)
  );
}

export function toText(note: Note, o: { scope: ExportScope }): string {
  const parts = [`${note.title}\n${metaLine(note)}\n`];
  if (note.summary) parts.push(summaryText(note.summary));
  if (o.scope === 'full' || !note.summary) {
    parts.push(note.summary ? `TRANSCRIPT\n${note.transcription.trim()}\n` : `${note.transcription.trim()}\n`);
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
