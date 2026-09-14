/**
 * Renders the Telegram approval preview.
 *
 * The preview is the only safety net between a rule-based parse and published
 * data, so it deliberately shows everything: what was understood, what was
 * treated as a free-text note, and what could not be placed at all.
 */
import { escapeHtml } from './telegram.js';
import { DAY_TYPE_LABELS, NUSACH_LABELS, PRAYER_LABELS } from './dictionary.js';

const MAX_LEN = 3800; // Telegram hard-caps a message at 4096 characters.

function dayTitle(parsed) {
  if (parsed.dayType === 'holiday' && parsed.holiday) {
    const date = parsed.holiday.date ? ` (${parsed.holiday.date})` : ' (ללא תאריך)';
    return `${parsed.holiday.label}${date}`;
  }
  return DAY_TYPE_LABELS[parsed.dayType] ?? parsed.dayType;
}

function prayerLine(p, i) {
  const bits = [];
  if (p.minyan) bits.push(`מניין ${p.minyan}`);
  if (p.nusach) bits.push(NUSACH_LABELS[p.nusach] ?? p.nusach);
  if (p.note) bits.push(p.note);
  const suffix = bits.length ? ` <i>(${escapeHtml(bits.join(' · '))})</i>` : '';
  const time = p.time ? `<b>${p.time}</b>` : '<i>ללא שעה</i>';
  const label = PRAYER_LABELS[p.type] ?? p.type;
  const name = p.name && p.name !== label ? `${p.name}` : label;
  return `${i + 1}. ${escapeHtml(name)} — ${time}${suffix}`;
}

/** @returns {string} HTML-formatted preview body */
export function renderPreview(record) {
  const { parsed, validation } = record;
  const lines = [];

  const shul = parsed.synagogueName ?? '❗ בית כנסת לא זוהה';
  lines.push(`🕍 <b>${escapeHtml(shul)}</b>`);
  lines.push(`📅 ${escapeHtml(dayTitle(parsed))}`);
  lines.push(`🆔 <code>${record.id}</code>  ·  ביטחון ${parsed.confidence}`);
  lines.push('');

  if (parsed.prayers.length) {
    lines.push('<b>זמנים שזוהו:</b>');
    parsed.prayers.forEach((p, i) => lines.push(prayerLine(p, i)));
  } else {
    lines.push('<i>לא זוהתה אף תפילה.</i>');
  }

  if (parsed.notes.length) {
    lines.push('');
    lines.push('📝 <b>הערות חופשיות:</b>');
    for (const n of parsed.notes) lines.push(`• ${escapeHtml(n)}`);
  }

  if (parsed.unparsed.length) {
    lines.push('');
    lines.push('❓ <b>שורות עם שעה שלא זוהו:</b>');
    for (const u of parsed.unparsed) lines.push(`• <code>${escapeHtml(u.line)}</code>`);
  }

  if (validation.warnings.length) {
    lines.push('');
    lines.push('⚠️ <b>אזהרות:</b>');
    for (const w of validation.warnings) lines.push(`• ${escapeHtml(w)}`);
  }

  if (validation.errors.length) {
    lines.push('');
    lines.push('⛔ <b>שגיאות (חוסמות פרסום):</b>');
    for (const e of validation.errors) lines.push(`• ${escapeHtml(e)}`);
  }

  lines.push('');
  lines.push(
    validation.ok
      ? 'אשר כדי לפרסם. הפרסום מחליף את כל הרשימה של היום הזה.'
      : 'תקן את השגיאות ושלח שוב, או בטל.',
  );

  const text = lines.join('\n');
  return text.length > MAX_LEN ? `${text.slice(0, MAX_LEN)}\n…(נחתך)` : text;
}

/**
 * Inline keyboard. When the synagogue is unknown the approve button is replaced
 * by a picker, because approving into a guessed file is the one mistake that
 * cannot be spotted after the fact.
 */
export function renderKeyboard(record, registry) {
  const rows = [];

  if (!record.parsed.synagogueId) {
    const buttons = registry.map((s) => ({
      text: s.name,
      callback_data: `sh:${record.id}:${s.id}`,
    }));
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    rows.push([{ text: '❌ בטל', callback_data: `no:${record.id}` }]);
    return { inline_keyboard: rows };
  }

  const first = [];
  if (record.validation.ok) first.push({ text: '✅ אשר ופרסם', callback_data: `ok:${record.id}` });
  first.push({ text: '❌ בטל', callback_data: `no:${record.id}` });
  rows.push(first);
  return { inline_keyboard: rows };
}

export const HELP_TEXT = [
  '<b>בוט זמני תפילות</b>',
  '',
  'העבר אליי הודעת גבאי (טקסט בלבד) ואשלח לך תצוגה מקדימה לאישור.',
  'התמונות אינן נתמכות — אין OCR במערכת.',
  '',
  '<b>פקודות:</b>',
  '/pending — רשימת עדכונים ממתינים',
  '/approve &lt;id&gt; — אשר ופרסם',
  '/reject &lt;id&gt; — בטל עדכון ממתין',
  '/date &lt;id&gt; YYYY-MM-DD — קבע תאריך לחג',
  '/shul &lt;id&gt; &lt;synagogue-id&gt; — שייך לבית כנסת',
  '/raw &lt;id&gt; — הצג את ההודעה המקורית',
  '/list — רשימת בתי הכנסת המוכרים',
  '/help — העזרה הזו',
  '',
  '<i>הבוט מאזין ב-GitHub Actions בהרצות של ~50 דקות, שמופעלות כל שעה. כשהרצה פעילה התגובה מיידית; אחרת יש להמתין לתחילת ההרצה הבאה.</i>',
].join('\n');
