import { I18nManager, type TextStyle } from 'react-native';

/**
 * Style for user content (a transcript, a summary) written in a script whose
 * direction may differ from the interface's: an Arabic note in an English
 * app, or the reverse.
 *
 * React Native treats `left` and `right` as start and end, so the physical
 * side depends on the layout direction: content reading the same way as the
 * layout aligns to `left` (start), content reading the other way to `right`.
 */
export function contentDirection(rtlContent: boolean): TextStyle {
  return {
    writingDirection: rtlContent ? 'rtl' : 'ltr',
    textAlign: rtlContent === I18nManager.isRTL ? 'left' : 'right',
  };
}
