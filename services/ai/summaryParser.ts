/**
 * Parses the summarizer's Markdown into a NoteSummary. Small on-device
 * models drift from the format, so this is forgiving: thinking blocks are
 * stripped, headings are matched loosely, bullets may be -, * or numbered,
 * and prose with no headings becomes the overview.
 *
 * The prompt asks for English headings, but a model writing in another
 * language often translates them anyway, so headings and "None" placeholders
 * are recognized in every interface language.
 */
import type { NoteSummary } from '../../types';

type Section = 'title' | 'summary' | 'keyPoints' | 'actionItems' | 'decisions';

const HEADINGS: [RegExp, Section][] = [
  [/^title$/, 'title'],
  [/^(summary|overview)$/, 'summary'],
  [/^key\s*points?$/, 'keyPoints'],
  [/^(action\s*items?|next\s*steps?|to-?dos?)$/, 'actionItems'],
  [/^decisions?(\s*made)?$/, 'decisions'],
];

/** Section headings as the model may translate them. */
const TRANSLATED_HEADINGS: Record<Section, string[]> = {
  title: [
    'titre', 'título', 'titel', 'titolo', 'başlık', 'заголовок', 'название', 'назва', 'tytuł', 'název', 'titulek',
    'rubrik', 'tiêu đề', 'judul', 'शीर्षक', 'العنوان', 'عنوان', 'タイトル', '題名', '제목', '标题', '標題',
  ],
  summary: [
    'résumé', 'synthèse', 'aperçu', 'resumen', 'zusammenfassung', 'überblick', 'riepilogo', 'riassunto', 'sommario',
    'sintesi', 'resumo', 'samenvatting', 'overzicht', 'özet', 'резюме', 'краткое содержание', 'сводка', 'обзор',
    'підсумок', 'огляд', 'стислий зміст', 'podsumowanie', 'streszczenie', 'shrnutí', 'souhrn', 'sammanfattning',
    'översikt', 'tóm tắt', 'ringkasan', 'सारांश', 'الملخص', 'ملخص', 'الخلاصة', '要約', '概要', 'まとめ', '요약',
    '摘要', '总结', '總結',
  ],
  keyPoints: [
    'points clés', 'points essentiels', 'points importants', 'points principaux', 'puntos clave',
    'puntos principales', 'kernpunkte', 'wichtige punkte', 'schlüsselpunkte', 'hauptpunkte', 'punti chiave',
    'punti principali', 'pontos chave', 'pontos principais', 'kernpunten', 'belangrijkste punten',
    'önemli noktalar', 'ana noktalar', 'anahtar noktalar', 'ключевые моменты', 'ключевые пункты',
    'основные моменты', 'главное', 'ключові моменти', 'ключові пункти', 'основні моменти', 'kluczowe punkty',
    'najważniejsze punkty', 'klíčové body', 'hlavní body', 'nyckelpunkter', 'viktiga punkter', 'huvudpunkter',
    'điểm chính', 'các điểm chính', 'ý chính', 'poin utama', 'poin penting', 'poin poin penting', 'मुख्य बिंदु',
    'प्रमुख बिंदु', 'النقاط الرئيسية', 'النقاط الأساسية', 'أهم النقاط', '要点', 'キーポイント', '重要なポイント',
    '主なポイント', '핵심 사항', '핵심 포인트', '주요 내용', '요점', '关键点', '關鍵點', '重点', '要點', '重點',
  ],
  actionItems: [
    'actions', 'actions à mener', 'actions à entreprendre', 'points d action', 'tâches', 'prochaines étapes',
    'acciones', 'tareas', 'tareas pendientes', 'próximos pasos', 'elementos de acción', 'puntos de acción',
    'aufgaben', 'maßnahmen', 'aktionspunkte', 'nächste schritte', 'azioni', 'azioni da intraprendere', 'attività',
    'prossimi passi', 'cose da fare', 'ações', 'tarefas', 'itens de ação', 'próximos passos', 'actiepunten',
    'acties', 'taken', 'volgende stappen', 'eylem maddeleri', 'yapılacaklar', 'görevler', 'sonraki adımlar',
    'aksiyon maddeleri', 'задачи', 'действия', 'дальнейшие шаги', 'следующие шаги', 'поручения',
    'пункты действий', 'завдання', 'дії', 'наступні кроки', 'zadania', 'działania', 'do zrobienia',
    'następne kroki', 'úkoly', 'akční body', 'další kroky', 'åtgärder', 'uppgifter', 'nästa steg',
    'åtgärdspunkter', 'việc cần làm', 'hành động', 'các bước tiếp theo', 'mục hành động', 'tindakan', 'tugas',
    'langkah selanjutnya', 'butir tindakan', 'item tindakan', 'कार्य बिंदु', 'कार्य', 'अगले कदम',
    'कार्रवाई आइटम', 'المهام', 'الإجراءات', 'بنود العمل', 'الخطوات التالية', 'عناصر العمل', 'アクションアイテム',
    'タスク', '次のステップ', 'やること', '対応事項', '실행 항목', '할 일', '다음 단계', '액션 아이템', '조치 사항',
    '行动项', '行動項', '待办事项', '待辦事項', '行动事项', '后续步骤', '任务',
  ],
  decisions: [
    'décisions', 'decisiones', 'entscheidungen', 'beschlüsse', 'decisioni', 'decisões', 'beslissingen',
    'besluiten', 'kararlar', 'решения', 'рішення', 'decyzje', 'ustalenia', 'rozhodnutí', 'beslut', 'quyết định',
    'các quyết định', 'keputusan', 'निर्णय', 'फैसले', 'القرارات', 'قرارات', '決定事項', '決定', '결정 사항', '결정',
    '决定', '决策', '決策',
  ],
};

/** "Nothing here" as the model may write it, in any interface language. */
const TRANSLATED_NONE = [
  'aucun', 'aucune', 'rien', 'néant', 'ninguno', 'ninguna', 'nada', 'keine', 'keiner', 'nichts', 'nessuno',
  'nessuna', 'niente', 'nenhum', 'nenhuma', 'geen', 'niets', 'yok', 'hiçbiri', 'нет', 'ничего', 'отсутствуют',
  'немає', 'нічого', 'brak', 'nic', 'žádné', 'žádný', 'žádná', 'inga', 'ingen', 'inget', 'không có', 'không',
  'tidak ada', 'कोई नहीं', 'कुछ नहीं', 'لا يوجد', 'لا توجد', 'لا شيء', 'なし', '無し', '特になし', '없음', '无',
  '無', '没有', '沒有',
];

/**
 * Lowercases and strips Markdown, punctuation and Latin accents so that
 * "**Points clés :**" and "points cles" compare equal.
 */
function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[#*_`:：.,;!?'"“”‘’«»()[\]{}\-–—/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADING_LOOKUP = new Map<string, Section>();
for (const section of Object.keys(TRANSLATED_HEADINGS) as Section[]) {
  for (const heading of TRANSLATED_HEADINGS[section]) HEADING_LOOKUP.set(normalize(heading), section);
}
const NONE_LOOKUP = new Set(TRANSLATED_NONE.map(normalize));

function sectionForHeading(raw: string): Section | null {
  const name = normalize(raw);
  // English first, tolerant of plural and spacing drift.
  const ascii = name.replace(/[^a-z\s-]/g, '').trim();
  const english = HEADINGS.find(([re]) => re.test(ascii) || re.test(ascii.replace(/\s+/g, '-')));
  return english ? english[1] : (HEADING_LOOKUP.get(name) ?? null);
}

const BULLET = /^\s*(?:[-*•·‣–—]|\d+[.)、])\s+/;
// Placeholder bullets only; a real point like "No new hires" must survive.
const NONE = /^(none|n\/a|nothing|no(ne)?\s*(action items?|decisions?|key points?)?)\.?$/i;

function isPlaceholder(item: string): boolean {
  return NONE.test(item) || NONE_LOOKUP.has(normalize(item));
}

export function stripThinking(raw: string): string {
  // Closed blocks first, then an unterminated one (model cut off mid-thought).
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
}

const TITLE_WRAPPERS = '"\'“”‘’«»„‚「」『』《》*_`';
const TITLE_WRAPPER_EDGES = new RegExp(`^[${TITLE_WRAPPERS}\\s]+|[${TITLE_WRAPPERS}\\s]+$`, 'g');

export function cleanTitle(raw: string): string | null {
  const t = raw
    .trim()
    .replace(/^#+\s*/, '')
    .replace(TITLE_WRAPPER_EDGES, '')
    .replace(/[.!?:;,。！？؟،]+$/, '')
    // Again: a quote may have been hiding behind the punctuation ("Title".).
    .replace(TITLE_WRAPPER_EDGES, '')
    .trim();
  if (!t) return null;
  return t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t;
}

export function parseSummaryResponse(
  raw: string,
  model: string,
  now: Date
): { title: string | null; summary: NoteSummary } {
  const text = stripThinking(raw);
  const buckets: Record<Section, string[]> = { title: [], summary: [], keyPoints: [], actionItems: [], decisions: [] };
  let section: Section | null = null;
  let sawHeading = false;

  for (const line of text.split(/\r?\n/)) {
    const heading =
      line.match(/^\s*#{1,6}\s*(.+?)\s*[:：]?\s*$/) ?? line.match(/^\s*\*\*(.+?)[:：]?\*\*\s*[:：]?\s*$/);
    if (heading) {
      const match = sectionForHeading(heading[1]);
      if (match) {
        section = match;
        sawHeading = true;
        continue;
      }
    }
    if (section && line.trim()) buckets[section].push(line);
  }

  const list = (lines: string[]) =>
    lines.map((l) => l.replace(BULLET, '').trim()).filter((l) => l.length > 0 && !isPlaceholder(l));

  if (!sawHeading) {
    return {
      title: null,
      summary: { overview: text.trim(), keyPoints: [], actionItems: [], decisions: [], model, generatedAt: now.toISOString() },
    };
  }

  return {
    title: buckets.title.length > 0 ? cleanTitle(buckets.title[0]) : null,
    summary: {
      overview: buckets.summary.map((l) => l.replace(BULLET, '').trim()).join(' ').trim(),
      keyPoints: list(buckets.keyPoints),
      actionItems: list(buckets.actionItems),
      decisions: list(buckets.decisions),
      model,
      generatedAt: now.toISOString(),
    },
  };
}
