import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUpdate, emptyDocument } from '../src/publisher.js';

const shul = { id: 'makdash-meat', name: 'בית כנסת מקדש מעט', icon: '🕍' };

const parsed = (over = {}) => ({
  synagogueId: shul.id,
  synagogueName: shul.name,
  dayType: 'weekday',
  holiday: null,
  prayers: [
    { type: 'shacharit', name: 'שחרית', time: '06:00', minyan: 1, nusach: null, note: null },
    { type: 'mincha', name: 'מנחה', time: '18:30', minyan: null, nusach: null, note: 'הודו' },
  ],
  notes: ['בברכה ועד בית הכנסת.'],
  unparsed: [],
  ...over,
});

test('a weekday update replaces the weekday bucket only', () => {
  const doc = emptyDocument(shul);
  doc.shabbat = { prayers: [{ type: 'shacharit', name: 'שחרית', time: '08:30' }], notes: [], updatedAt: 'x' };

  const next = applyUpdate(doc, parsed(), { now: '2026-09-14T08:00:00.000Z' });

  assert.equal(next.weekday.prayers.length, 2);
  assert.deepEqual(next.weekday.notes, ['בברכה ועד בית הכנסת.']);
  assert.equal(next.weekday.updatedAt, '2026-09-14T08:00:00.000Z');
  assert.equal(next.shabbat.prayers.length, 1, 'shabbat is untouched');
  assert.equal(doc.weekday.prayers.length, 0, 'the input document is not mutated');
});

test('publishing replaces the list wholesale rather than merging', () => {
  let doc = emptyDocument(shul);
  doc = applyUpdate(doc, parsed(), {});
  doc = applyUpdate(
    doc,
    parsed({ prayers: [{ type: 'arvit', name: 'ערבית', time: '19:15', minyan: null }] }),
    {},
  );
  assert.deepEqual(
    doc.weekday.prayers.map((p) => p.type),
    ['arvit'],
    'the old shacharit/mincha rows are gone, as a full gabbai list implies',
  );
});

test('published prayers carry the structured fields and a fresh order', () => {
  const doc = applyUpdate(emptyDocument(shul), parsed(), {});
  assert.deepEqual(doc.weekday.prayers[1], {
    type: 'mincha',
    name: 'מנחה',
    time: '18:30',
    minyan: null,
    nusach: null,
    note: 'הודו',
    order: 1,
  });
  assert.ok(!('line' in doc.weekday.prayers[0]), 'parser bookkeeping is not published');
});

test('a holiday update is upserted by slug', () => {
  const holiday = { slug: 'tzom-gedalia', label: 'צום גדליה', date: null };
  let doc = applyUpdate(emptyDocument(shul), parsed({ dayType: 'holiday', holiday }), {});
  assert.equal(doc.holidays.length, 1);
  assert.equal(doc.holidays[0].slug, 'tzom-gedalia');
  assert.equal(doc.weekday.prayers.length, 0, 'a holiday must not overwrite the weekday bucket');

  doc = applyUpdate(doc, parsed({ dayType: 'holiday', holiday }), {});
  assert.equal(doc.holidays.length, 1, 'the same holiday is updated, not appended');

  doc = applyUpdate(
    doc,
    parsed({ dayType: 'holiday', holiday: { slug: 'purim', label: 'פורים', date: null } }),
    {},
  );
  assert.deepEqual(doc.holidays.map((h) => h.slug), ['tzom-gedalia', 'purim']);
});

test('a date typed in by the owner survives a re-publish that has none', () => {
  const dated = { slug: 'tzom-gedalia', label: 'צום גדליה', date: '2026-09-15' };
  let doc = applyUpdate(emptyDocument(shul), parsed({ dayType: 'holiday', holiday: dated }), {});
  assert.equal(doc.holidays[0].date, '2026-09-15');

  doc = applyUpdate(
    doc,
    parsed({ dayType: 'holiday', holiday: { slug: 'tzom-gedalia', label: 'צום גדליה', date: null } }),
    {},
  );
  assert.equal(doc.holidays[0].date, '2026-09-15', 'the existing date is kept');
});

test('every update stamps the source and the top-level timestamp', () => {
  const doc = applyUpdate(emptyDocument(shul), parsed(), {
    updateId: 42,
    messageId: 7,
    now: '2026-09-14T08:00:00.000Z',
  });
  assert.equal(doc.updatedAt, '2026-09-14T08:00:00.000Z');
  assert.deepEqual(doc.source, {
    channel: 'telegram',
    updateId: 42,
    messageId: 7,
    receivedAt: '2026-09-14T08:00:00.000Z',
  });
});
