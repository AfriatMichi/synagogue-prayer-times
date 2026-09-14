/**
 * Rule-based parser for Hebrew gabbai messages. Deterministic, offline, no AI.
 *
 * The parser never claims to be right - it claims to be *inspectable*. Anything
 * it could not place lands in `unparsed` and is shown in the Telegram preview,
 * so a bad read is visible before it is ever published.
 */
import { normalizeText, matchKey, cleanFragment, wordCount } from './normalize.js';
import {
  PRAYER_PATTERNS,
  NUSACH_PATTERNS,
  DAY_TYPE_PATTERNS,
  HOLIDAY_PATTERNS,
  MINYAN_ORDINALS,
  MINYAN_ORDINAL_RE,
  MINYAN_UNNUMBERED_RE,
  PROSE_STARTERS,
  SECTION_ONLY,
} from './dictionary.js';
import { matchSynagogue } from './synagogues.js';

const TIME_RE = /(?<![\d:.])(\d{1,2})[:.]([0-5]\d)(?![\d:.])/g;
const WORD_CHAR = /[֐-׿a-zA-Z0-9]/;
// Hebrew letters that legally attach as a prefix: ב ה ו כ ל מ ש
const PREFIX_LETTERS = new Set(['ב', 'ה', 'ו', 'כ', 'ל', 'מ', 'ש']);

/**
 * Word-aware indexOf. Hebrew glues prefixes onto words, so up to two prefix
 * letters are tolerated before the match ("המנחה" matches "מנחה"), while the
 * end of the match must land on a real boundary ("חולה" does NOT match "חול").
 * @returns {number} index of the match, or -1
 */
export function indexOfWord(haystack, needle) {
  if (!needle) return -1;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return -1;
    const after = haystack[i + needle.length];
    if (!after || !WORD_CHAR.test(after)) {
      let ok = true;
      let back = i - 1;
      let prefixes = 0;
      while (back >= 0 && WORD_CHAR.test(haystack[back])) {
        if (prefixes >= 2 || !PREFIX_LETTERS.has(haystack[back])) {
          ok = false;
          break;
        }
        prefixes += 1;
        back -= 1;
      }
      if (ok) return i;
    }
    from = i + 1;
  }
}

/**
 * Best keyword hit in a line: smallest index wins, ties broken by longer
 * pattern. That is what makes "מנחה גדולה" beat "מנחה" and what makes
 * "שחרית + התרת נדרים" resolve to shacharit.
 */
export function findBest(patterns, key) {
  let best = null;
  for (const p of patterns) {
    const i = indexOfWord(key, p.pattern);
    if (i < 0) continue;
    if (
      !best ||
      i < best.index ||
      (i === best.index && p.pattern.length > best.pattern.length)
    ) {
      best = { value: p.value, slug: p.slug, label: p.label, pattern: p.pattern, index: i };
    }
  }
  return best;
}

/** @returns {Array<{time: string, index: number, raw: string}>} */
export function extractTimes(line) {
  const out = [];
  TIME_RE.lastIndex = 0;
  let m;
  while ((m = TIME_RE.exec(line)) !== null) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23) continue;
    out.push({
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      index: m.index,
      raw: m[0],
    });
  }
  return out;
}

/** @returns {{ordinal: number|null, unnumbered: boolean}|null} */
export function findMinyan(key) {
  const m = MINYAN_ORDINAL_RE.exec(key);
  if (m) return { ordinal: MINYAN_ORDINALS[m[1]] ?? null, unnumbered: false };
  if (MINYAN_UNNUMBERED_RE.test(key)) return { ordinal: null, unnumbered: true };
  return null;
}

function isProse(key) {
  return PROSE_STARTERS.some((s) => key === s || key.startsWith(`${s} `));
}

function stripTimes(line) {
  TIME_RE.lastIndex = 0;
  return line.replace(TIME_RE, ' ');
}

/** Split a line into the fragments a gabbai separates with dashes/colons. */
function splitSegments(text) {
  return text
    .split(/[-:,|()[\]]/)
    .map((s) => cleanFragment(s))
    .filter((s) => s.length > 0);
}

function isPureNusach(segment) {
  const key = matchKey(segment);
  return NUSACH_PATTERNS.some((p) => p.pattern === key);
}

function isPureMinyan(segment) {
  const key = matchKey(segment);
  if (!findMinyan(key)) return false;
  const rest = key
    .replace(MINYAN_ORDINAL_RE, ' ')
    .replace(MINYAN_UNNUMBERED_RE, ' ')
    .trim();
  return rest.length === 0;
}

/**
 * Pull the display name and the leftover note out of one prayer line.
 * @returns {{name: string|null, note: string|null}}
 */
function extractNameAndNote(line, prayerHit) {
  const segments = splitSegments(stripTimes(line));
  let name = null;
  const noteParts = [];
  for (const seg of segments) {
    const key = matchKey(seg);
    if (!name && prayerHit && indexOfWord(key, prayerHit.pattern) >= 0) {
      name = seg;
      continue;
    }
    if (isPureNusach(seg) || isPureMinyan(seg)) continue;
    if (SECTION_ONLY.includes(key)) continue;
    noteParts.push(seg);
  }
  return {
    name: name ? cleanFragment(name) : null,
    note: noteParts.length ? noteParts.join(', ') : null,
  };
}

/**
 * Assign minyan numbers once the whole message is parsed.
 *
 * Rules, in order:
 *  - a group that already has explicit numbers gets its gaps filled with the
 *    smallest unused numbers, in order of appearance;
 *  - a prayer that occurs once is not a minyan at all -> null;
 *  - a group whose entries all carry distinct wording is already distinguished
 *    by that wording ("סליחות חמישי בלילה" vs "סליחות שישי בבוקר") -> null;
 *  - otherwise number them 1..N in order.
 */
export function assignMinyanim(entries) {
  const groups = new Map();
  for (const e of entries) {
    const k = `${e.type}|${e.nusach ?? ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const group of groups.values()) {
    const hasExplicit = group.some((e) => e.minyan != null);
    if (hasExplicit) {
      const used = new Set(group.filter((e) => e.minyan != null).map((e) => e.minyan));
      let next = 1;
      for (const e of group) {
        if (e.minyan != null) continue;
        while (used.has(next)) next += 1;
        e.minyan = next;
        used.add(next);
      }
    } else if (group.length === 1) {
      group[0].minyan = null;
    } else {
      const wording = new Set(group.map((e) => `${e.name ?? ''}|${e.note ?? ''}`));
      if (wording.size === group.length) {
        for (const e of group) e.minyan = null;
      } else {
        group.forEach((e, i) => {
          e.minyan = i + 1;
        });
      }
    }
  }
  return entries;
}

function scoreConfidence({ synagogue, dayTypeInferred, prayers, unparsed }) {
  let score = 1;
  if (!synagogue) score -= 0.35;
  if (dayTypeInferred) score -= 0.2;
  if (prayers.length === 0) score -= 0.5;
  else if (prayers.length < 2) score -= 0.15;
  score -= Math.min(0.3, unparsed.length * 0.07);
  return Math.max(0, Math.round(score * 100) / 100);
}

/**
 * Parse one gabbai message.
 * @param {string} rawText
 * @param {Array<object>} registry synagogue registry
 * @returns {object} ParsedUpdate
 */
export function parseMessage(rawText, registry = []) {
  const text = normalizeText(rawText);
  const lines = text.split('\n');

  let synagogue = null;
  let dayType = null;
  let dayTypeInferred = false;
  let holiday = null;

  const prayers = [];
  const notes = [];
  const unparsed = [];
  const headers = [];

  // Rolling context, cleared by every blank line.
  let nusach = null;
  let prayerContext = null; // {type, name} from an explicit "סליחות:" header
  let minyanContext = null; // {ordinal, seenTypes} from a standalone "מניין שני:"
  let lastEntry = null;
  const seenTypes = new Set();

  lines.forEach((rawLine, lineNo) => {
    const line = rawLine.trim();
    if (!line) {
      nusach = null;
      prayerContext = null;
      minyanContext = null;
      return;
    }

    const key = matchKey(line);
    const times = extractTimes(line);
    const prayerHit = findBest(PRAYER_PATTERNS, key);
    const minyanHit = findMinyan(key);
    const nusachHit = findBest(NUSACH_PATTERNS, key);

    let contributedMeta = false;

    if (!synagogue) {
      const hit = matchSynagogue(line, registry);
      if (hit) {
        synagogue = hit;
        contributedMeta = true;
      }
    }

    // Day type and holiday come from header lines only. A prayer line such as
    // "מנחה ערב שבת - 13:30" must not flip a weekday message to shabbat.
    if (!dayType && (times.length === 0 || lineNo === 0)) {
      const holidayHit = findBest(HOLIDAY_PATTERNS, key);
      if (holidayHit) {
        dayType = 'holiday';
        holiday = { slug: holidayHit.slug, label: holidayHit.label, date: null };
        contributedMeta = true;
      } else {
        const dayHit = findBest(DAY_TYPE_PATTERNS, key);
        if (dayHit) {
          dayType = dayHit.value;
          contributedMeta = true;
        }
      }
    }

    if (nusachHit) nusach = nusachHit.value;

    if (SECTION_ONLY.includes(key)) {
      headers.push(line);
      return;
    }

    // ---------- lines without a time ----------
    if (times.length === 0) {
      const isHeader = /[:：]\s*$/.test(line);

      if (prayerHit && isHeader) {
        const { name } = extractNameAndNote(line, prayerHit);
        prayerContext = { type: prayerHit.value, name: name || line.replace(/[:：]\s*$/, '') };
        minyanContext = null;
        headers.push(line);
        return;
      }
      if (minyanHit && !prayerHit) {
        // Standalone "מניין שני:" - applies only to prayers already listed above.
        minyanContext = { ordinal: minyanHit.ordinal, seenTypes: new Set(seenTypes) };
        headers.push(line);
        return;
      }
      if (prayerHit && prayerHit.index <= 2 && wordCount(key) <= 8 && !isProse(key)) {
        // Shiurim and drashot regularly have no time at all.
        const { name, note } = extractNameAndNote(line, prayerHit);
        const entry = {
          type: prayerHit.value,
          name: name || line,
          time: null,
          minyan: minyanHit?.ordinal ?? null,
          nusach,
          note,
          line,
        };
        prayers.push(entry);
        seenTypes.add(entry.type);
        lastEntry = entry;
        return;
      }
      if (contributedMeta || isPureNusach(line)) {
        headers.push(line);
        return;
      }
      notes.push(line);
      return;
    }

    // ---------- lines with at least one time ----------
    let type = null;
    let baseName = null;

    if (prayerHit) {
      type = prayerHit.value;
    } else if (prayerContext) {
      type = prayerContext.type;
      baseName = prayerContext.name;
    } else if (minyanHit && lastEntry) {
      // "מניין שני- 06:00" continues the prayer named on the line above.
      type = lastEntry.type;
      baseName = lastEntry.name;
    }

    if (!type) {
      unparsed.push({ line, reason: 'time-without-prayer' });
      return;
    }

    const { name, note } = extractNameAndNote(line, prayerHit);
    const displayName = name || baseName || line;

    let explicitMinyan = null;
    if (minyanHit && minyanHit.ordinal != null) {
      explicitMinyan = minyanHit.ordinal;
    } else if (minyanContext) {
      if (minyanContext.seenTypes.has(type)) {
        explicitMinyan = minyanContext.ordinal;
      } else {
        minyanContext = null; // the context has run past its section
      }
    }

    times.forEach((t, i) => {
      const entry = {
        type,
        name: displayName,
        time: t.time,
        minyan: i === 0 ? explicitMinyan : null,
        nusach,
        note,
        line,
      };
      prayers.push(entry);
      seenTypes.add(type);
      lastEntry = entry;
    });
  });

  assignMinyanim(prayers);
  prayers.forEach((p, i) => {
    p.order = i;
  });

  if (!dayType) {
    dayType = 'weekday';
    dayTypeInferred = true;
  }

  return {
    synagogueId: synagogue?.id ?? null,
    synagogueName: synagogue?.name ?? null,
    matchedAlias: synagogue?.alias ?? null,
    dayType,
    dayTypeInferred,
    holiday,
    prayers,
    notes,
    unparsed,
    headers,
    title: lines[0] ?? '',
    confidence: scoreConfidence({ synagogue, dayTypeInferred, prayers, unparsed }),
  };
}
