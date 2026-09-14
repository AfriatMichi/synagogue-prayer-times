import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/validator.js';

const base = (over = {}) => ({
  synagogueId: 'makdash-meat',
  synagogueName: 'בית כנסת מקדש מעט',
  dayType: 'weekday',
  dayTypeInferred: false,
  holiday: null,
  prayers: [],
  notes: [],
  unparsed: [],
  confidence: 1,
  ...over,
});

const prayer = (over = {}) => ({
  type: 'shacharit',
  name: 'שחרית',
  time: '06:00',
  minyan: null,
  nusach: null,
  note: null,
  ...over,
});

test('a message with no synagogue cannot be published', () => {
  const result = validate(base({ synagogueId: null, prayers: [prayer()] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('בית כנסת')));
});

test('a message with no prayers cannot be published', () => {
  const result = validate(base());
  assert.equal(result.ok, false);
});

test('a valid weekday message passes with no errors', () => {
  const result = validate(
    base({ prayers: [prayer(), prayer({ type: 'mincha', time: '18:30' })] }),
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('the same prayer at two different times is an error, not a warning', () => {
  const result = validate(
    base({ prayers: [prayer({ time: '06:00' }), prayer({ time: '07:00' })] }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('כפילות')));
});

test('the same prayer at two times under different names is not a conflict', () => {
  // Real case from כלל ישראל: two sepharadi selichot, no minyan numbers, told
  // apart only by their wording.
  const result = validate(
    base({
      prayers: [
        prayer({ type: 'selichot', name: 'סליחות חמישי בלילה', time: '00:30', nusach: 'sepharadi' }),
        prayer({ type: 'selichot', name: 'סליחות שישי בבוקר', time: '05:20', nusach: 'sepharadi' }),
      ],
    }),
  );
  assert.deepEqual(result.errors, []);
});

test('the same prayer at two times in two different minyanim is fine', () => {
  const result = validate(
    base({ prayers: [prayer({ time: '06:00', minyan: 1 }), prayer({ time: '07:00', minyan: 2 })] }),
  );
  assert.equal(result.ok, true);
});

test('an implausible hour warns but still allows publishing', () => {
  const result = validate(base({ prayers: [prayer({ type: 'shacharit', time: '22:00' })] }));
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.includes('שעה חריגה')));
});

test('unparsed lines and inferred day types surface as warnings', () => {
  const result = validate(
    base({
      prayers: [prayer()],
      dayTypeInferred: true,
      unparsed: [{ line: '07:45 בערך', reason: 'time-without-prayer' }],
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.warnings.filter((w) => w.includes('לא זוהו')).length, 1);
  assert.ok(result.warnings.some((w) => w.includes('סוג היום')));
});

test('a holiday without a date warns about /date', () => {
  const result = validate(
    base({
      dayType: 'holiday',
      holiday: { slug: 'tzom-gedalia', label: 'צום גדליה', date: null },
      prayers: [prayer()],
    }),
  );
  assert.ok(result.warnings.some((w) => w.includes('/date')));
});

test('a large change in prayer count warns that publishing replaces the list', () => {
  const result = validate(base({ prayers: [prayer()] }), { currentPrayerCount: 10 });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.includes('מחליף')));
});
