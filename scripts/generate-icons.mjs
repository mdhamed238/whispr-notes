// Renders the WhisprNotes logo (Direction B, "Folded Note") into every icon
// and splash asset the app needs. Source of truth for the shapes:
// constants/logo.ts (kept in sync with the SVGs written here).
// Run: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORAL = '#FF6A4D';
const INK = '#2A1D3A';
const PEACH = '#FFC9BB';

const PAGE = 'M35 20 H59 L73 34 V73 a7 7 0 0 1 -7 7 H35 a7 7 0 0 1 -7 -7 V27 a7 7 0 0 1 7 -7 Z';
const FOLD = 'M59 20 V29 a5 5 0 0 0 5 5 H73 Z';
const BARS = [
  [36, 56, 8],
  [42, 51, 18],
  [48, 54, 12],
  [54, 49, 22],
  [60, 55, 10],
];
const bars = (fill) => BARS.map(([x, y, h]) => `<rect x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${fill}"/>`).join('');
const mark = `<path d="${PAGE}" fill="#FFFFFF"/><path d="${FOLD}" fill="${PEACH}"/><rect x="36" y="40" width="18" height="4.5" rx="2.25" fill="${INK}"/>${bars(CORAL)}`;
// Centre the mark (it spans x 28..73, y 20..80) and optionally scale it.
const centred = (inner, scale = 1) => `<g transform="translate(50 50) scale(${scale}) translate(-50.5 -50)">${inner}</g>`;
const svg = (body, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024">${bg ? `<rect width="100" height="100" fill="${bg}"/>` : ''}${body}</svg>`;

const sources = {
  // App Store / iOS icon: full-bleed square, the OS applies the corner mask.
  icon: svg(centred(mark, 1.08), CORAL),
  // Android adaptive foreground: transparent, mark inside the 66dp safe circle.
  adaptive: svg(centred(mark, 0.78)),
  // Android 13 themed icon: single-colour silhouette, details cut out.
  monochrome: svg(
    `<defs><mask id="m"><rect width="100" height="100" fill="#fff"/><rect x="36" y="40" width="18" height="4.5" rx="2.25" fill="#000"/>${bars('#000')}<path d="${FOLD}" fill="#000"/></mask></defs>` +
      centred(`<path d="${PAGE}" fill="#FFFFFF" mask="url(#m)"/>`, 0.78)
  ),
  // Splash: the mark on the coral splash background.
  splash: svg(centred(mark, 1)),
  // Rounded tile for docs, website and stores' marketing.
  logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024"><rect width="100" height="100" rx="22" fill="${CORAL}"/>${mark}</svg>`,
};

mkdirSync(join(root, 'assets/brand'), { recursive: true });
writeFileSync(join(root, 'assets/brand/logo.svg'), sources.logo);
writeFileSync(join(root, 'assets/brand/mark.svg'), svg(centred(mark, 1)));

const out = [
  ['icon', 'assets/images/icon.png', 1024],
  ['adaptive', 'assets/images/adaptive-icon.png', 1024],
  ['monochrome', 'assets/images/adaptive-icon-monochrome.png', 1024],
  ['splash', 'assets/images/splash-icon.png', 512],
  ['logo', 'assets/images/favicon.png', 48],
  ['logo', 'assets/brand/logo-1024.png', 1024],
];
for (const [key, file, size] of out) {
  await sharp(Buffer.from(sources[key])).resize(size, size).png().toFile(join(root, file));
  console.log(`${file} ${size}x${size}`);
}
