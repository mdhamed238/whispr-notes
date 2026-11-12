/**
 * Minimal Markdown tokenizer for the in-app legal pages: h1-h3, paragraphs,
 * bullet lists, simple tables, **bold**, *italic* and [links](url). Pure.
 */

export interface Span {
  text: string;
  bold?: true;
  italic?: true;
  href?: string;
}

export type Block =
  | { type: 'h1' | 'h2' | 'h3' | 'p'; spans: Span[] }
  | { type: 'list'; items: Span[][] }
  | { type: 'table'; rows: string[][] };

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\*(.+?)\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) spans.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) spans.push({ text: m[2], href: m[3] });
    else spans.push({ text: m[4], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function tokenizeMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: Span[][] | null = null;
  let table: string[][] | null = null;

  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'p', spans: parseInline(paragraph.join(' ')) });
    if (list) blocks.push({ type: 'list', items: list });
    if (table) blocks.push({ type: 'table', rows: table });
    paragraph = [];
    list = null;
    table = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: `h${heading[1].length}` as 'h1' | 'h2' | 'h3', spans: parseInline(heading[2].trim()) });
    } else if (/^\s*\|/.test(line)) {
      if (paragraph.length || list) flush();
      if (/^\s*\|?\s*:?-{3,}/.test(line)) continue; // separator row
      table = table ?? [];
      table.push(cells(line));
    } else if (bullet) {
      if (paragraph.length || table) flush();
      list = list ?? [];
      list.push(parseInline(bullet[1].trim()));
    } else {
      if (list || table) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}
