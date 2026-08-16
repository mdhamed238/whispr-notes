const tintColorLight = '#3D63F5';
const tintColorDark = '#6E8CFF';

// Shared dark, floating pill color for the bottom tab bar in both themes
// (mirrors the reference app's dark nav dock regardless of light/dark mode).
const navBackground = '#14162B';

export default {
  light: {
    text: '#161923',
    textMuted: '#7A7F93',
    background: '#F5F7FC',
    surface: '#EEF1F9',
    card: '#FFFFFF',
    border: '#E6E9F3',
    tint: tintColorLight,
    tabIconDefault: '#9aa0a6',
    tabIconSelected: tintColorLight,
    danger: '#E5484D',
    success: '#1FA971',
    // Text/icon color to place on top of a solid success/danger/tint
    // background.
    onAccent: '#ffffff',
    navBackground,
  },
  dark: {
    text: '#F3F4FA',
    textMuted: '#8B8FA6',
    background: '#0A0B12',
    surface: '#151726',
    card: '#1B1E2E',
    border: '#262A3D',
    tint: tintColorDark,
    tabIconDefault: '#6b7280',
    tabIconSelected: tintColorDark,
    danger: '#FF6B6F',
    success: '#3DDC97',
    // The dark theme's success/danger are light, saturated colors — white
    // text on top of them is nearly illegible, so use a near-black instead
    // (matching this theme's own `background`).
    onAccent: '#0A0B12',
    navBackground,
  },
};
