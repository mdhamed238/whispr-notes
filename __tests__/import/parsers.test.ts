import { contentHash, enmlToText, notionTitle, parseEnex, parseMarkdown, parseText } from '../../services/import/parsers';

describe('parseMarkdown', () => {
  test('reads front matter title, tags and date', () => {
    const n = parseMarkdown('x.md', '---\ntitle: Standup\ntags: [work, team]\ndate: 2025-03-01\n---\nBody text');
    expect(n.title).toBe('Standup');
    expect(n.tags).toEqual(['work', 'team']);
    expect(n.createdAt?.toISOString().slice(0, 10)).toBe('2025-03-01');
    expect(n.body).toBe('Body text');
  });

  test('comma-separated and YAML-list tags both work', () => {
    expect(parseMarkdown('x.md', '---\ntags: a, b\n---\n').tags).toEqual(['a', 'b']);
    expect(parseMarkdown('x.md', '---\ntags:\n  - a\n  - "b c"\n---\n').tags).toEqual(['a', 'b c']);
  });

  test('first heading becomes the title and inline #tags are collected', () => {
    const n = parseMarkdown('x.md', '# Heading\nbody #idea and #idea again\n\n## Sub');
    expect(n.title).toBe('Heading');
    expect(n.body).toBe('body #idea and #idea again\n\n## Sub');
    expect(n.tags).toEqual(['idea']);
  });

  test('ignores #tags inside code', () => {
    expect(parseMarkdown('x.md', 'text `#notatag`\n```\n#nope\n```').tags).toEqual([]);
  });

  test('BOM and CRLF parse the same as clean LF', () => {
    const clean = parseMarkdown('x.md', '---\ntitle: T\n---\nLine one\nLine two');
    const messy = parseMarkdown('x.md', '﻿---\r\ntitle: T\r\n---\r\nLine one\r\nLine two');
    expect(messy).toEqual(clean);
  });

  test('an empty file gets its title from the file name', () => {
    const n = parseMarkdown('Meeting notes.md', '');
    expect(n.title).toBe('Meeting notes');
    expect(n.body).toBe('');
  });

  test('Notion export file names lose their id suffix', () => {
    expect(parseMarkdown('Weekly sync 3f2a9c0b1d2e4f5a6b7c8d9e0f1a2b3c.md', 'x').title).toBe('Weekly sync');
  });
});

describe('parseText', () => {
  test('a short first line is the title', () => {
    expect(parseText('x.txt', 'Groceries\nmilk')).toMatchObject({ title: 'Groceries', body: 'milk' });
  });
  test('a long first line stays in the body', () => {
    const long = 'a'.repeat(120);
    expect(parseText('List.txt', `${long}\nmore`)).toMatchObject({ title: 'List', body: `${long}\nmore` });
  });
});

describe('notionTitle', () => {
  test('strips the 32-hex id and extension', () => {
    expect(notionTitle('Weekly sync 3f2a9c0b1d2e4f5a6b7c8d9e0f1a2b3c.md')).toBe('Weekly sync');
    expect(notionTitle('Plain.md')).toBe('Plain');
    expect(notionTitle('folder/Sub Page.txt')).toBe('Sub Page');
  });
});

describe('ENEX', () => {
  const enex = `<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note><title>First &amp; best</title><content><![CDATA[<?xml version="1.0"?><en-note><div>a</div><div>b &amp; c</div><ul><li>one</li></ul></en-note>]]></content><created>20240105T101500Z</created><tag>work</tag><tag>ideas</tag></note>
  <note><title>Second</title><content><![CDATA[<en-note>Hello<br/>world</en-note>]]></content></note>
</en-export>`;

  test('reads every note with title, tags and date', () => {
    const notes = parseEnex(enex);
    expect(notes).toHaveLength(2);
    expect(notes[0].title).toBe('First & best');
    expect(notes[0].tags).toEqual(['work', 'ideas']);
    expect(notes[0].createdAt?.toISOString()).toBe('2024-01-05T10:15:00.000Z');
    expect(notes[0].body).toBe('a\nb & c\n- one');
    expect(notes[1].body).toBe('Hello\nworld');
  });

  test('enmlToText turns blocks into lines and decodes entities', () => {
    expect(enmlToText('<div>a</div><div>b</div>')).toBe('a\nb');
    expect(enmlToText('<p>x&nbsp;y &lt;z&gt;</p>')).toBe('x y <z>');
  });
});

describe('contentHash', () => {
  test('ignores whitespace differences', () => {
    expect(contentHash('T', 'body text  \n')).toBe(contentHash('T', 'body text'));
  });
  test('differs for different content', () => {
    expect(contentHash('T', 'a')).not.toBe(contentHash('T', 'b'));
  });
});
