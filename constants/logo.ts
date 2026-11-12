/**
 * WhisprNotes logo (Direction B, "Folded Note") as SVG source, shared by the
 * PDF template, the icon generator and the website. 100-unit box.
 */
export const LOGO_MARK_PATHS = `
  <path d="M35 20 H59 L73 34 V73 a7 7 0 0 1 -7 7 H35 a7 7 0 0 1 -7 -7 V27 a7 7 0 0 1 7 -7 Z" fill="#FFFFFF"/>
  <path d="M59 20 V29 a5 5 0 0 0 5 5 H73 Z" fill="#FFC9BB"/>
  <rect x="36" y="40" width="18" height="4.5" rx="2.25" fill="#2A1D3A"/>
  <rect x="36" y="56" width="4" height="8" rx="2" fill="#FF6A4D"/>
  <rect x="42" y="51" width="4" height="18" rx="2" fill="#FF6A4D"/>
  <rect x="48" y="54" width="4" height="12" rx="2" fill="#FF6A4D"/>
  <rect x="54" y="49" width="4" height="22" rx="2" fill="#FF6A4D"/>
  <rect x="60" y="55" width="4" height="10" rx="2" fill="#FF6A4D"/>`;

/** Full app icon: coral rounded tile + mark. */
export function logoSvg(size = 100, rounded = true, standalone = true): string {
  // Inline SVG inside HTML doesn't need the namespace; standalone files do.
  const ns = standalone ? ' xmlns="http://www.w3.org/2000/svg"' : '';
  return `<svg${ns} viewBox="0 0 100 100" width="${size}" height="${size}"><rect width="100" height="100" rx="${rounded ? 22 : 0}" fill="#FF6A4D"/>${LOGO_MARK_PATHS}</svg>`;
}
