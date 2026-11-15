import { countWords, dominantScript, isRtlText, scriptFor } from '../services/text';

describe('countWords', () => {
  test('spaced scripts count words', () => {
    expect(countWords('  one two\nthree ')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(countWords('مرحبا بكم في الاجتماع')).toBe(4);
  });
  test('CJK counts characters, mixed text counts both', () => {
    expect(countWords('今日は会議')).toBe(5);
    expect(countWords('Q3 路线图 review')).toBe(5);
  });
  test('Thai is estimated from its length', () => {
    expect(countWords('สวัสดีครับวันนี้ประชุม')).toBeGreaterThanOrEqual(4);
  });
});

describe('dominantScript', () => {
  test('recognizes the main writing systems', () => {
    expect(dominantScript('The quarterly review went well.')).toBe('latin');
    expect(dominantScript('Мы обсудили план на квартал.')).toBe('cyrillic');
    expect(dominantScript('ناقشنا خطة الربع القادم.')).toBe('arabic');
    expect(dominantScript('דיברנו על התוכנית')).toBe('hebrew');
    expect(dominantScript('हमने योजना पर चर्चा की।')).toBe('indic');
    expect(dominantScript('我们讨论了路线图。')).toBe('cjk');
    expect(dominantScript('오늘 회의를 했습니다')).toBe('cjk');
    expect(dominantScript('Συζητήσαμε το σχέδιο')).toBe('greek');
  });
  test('a few foreign words do not flip a Latin text', () => {
    expect(dominantScript('We met the Москва team about the launch plan today.')).toBe('latin');
  });
  test('empty or numeric text is Latin', () => {
    expect(dominantScript('')).toBe('latin');
    expect(dominantScript('2026-11-15 12:30')).toBe('latin');
  });
});

describe('scriptFor / isRtlText', () => {
  test('a known language decides, whatever the text looks like', () => {
    expect(scriptFor('OK', 'ja')).toBe('cjk');
    expect(isRtlText('OK', 'ar')).toBe(true);
    expect(isRtlText('مرحبا', 'en')).toBe(false);
  });
  test('without a language the text decides', () => {
    expect(isRtlText('مرحبا بكم')).toBe(true);
    expect(isRtlText('שלום לכולם')).toBe(true);
    expect(isRtlText('Hello everyone')).toBe(false);
  });
});
