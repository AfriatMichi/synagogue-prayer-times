/**
 * Writes the published JSON the website reads over GitHub Raw.
 *
 * A gabbai message is always a *complete* list for one day type, so publishing
 * replaces that bucket wholesale rather than merging line by line. The other
 * buckets of the same synagogue are untouched.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from './config.js';
import { readJson, writeJson } from './pending.js';
import { loadRegistry } from './synagogues.js';

/** Shape of a synagogue file before anything has been published for it. */
export function emptyDocument(shul) {
  return {
    id: shul.id,
    name: shul.name,
    icon: shul.icon ?? '🏠',
    weekday: { prayers: [], notes: [], updatedAt: null },
    shabbat: { prayers: [], notes: [], updatedAt: null },
    holidays: [],
    updatedAt: null,
    source: null,
  };
}

/** Strip the parser's internal bookkeeping before the value is published. */
function toPublicPrayer(p, index) {
  return {
    type: p.type,
    name: p.name,
    time: p.time ?? null,
    minyan: p.minyan ?? null,
    nusach: p.nusach ?? null,
    note: p.note ?? null,
    order: index,
  };
}

/**
 * Pure merge: returns a new document with one bucket replaced. Exported on its
 * own so the publishing rules can be tested without touching the filesystem.
 *
 * @param {object} doc existing synagogue document
 * @param {object} parsed parser output
 * @param {{updateId?: number, messageId?: number, receivedAt?: string, now?: string}} meta
 * @returns {object} new document
 */
export function applyUpdate(doc, parsed, meta = {}) {
  const now = meta.now ?? new Date().toISOString();
  const bucket = {
    prayers: parsed.prayers.map(toPublicPrayer),
    notes: [...parsed.notes],
    updatedAt: now,
  };
  const next = {
    ...doc,
    weekday: { ...doc.weekday },
    shabbat: { ...doc.shabbat },
    holidays: doc.holidays.map((h) => ({ ...h })),
  };

  if (parsed.dayType === 'holiday' && parsed.holiday) {
    const { slug, label } = parsed.holiday;
    const existing = next.holidays.find((h) => h.slug === slug);
    // A date typed in by the owner survives a re-publish that has none.
    const date = parsed.holiday.date ?? existing?.date ?? null;
    const entry = { slug, label, date, ...bucket };
    if (existing) {
      next.holidays = next.holidays.map((h) => (h.slug === slug ? entry : h));
    } else {
      next.holidays = [...next.holidays, entry];
    }
  } else if (parsed.dayType === 'shabbat') {
    next.shabbat = bucket;
  } else {
    next.weekday = bucket;
  }

  next.updatedAt = now;
  next.source = {
    channel: 'telegram',
    updateId: meta.updateId ?? null,
    messageId: meta.messageId ?? null,
    receivedAt: meta.receivedAt ?? now,
  };
  return next;
}

export function documentFile(id, dir = PATHS.dataSynagogues) {
  return join(dir, `${id}.json`);
}

export function loadDocument(id, registry = loadRegistry(), dir = PATHS.dataSynagogues) {
  const file = documentFile(id, dir);
  if (existsSync(file)) {
    const doc = readJson(file);
    if (doc) return doc;
  }
  const shul = registry.find((s) => s.id === id);
  if (!shul) throw new Error(`unknown synagogue id: ${id}`);
  return emptyDocument(shul);
}

/** How many prayers the currently published bucket holds - used for a warning. */
export function currentPrayerCount(id, parsed, registry = loadRegistry()) {
  try {
    const doc = loadDocument(id, registry);
    if (parsed.dayType === 'holiday' && parsed.holiday) {
      return doc.holidays.find((h) => h.slug === parsed.holiday.slug)?.prayers.length ?? 0;
    }
    if (parsed.dayType === 'shabbat') return doc.shabbat.prayers.length;
    return doc.weekday.prayers.length;
  } catch {
    return 0;
  }
}

/**
 * Rebuild the two aggregate files. `all.json` lets the site fetch everything in
 * a single request; `index.json` is the cheap listing.
 */
export function rebuildAggregates({
  registry = loadRegistry(),
  dir = PATHS.dataSynagogues,
  allFile = PATHS.dataAll,
  indexFile = PATHS.dataIndex,
} = {}) {
  const onDisk = existsSync(dir)
    ? new Set(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)))
    : new Set();

  // Registry order is the display order; anything on disk but de-registered is
  // appended rather than silently dropped.
  const ids = [...registry.map((s) => s.id).filter((id) => onDisk.has(id))];
  for (const id of onDisk) if (!ids.includes(id)) ids.push(id);

  const synagogues = ids.map((id) => readJson(documentFile(id, dir))).filter(Boolean);
  const updatedAt = new Date().toISOString();

  writeJson(allFile, { updatedAt, synagogues });
  writeJson(
    indexFile,
    {
      updatedAt,
      synagogues: synagogues.map((s) => ({
        id: s.id,
        name: s.name,
        icon: s.icon,
        updatedAt: s.updatedAt,
      })),
    },
  );
  return synagogues.length;
}

/**
 * Publish one approved pending record.
 * @returns {{file: string, id: string}}
 */
export function publish(record, registry = loadRegistry()) {
  const parsed = record.parsed;
  if (!parsed?.synagogueId) throw new Error('cannot publish without a synagogue id');

  const doc = loadDocument(parsed.synagogueId, registry);
  const next = applyUpdate(doc, parsed, {
    updateId: record.updateId,
    messageId: record.messageId,
    receivedAt: record.createdAt,
  });

  const file = documentFile(parsed.synagogueId);
  writeJson(file, next);
  rebuildAggregates({ registry });
  return { file, id: parsed.synagogueId };
}
