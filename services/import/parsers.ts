/**
 * Parsers for notes coming from other apps: Markdown (Obsidian, Bear,
 * Notion exports), plain text, and Evernote .enex. Pure, so the messy real
 * world (BOMs, CRLF, odd front matter) is pinned by tests.
 */
import { XMLParser } from 'fast-xml-parser';

export interface ImportedNote {
  title: string;
  body: string;
  tags: string[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

export type ImportKind = 'md' | 'txt' | 'enex' | 'zip';

/**
 * File type from the name, or by sniffing the first bytes when the name has
 * no extension (Android content:// URIs often don't). Null for binary data.
 */
export function detectImportKind(name: string, head: string): ImportKind | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'txt' || ext === 'text') return 'txt';
  if (ext === 'enex') return 'enex';
  if (ext === 'zip') return 'zip';
  if (head.startsWith('PK\u0003\u0004')) return 'zip';
  const start = head.replace(/^\uFEFF/, '').slice(0, 512);
  if (/<en-export[\s>]/.test(start)) return 'enex';
  // Control characters other than whitespace mean binary.
  if (/[\u0000-\u0008\u000E-\u001F]/.test(start)) return null;
  if (/^(---\n|#{1,6}\s)/.test(start.replace(/\r\n?/g, '\n'))) return 'md';
  return 'txt';
}

function normalize(content: string): string {
  return content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** File name → title, dropping folders, extension and Notion's 32-hex page id. */
export function notionTitle(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName;
  return base
    .replace(/\.[^.]+$/, '')
    .replace(/\s+[0-9a-f]{32}$/i, '')
    .trim();
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const v = value.trim().replace(/^["']|["']$/g, '');
  // ENEX: 20240105T101500Z
  const enex = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const date = enex ? new Date(Date.UTC(+enex[1], +enex[2] - 1, +enex[3], +enex[4], +enex[5], +enex[6])) : new Date(v);
  return Number.isNaN(date.getTime()) ? null : date;
}

function unquote(v: string): string {
  return v.trim().replace(/^["']|["']$/g, '').trim();
}

/** A small YAML subset: `key: value`, `key: [a, b]`, and `key:` followed by `- item` lines. */
function parseFrontMatter(text: string): { data: Record<string, string | string[]>; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { data: {}, body: text };
  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of match[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].trim();
    if (value === '') {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value.slice(1, -1).split(',').map(unquote).filter(Boolean);
      listKey = null;
    } else {
      data[key] = unquote(value);
      listKey = null;
    }
  }
  return { data, body: text.slice(match[0].length) };
}

function asTags(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.split(',');
  return list.map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
}

function inlineTags(body: string): string[] {
  const withoutCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const tags: string[] = [];
  for (const m of withoutCode.matchAll(/(?:^|\s)#([A-Za-z][\w/-]*)/g)) tags.push(m[1]);
  return tags;
}

const unique = (items: string[]) => [...new Set(items)];

export function parseMarkdown(fileName: string, content: string): ImportedNote {
  const { data, body: rawBody } = parseFrontMatter(normalize(content));
  let body = rawBody.trim();
  let title = typeof data.title === 'string' ? data.title : '';

  if (!title) {
    const heading = body.match(/^#\s+(.+)\n?/);
    if (heading) {
      title = heading[1].trim();
      body = body.slice(heading[0].length).trim();
    }
  }
  if (!title) title = notionTitle(fileName) || 'Imported note';

  const fm = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : undefined);
  return {
    title,
    body,
    tags: unique([...asTags(data.tags), ...inlineTags(body)]),
    createdAt: parseDate(fm('date') ?? fm('created') ?? fm('created_at')),
    updatedAt: parseDate(fm('updated') ?? fm('modified')),
  };
}

export function parseText(fileName: string, content: string): ImportedNote {
  const text = normalize(content).trim();
  const [first, ...rest] = text.split('\n');
  const useFirst = first && first.trim().length > 0 && first.trim().length <= 80 && rest.length > 0;
  return {
    title: useFirst ? first.trim() : notionTitle(fileName) || 'Imported note',
    body: useFirst ? rest.join('\n').trim() : text,
    tags: [],
    createdAt: null,
    updatedAt: null,
  };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Evernote's ENML (XHTML) → plain text with line breaks and list dashes. */
export function enmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\?xml[^>]*\?>/g, '')
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/(div|p|h[1-6]|li|tr|blockquote|pre)>/gi, '\n')
      .replace(/<(div|p|h[1-6]|ul|ol|tr|blockquote|pre)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

export function parseEnex(xml: string): ImportedNote[] {
  const text = normalize(xml);
  // Evernote exports never declare entities; a document that does could
  // expand them exponentially ("billion laughs"), so it's refused outright.
  if (/<!DOCTYPE\s[^>]*\[|<!ENTITY/i.test(text)) {
    throw new Error('This .enex file uses XML features that are not supported');
  }
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: (name) => name === 'note' || name === 'tag',
    // Keep ENML intact; it's converted separately.
    stopNodes: ['*.content'],
    // Standard entities are decoded by hand below; nothing is expanded by the parser.
    processEntities: false,
  });
  const doc = parser.parse(text);
  const notes: unknown[] = doc?.['en-export']?.note ?? [];
  return notes.map((raw) => {
    const n = raw as Record<string, unknown>;
    const content = String(n.content ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, '');
    return {
      title: decodeEntities(String(n.title ?? '')).trim() || 'Imported note',
      body: enmlToText(content),
      tags: Array.isArray(n.tag) ? n.tag.map((t) => decodeEntities(String(t)).trim()).filter(Boolean) : [],
      createdAt: parseDate(n.created as string | undefined),
      updatedAt: parseDate(n.updated as string | undefined),
    };
  });
}

/** Stable FNV-1a hash of normalized title + body, for duplicate detection. */
export function contentHash(title: string, body: string): string {
  const text = `${title.trim()}\n${body.replace(/\s+/g, ' ').trim()}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
