/**
 * Keyword tables driving the rule-based parser. No AI, no network.
 *
 * Every pattern here is compared against `matchKey(line)` output, so patterns
 * must themselves be written the way matchKey renders them: no quotes, no
 * geresh, single spaces. `buildPatterns` does that normalization for us.
 */
import { matchKey } from './normalize.js';

function buildPatterns(table, valueKey) {
  return table
    .flatMap((row) =>
      row.patterns.map((p) => ({
        value: row[valueKey],
        label: row.label ?? null,
        slug: row.slug ?? null,
        pattern: matchKey(p),
      })),
    )
    .filter((p) => p.pattern.length > 0);
}

/**
 * Canonical prayer types. Order in this array is irrelevant - matching picks
 * the hit with the smallest index in the line, breaking ties by longer pattern,
 * so "מנחה גדולה" always beats "מנחה", and "שחרית + התרת נדרים" resolves to
 * shacharit because shacharit appears first in the line.
 */
const PRAYER_TABLE = [
  { type: 'hatarat_nedarim', patterns: ['התרת נדרים'] },
  { type: 'mincha_gedola', patterns: ['מנחה גדולה'] },
  { type: 'mincha_ketana', patterns: ['מנחה קטנה'] },
  { type: 'kabbalat_shabbat', patterns: ['קבלת שבת'] },
  { type: 'candle_lighting', patterns: ['הדלקת נרות', 'הדלקת נר', 'כניסת שבת', 'כניסת החג'] },
  { type: 'tzet', patterns: ['צאת הכוכבים', 'צאת שבת', 'צאת החג', 'מוצאי שבת', 'מוצש', 'יציאת שבת', 'יציאת החג'] },
  { type: 'shofar', patterns: ['תקיעת שופר', 'תקיעות שופר'] },
  { type: 'tashlich', patterns: ['תשליך'] },
  { type: 'daf_yomi', patterns: ['דף יומי', 'דף היומי'] },
  { type: 'avot_ubanim', patterns: ['אבות וילדים', 'אבות ובנים'] },
  { type: 'children', patterns: ['תפילת ילדים', 'מניין ילדים', 'מנין ילדים', 'שיעור לילדים'] },
  { type: 'selichot', patterns: ['סליחות'] },
  { type: 'shacharit', patterns: ['שחרית', 'ותיקין', 'הנץ החמה', 'נץ החמה'] },
  { type: 'musaf', patterns: ['מוסף'] },
  { type: 'mincha', patterns: ['מנחה'] },
  { type: 'arvit', patterns: ['ערבית', 'מעריב'] },
  { type: 'drasha', patterns: ['דברי תורה', 'דרשה', 'דרשת', 'פיוט'] },
  { type: 'shiur', patterns: ['שיעור', 'שיעורי', 'הלכות', 'לימוד'] },
];

const NUSACH_TABLE = [
  { value: 'sepharadi', patterns: ['ספרדים', 'ספרדי', 'נוסח ספרד', 'עדות המזרח', 'עדות מזרח'] },
  { value: 'ashkenazi', patterns: ['אשכנזים', 'אשכנזי', 'נוסח אשכנז'] },
  { value: 'teimani', patterns: ['תימנים', 'תימני', 'נוסח תימן', 'בלדי', 'שאמי'] },
];

const DAY_TYPE_TABLE = [
  { value: 'shabbat', patterns: ['שבת קודש', 'ערב שבת', 'ליל שבת', 'מוצאי שבת', 'שבת', 'פרשת'] },
  { value: 'weekday', patterns: ['יום חול', 'ימי חול', 'ימות החול', 'חול'] },
];

/**
 * Named holidays. A Gregorian `date` is deliberately NOT resolved here - this
 * project has no Hebrew calendar dependency. The owner sets one with
 * `/date <id> YYYY-MM-DD` before approving, or leaves it null.
 */
const HOLIDAY_TABLE = [
  { slug: 'erev-rosh-hashana', label: 'ערב ראש השנה', patterns: ['ערב ראש השנה', 'ערב ר"ה'] },
  { slug: 'rosh-hashana', label: 'ראש השנה', patterns: ['ראש השנה', 'ר"ה'] },
  { slug: 'tzom-gedalia', label: 'צום גדליה', patterns: ['צום גדליה', 'צום גדליהו'] },
  { slug: 'erev-yom-kippur', label: 'ערב יום כיפור', patterns: ['ערב יום כיפור', 'ערב יוה"כ', 'ערב כיפור'] },
  { slug: 'yom-kippur', label: 'יום כיפור', patterns: ['יום הכיפורים', 'יום כיפור', 'יוה"כ'] },
  { slug: 'erev-sukkot', label: 'ערב סוכות', patterns: ['ערב סוכות'] },
  { slug: 'sukkot', label: 'סוכות', patterns: ['חול המועד סוכות', 'סוכות'] },
  { slug: 'hoshana-raba', label: 'הושענא רבה', patterns: ['הושענא רבה', 'הושענה רבה'] },
  { slug: 'shmini-atzeret', label: 'שמיני עצרת', patterns: ['שמיני עצרת'] },
  { slug: 'simchat-torah', label: 'שמחת תורה', patterns: ['שמחת תורה'] },
  { slug: 'chanuka', label: 'חנוכה', patterns: ['חנוכה'] },
  { slug: 'taanit-esther', label: 'תענית אסתר', patterns: ['תענית אסתר'] },
  { slug: 'purim', label: 'פורים', patterns: ['שושן פורים', 'פורים'] },
  { slug: 'erev-pesach', label: 'ערב פסח', patterns: ['ערב פסח'] },
  { slug: 'pesach', label: 'פסח', patterns: ['חול המועד פסח', 'פסח'] },
  { slug: 'yom-hashoa', label: 'יום השואה', patterns: ['יום השואה'] },
  { slug: 'yom-hazikaron', label: 'יום הזיכרון', patterns: ['יום הזיכרון', 'יום הזכרון'] },
  { slug: 'yom-haatzmaut', label: 'יום העצמאות', patterns: ['יום העצמאות'] },
  { slug: 'lag-baomer', label: 'ל"ג בעומר', patterns: ['ל"ג בעומר', 'לג בעומר'] },
  { slug: 'yom-yerushalayim', label: 'יום ירושלים', patterns: ['יום ירושלים'] },
  { slug: 'erev-shavuot', label: 'ערב שבועות', patterns: ['ערב שבועות'] },
  { slug: 'shavuot', label: 'שבועות', patterns: ['שבועות'] },
  { slug: 'tzom-tamuz', label: 'צום י"ז בתמוז', patterns: ['י"ז בתמוז', 'יז בתמוז', 'צום תמוז'] },
  { slug: 'erev-tisha-bav', label: 'ערב תשעה באב', patterns: ['ערב תשעה באב'] },
  { slug: 'tisha-bav', label: 'תשעה באב', patterns: ['תשעה באב'] },
  { slug: 'rosh-chodesh', label: 'ראש חודש', patterns: ['ראש חודש', 'ר"ח'] },
];

export const PRAYER_PATTERNS = buildPatterns(PRAYER_TABLE, 'type');
export const NUSACH_PATTERNS = buildPatterns(NUSACH_TABLE, 'value');
export const DAY_TYPE_PATTERNS = buildPatterns(DAY_TYPE_TABLE, 'value');
export const HOLIDAY_PATTERNS = buildPatterns(HOLIDAY_TABLE, 'slug');

/** Display labels for canonical prayer types, used by the Telegram preview. */
export const PRAYER_LABELS = {
  selichot: 'סליחות',
  shacharit: 'שחרית',
  hatarat_nedarim: 'התרת נדרים',
  musaf: 'מוסף',
  mincha: 'מנחה',
  mincha_gedola: 'מנחה גדולה',
  mincha_ketana: 'מנחה קטנה',
  kabbalat_shabbat: 'קבלת שבת',
  arvit: 'ערבית',
  candle_lighting: 'הדלקת נרות',
  tzet: 'צאת הכוכבים',
  shofar: 'תקיעת שופר',
  tashlich: 'תשליך',
  daf_yomi: 'דף יומי',
  drasha: 'דרשה',
  shiur: 'שיעור',
  avot_ubanim: 'אבות וילדים',
  children: 'תפילת ילדים',
  other: 'אחר',
};

export const NUSACH_LABELS = {
  sepharadi: 'ספרדים',
  ashkenazi: 'אשכנזים',
  teimani: 'תימנים',
};

export const DAY_TYPE_LABELS = {
  weekday: 'יום חול',
  shabbat: 'שבת',
  holiday: 'חג / מועד',
};

/** Hebrew ordinals used in minyan markers. */
export const MINYAN_ORDINALS = {
  'ראשון': 1,
  'שני': 2,
  'שלישי': 3,
  'רביעי': 4,
  'חמישי': 5,
  'שישי': 6,
  'א': 1,
  'ב': 2,
  'ג': 3,
  'ד': 4,
  'ה': 5,
  'ו': 6,
};

/** "מניין שני", "מנין ב", "מניין שני:" - matched against matchKey'd text. */
export const MINYAN_ORDINAL_RE =
  /(?:^|[^֐-׿])(?:מניין|מנין|מנייני|מניני)\s*(ראשון|שני|שלישי|רביעי|חמישי|שישי|א|ב|ג|ד|ה|ו)(?![֐-׿])/;

/** Minyan markers with no number - a new minyan whose index is inferred later. */
export const MINYAN_UNNUMBERED_RE =
  /(?:^|[^֐-׿])(?:מניין|מנין)\s*(?:מוקדם|נוסף|אחרון|מאוחר|האחרון|הנוסף)(?![֐-׿])/;

/**
 * Openers that mark a line as prose even when it contains a prayer keyword.
 * Without this, "לאחר מנחה גדולה נסדר בעה את בית הכנסת..." becomes a prayer.
 */
export const PROSE_STARTERS = [
  'לאחר', 'אחרי', 'לפני', 'הציבור', 'בברכה', 'בבקשה', 'נא', 'אנא', 'תודה',
  'מתבקש', 'מתבקשים', 'להזכירכם', 'להודיע', 'הודעה', 'בהשתתפות', 'יש',
  'אין', 'כל', 'שימו', 'שבוע טוב', 'שבת שלום', 'חג שמח', 'מזל טוב',
  'גמר חתימה', 'בשורות טובות', 'השנה', 'השבוע', 'החל', 'בעה',
];

/** Standalone lines that only announce a section and carry no prayer data. */
export const SECTION_ONLY = ['זמני תפילות', 'זמני התפילות', 'זמנים', 'הודעות'];
