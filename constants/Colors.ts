/**
 * WhisprNotes color tokens.
 *
 * Brand colors come from the logo (Direction B, "Folded Note"): a coral tile,
 * an ink text line and a peach fold. The interactive tint is a slightly deeper
 * coral than the logo tile so that it keeps ≥3:1 contrast on white for large
 * text and icons; the dark tint is lighter for the same reason on dark grounds.
 */

export const Brand = {
  coral: '#FF6A4D',
  ink: '#2A1D3A',
  peach: '#FFC9BB',
} as const;

const tintColorLight = '#E8553B';
const tintColorDark = '#FF7A5C';

// Shared dark, floating pill color for the bottom tab bar in both themes.
const navBackground = Brand.ink;

const light = {
  text: '#1B1622',
  textMuted: '#7D7586',
  background: '#FAF8F7',
  surface: '#F3EEEC',
  card: '#FFFFFF',
  border: '#ECE5E2',
  tint: tintColorLight,
  tabIconDefault: '#9C94A3',
  tabIconSelected: tintColorLight,
  danger: '#D93B3B',
  success: '#1F9D6B',
  warning: '#C98A0A',
  // Text/icon color to place on top of a solid success/danger/tint
  // background.
  onAccent: '#FFFFFF',
  navBackground,
};

const dark: Record<keyof typeof light, string> = {
  text: '#F5F1F3',
  textMuted: '#9B93A3',
  background: '#0D0B10',
  surface: '#17141C',
  card: '#1E1A24',
  border: '#2A2531',
  tint: tintColorDark,
  tabIconDefault: '#6F6878',
  tabIconSelected: tintColorDark,
  danger: '#FF6B6F',
  success: '#3DDC97',
  warning: '#F5B83D',
  // The dark theme's accents are light, saturated colors — white text on
  // top of them is hard to read, so use a near-black instead.
  onAccent: '#0D0B10',
  navBackground,
};

export type ThemeColors = Record<keyof typeof light, string>;

const Colors: { light: ThemeColors; dark: ThemeColors } = { light, dark };
export default Colors;
