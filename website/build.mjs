// Builds the WhisprNotes website into website/dist.
// Legal pages come from content/legal/*.md, the same source the app embeds.
// Run: node website/build.mjs
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(here, 'src');
const dist = join(here, 'dist');
const EMAIL = 'mdhamed.off@gmail.com';
const YEAR = new Date().getFullYear();

const md = (name) => readFileSync(join(root, 'content/legal', `${name}.md`), 'utf8');
// Wrap tables so they scroll on narrow screens instead of widening the page.
const html = (markdown) =>
  marked.parse(markdown, { async: false }).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');

const layout = ({ title, description, body, path }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#FF6A4D">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="/og.png">
<meta property="og:type" content="website">
<link rel="icon" href="/favicon.png">
<link rel="apple-touch-icon" href="/og.png">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="wrap">
  <header class="nav">
    <a class="brand" href="/"><img src="/logo.svg" alt="" width="34" height="34">WhisprNotes</a>
    <nav class="nav-links" aria-label="Main">
      ${path === '/' ? '<a href="#privacy">How privacy works</a><a href="#pricing">Pricing</a>' : '<a href="/">Home</a>'}
      <a href="/support">Support</a>
    </nav>
  </header>
  <main>${body}</main>
  <footer>
    <div>© ${YEAR} Mohamed Hamed. WhisprNotes is made by an independent developer.</div>
    <nav aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a></nav>
  </footer>
</div>
</body>
</html>
`;

const appleIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM13.9 4.9c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.5-.7.8-1.3 2-1.1 3.1 1.1.1 2.3-.6 3-1.4z"/></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2.8v18.4c0 .7.8 1.1 1.4.8l16-9.2c.6-.4.6-1.2 0-1.6l-16-9.2C4.8 1.7 4 2.1 4 2.8z"/></svg>';

const bars = [8, 14, 22, 12, 26, 18, 30, 16, 24, 10, 20, 28, 14, 22, 9, 18, 12, 6]
  .map((h, i) => `<i class="${i < 7 ? 'on' : ''}" style="height:${h}px"></i>`)
  .join('');

const dataTable = html(md('data').split('## No account')[0].replace(/^# .*\n+/, '').replace(/^Everything.*\n+/m, ''));

const home = `
<section class="hero">
  <div>
    <span class="eyebrow">On-device AI · No cloud</span>
    <h1>Your meetings, transcribed and summarized. <em>On your phone.</em></h1>
    <p class="lede">Studio-grade Whisper Large-v3 transcripts and AI summaries that never leave your device. No account, no uploads, no tracking.</p>
    <div class="cta-row">
      <span class="store">${appleIcon}<span><small>Coming soon on the</small>App Store</span></span>
      <span class="store">${playIcon}<span><small>Coming soon on</small>Google Play</span></span>
    </div>
    <div class="trust"><span>Works in airplane mode</span><span>99 languages</span><span>No account</span></div>
  </div>
  <div class="phone" role="img" aria-label="WhisprNotes showing a meeting note with a summary and action items">
    <div class="screen">
      <span class="chip">Summary ready</span>
      <h3>Q3 roadmap review</h3>
      <div class="meta">Nov 12 · 23:41 · #product</div>
      <div class="player"><span class="play"></span><span class="bars">${bars}</span></div>
      <div class="sum"><b>Summary</b>The team froze beta scope and agreed to ship on Friday after fixing the login crash.</div>
      <div class="sum"><b>Action items</b><ul><li>Ana: release notes</li><li>Sam: fix login crash</li></ul></div>
      <div class="sum"><b>Decisions</b><ul><li>Ship the beta on Friday</li></ul></div>
    </div>
  </div>
</section>

<section>
  <div class="section-head">
    <h2>Pro-grade notes without giving up your privacy.</h2>
    <p>Everything that usually happens on someone else's server happens on your phone instead.</p>
  </div>
  <div class="pillars">
    <article class="pillar"><div class="ico" aria-hidden="true">🎙️</div><h3>Large-v3 accuracy</h3><p>OpenAI's Whisper Large-v3 Turbo runs on capable phones for near-human transcripts in 99 languages, with a live preview while you speak.</p></article>
    <article class="pillar"><div class="ico" aria-hidden="true">✨</div><h3>Meeting summaries</h3><p>Key points, action items with owners, and decisions, written by an on-device AI the moment your recording ends. Titles too.</p></article>
    <article class="pillar"><div class="ico" aria-hidden="true">🔒</div><h3>Private by design</h3><p>Your voice and notes stay on your phone. No account, no analytics, no ads. Nothing to leak, nothing to sell.</p></article>
  </div>
</section>

<section>
  <div class="grid">
    <div><h4>Tap any word to replay it</h4><p>Every word is linked to the audio. Jump straight to the moment that matters.</p></div>
    <div><h4>Share it your way</h4><p>Branded PDF, Markdown, text, subtitles or the original audio.</p></div>
    <div><h4>Bring your notes</h4><p>Import from Notion, Obsidian, Bear, Evernote, Markdown and text files.</p></div>
    <div><h4>Search everything</h4><p>Full-text search across transcripts, summaries and tags.</p></div>
    <div><h4>Insights</h4><p>Streaks, speaking pace and the hours of typing you've saved.</p></div>
    <div><h4>Works offline</h4><p>After a one-time model download, no connection needed. Ever.</p></div>
  </div>
</section>

<section id="privacy">
  <div class="band">
    <div class="section-head">
      <h2>How privacy works</h2>
      <p>Exactly what WhisprNotes keeps, and what, if anything, leaves your phone.</p>
    </div>
    ${dataTable}
  </div>
</section>

<section id="pricing">
  <div class="section-head">
    <h2>Simple pricing</h2>
    <p>Free to start. Upgrade when it becomes part of your workday.</p>
  </div>
  <div class="plans">
    <div class="plan">
      <h3>Free</h3>
      <div class="price">$0</div>
      <ul>
        <li>Unlimited recording with live transcription</li>
        <li>AI titles for every note</li>
        <li>3 AI summaries a week</li>
        <li>Search, tags and text export</li>
      </ul>
    </div>
    <div class="plan pro">
      <h3>Pro</h3>
      <div class="price">$4.99 <small>once</small></div>
      <div style="color:var(--muted);font-size:15px">Lifetime Pro · No subscription · USD base price; local store prices vary</div>
      <ul>
        <li>Whisper Large-v3 accuracy, 99 languages</li>
        <li>Unlimited AI summaries</li>
        <li>PDF, Markdown, subtitles and audio export</li>
        <li>Import from other apps and full backup</li>
        <li>Insights</li>
      </ul>
    </div>
  </div>
</section>

<section>
  <div class="section-head"><h2>Questions</h2></div>
  <details><summary>Is my audio ever uploaded?</summary><p>No. Recording, transcription and summaries all run on your phone. The app only goes online to download its AI models once and to process purchases.</p></details>
  <details><summary>Which phones does it run on?</summary><p>iPhone with iOS 17 or later, and 64-bit Android phones. Phones with 8 GB of memory or more (like a Galaxy S23 Ultra) run Whisper Large-v3; others use a smaller model automatically.</p></details>
  <details><summary>Does it work without internet?</summary><p>Yes. After the first model download, everything works in airplane mode.</p></details>
  <details><summary>Is Pro a subscription?</summary><p>No. Pro is a one-time lifetime purchase with a $4.99 USD base price. Your local store price is shown before you buy. Restore your purchase with the same App Store or Google Play account.</p></details>
  <details><summary>Do I need to tell people I'm recording?</summary><p>Yes. Recording laws differ by country and often require everyone's consent. Always ask first.</p></details>
</section>
`;

const support = `
<article class="doc">
  <h1>Support</h1>
  <p>Questions, bug reports or feature ideas? Email me and I'll reply as soon as I can, usually within two working days.</p>
  <div class="contact"><code>${EMAIL}</code><span style="color:var(--muted);font-size:14px">Copy the address into your mail app</span></div>
  <h2>Common questions</h2>
  <p><strong>Restore a purchase:</strong> Settings → Upgrade to Pro → Restore purchase, signed in to the same App Store or Google Play account you bought with.</p>
  <p><strong>Free up space:</strong> Settings → AI models → Remove, or delete old recordings.</p>
  <p><strong>Delete everything:</strong> Settings → Delete all data. Because your notes never leave your phone, I can't recover them for you, so back them up first (Settings → Back up all notes).</p>
  <p>Please don't email recordings or private notes; describe the problem instead.</p>
</article>`;

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const f of ['styles.css', 'logo.svg', 'favicon.png', 'og.png']) copyFileSync(join(src, f), join(dist, f));

const pages = [
  ['index.html', { path: '/', title: 'WhisprNotes: private, on-device meeting notes', description: 'Whisper Large-v3 transcripts and AI meeting summaries that run entirely on your phone. No account, no cloud, no tracking.', body: home }],
  ['privacy.html', { path: '/privacy', title: 'Privacy Policy · WhisprNotes', description: 'How WhisprNotes handles your data: it stays on your phone.', body: `<article class="doc">${html(md('privacy'))}</article>` }],
  ['terms.html', { path: '/terms', title: 'Terms of Use · WhisprNotes', description: 'The terms for using WhisprNotes and WhisprNotes Pro.', body: `<article class="doc">${html(md('terms'))}</article>` }],
  ['support.html', { path: '/support', title: 'Support · WhisprNotes', description: 'Get help with WhisprNotes.', body: support }],
];
for (const [file, page] of pages) writeFileSync(join(dist, file), layout(page));
console.log(`Built ${pages.length} pages into website/dist`);
