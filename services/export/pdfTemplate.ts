/**
 * Self-contained HTML for PDF export (rendered by expo-print). No remote
 * fonts, images or scripts: everything is inline, so exporting works offline
 * and the document never calls home.
 */
import { logoSvg } from '../../constants/logo';
import type { Note, TranscriptSegment } from '../../types';
import { ExportScope, formatClock, formatNoteDate, stamp, usableSegments } from './generators';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function list(items: string[], checkbox = false): string {
  return `<ul class="${checkbox ? 'checks' : ''}">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

export function buildPdfHtml(
  note: Note,
  o: { scope: ExportScope; segments: TranscriptSegment[] | null; timestamps: boolean }
): string {
  const s = note.summary;
  const meta = [
    formatNoteDate(note.createdAt),
    note.duration > 0 ? formatClock(note.duration) : null,
    note.tags.length ? note.tags.map((t) => `#${t}`).join(' ') : null,
  ]
    .filter(Boolean)
    .map((m) => escapeHtml(m as string))
    .join(' &middot; ');

  const summaryHtml = s
    ? `
      <section class="summary">
        <h2>Summary</h2>
        <p>${escapeHtml(s.overview)}</p>
        ${s.keyPoints.length ? `<h3>Key points</h3>${list(s.keyPoints)}` : ''}
        ${s.actionItems.length ? `<h3>Action items</h3>${list(s.actionItems, true)}` : ''}
        ${s.decisions.length ? `<h3>Decisions</h3>${list(s.decisions)}` : ''}
      </section>`
    : '';

  const segs = usableSegments(o.segments);
  const transcriptHtml =
    o.scope === 'full' || !s
      ? `
      <section>
        <h2>Transcript</h2>
        ${
          o.timestamps && segs.length
            ? segs.map((seg) => `<p><span class="ts">${stamp(seg.start)}</span>${escapeHtml(seg.text.trim())}</p>`).join('')
            : note.transcription
                .split(/\n{2,}/)
                .map((para) => `<p>${escapeHtml(para.trim())}</p>`)
                .join('')
        }
      </section>`
      : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(note.title)}</title>
<style>
  @page { size: A4; margin: 22mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Roboto, Arial, sans-serif; color: #1B1622; font-size: 11.5pt; line-height: 1.55; margin: 0; }
  header { display: flex; align-items: center; gap: 14px; padding-bottom: 14px; border-bottom: 2px solid #FF6A4D; margin-bottom: 20px; }
  header svg { width: 44px; height: 44px; flex: none; }
  h1 { font-size: 20pt; margin: 0; line-height: 1.2; }
  .meta { color: #7D7586; font-size: 9.5pt; margin-top: 4px; }
  h2 { font-size: 13pt; margin: 22px 0 8px; color: #2A1D3A; }
  h3 { font-size: 10pt; text-transform: uppercase; letter-spacing: .06em; color: #E8553B; margin: 14px 0 6px; }
  .summary { background: #FFF4F1; border-radius: 10px; padding: 4px 18px 12px; }
  ul { margin: 0; padding-left: 18px; }
  ul.checks { list-style: none; padding-left: 0; }
  ul.checks li::before { content: "\\2610"; margin-right: 8px; color: #E8553B; }
  li { margin: 3px 0; }
  p { margin: 0 0 10px; }
  .ts { display: inline-block; min-width: 46px; color: #E8553B; font-variant-numeric: tabular-nums; font-size: 9pt; }
  footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #ECE5E2; color: #7D7586; font-size: 8.5pt; }
</style></head>
<body>
  <header>${logoSvg(44, true, false)}<div><h1>${escapeHtml(note.title)}</h1><div class="meta">${meta}</div></div></header>
  ${summaryHtml}
  ${transcriptHtml}
  <footer>Transcribed and summarized on-device with WhisprNotes.${s ? ' AI summaries can contain mistakes.' : ''}</footer>
</body></html>`;
}
