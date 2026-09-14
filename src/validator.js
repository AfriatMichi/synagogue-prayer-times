/**
 * Sanity checks on a parsed message.
 *
 * Errors block approval; warnings are shown in the preview and approved anyway.
 * The split matters: a gabbai is allowed to schedule mincha at an odd hour, but
 * a message with no synagogue must never be published to a guessed file.
 */
import { PRAYER_LABELS } from './dictionary.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Plausible windows per prayer, in minutes from midnight. Outside -> warning. */
const WINDOWS = {
  shacharit: [4 * 60, 11 * 60],
  musaf: [7 * 60, 13 * 60],
  mincha: [11 * 60 + 30, 20 * 60],
  mincha_gedola: [11 * 60 + 30, 16 * 60],
  mincha_ketana: [14 * 60, 20 * 60],
  arvit: [17 * 60, 23 * 60 + 59],
  kabbalat_shabbat: [15 * 60, 22 * 60],
  candle_lighting: [14 * 60, 21 * 60],
};

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function describe(prayer) {
  const label = PRAYER_LABELS[prayer.type] ?? prayer.type;
  const minyan = prayer.minyan ? ` (מניין ${prayer.minyan})` : '';
  return `${label}${minyan} ${prayer.time ?? '--:--'}`;
}

/**
 * @param {object} parsed output of parseMessage
 * @param {object} [context] optional { currentPrayerCount } from the published file
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validate(parsed, context = {}) {
  const errors = [];
  const warnings = [];

  if (!parsed.synagogueId) {
    errors.push('לא זוהה בית כנסת בהודעה. בחר בית כנסת מהכפתורים או שלח /shul <id> <בית-כנסת>.');
  }

  const timed = parsed.prayers.filter((p) => p.time);
  if (parsed.prayers.length === 0) {
    errors.push('לא זוהתה אף תפילה בהודעה.');
  } else if (timed.length === 0) {
    errors.push('אף תפילה לא כוללת שעה.');
  }

  for (const p of parsed.prayers) {
    if (p.time && !TIME_RE.test(p.time)) {
      errors.push(`שעה לא תקינה: "${p.time}" (${PRAYER_LABELS[p.type] ?? p.type})`);
    }
  }

  // The identical prayer listed twice at different times is almost always a
  // parse error rather than a real schedule. `name` is part of the key on
  // purpose: the parser leaves minyan null when two rows are already told apart
  // by their own wording ("סליחות חמישי בלילה" vs "סליחות שישי בבוקר"), and
  // those are two real times, not a contradiction.
  const byKey = new Map();
  for (const p of timed) {
    const k = `${p.type}|${p.minyan ?? ''}|${p.nusach ?? ''}|${p.name ?? ''}`;
    const seen = byKey.get(k);
    if (seen && seen !== p.time) {
      errors.push(`כפילות סותרת: ${PRAYER_LABELS[p.type] ?? p.type} מופיעה גם ב-${seen} וגם ב-${p.time}`);
    }
    byKey.set(k, p.time);
  }

  for (const p of timed) {
    const window = WINDOWS[p.type];
    if (!window) continue;
    const minutes = toMinutes(p.time);
    if (minutes < window[0] || minutes > window[1]) {
      warnings.push(`שעה חריגה: ${describe(p)}`);
    }
  }

  if (parsed.unparsed.length) {
    warnings.push(`${parsed.unparsed.length} שורות עם שעה לא זוהו - בדוק אותן למטה.`);
  }
  if (parsed.dayTypeInferred) {
    warnings.push('סוג היום לא נכתב במפורש בהודעה - הונח "יום חול".');
  }
  if (parsed.holiday && !parsed.holiday.date) {
    warnings.push('לחג לא הוגדר תאריך. אפשר להוסיף עם /date <id> YYYY-MM-DD.');
  }
  if (parsed.confidence < 0.6) {
    warnings.push(`ביטחון נמוך בניתוח (${parsed.confidence}).`);
  }

  const current = context.currentPrayerCount;
  if (typeof current === 'number' && current > 0 && parsed.prayers.length > 0) {
    const ratio = parsed.prayers.length / current;
    if (ratio < 0.5 || ratio > 2) {
      warnings.push(
        `מספר התפילות השתנה משמעותית: ${current} -> ${parsed.prayers.length}. הפרסום מחליף את כל הרשימה.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
