import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractTimes, findMinyan, indexOfWord, parseMessage } from '../src/parser.js';
import { loadRegistry } from '../src/synagogues.js';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const registry = loadRegistry();

/** All prayers of one type (and nusach), in message order. */
const of = (parsed, type, nusach = null) =>
  parsed.prayers.filter((p) => p.type === type && p.nusach === nusach);

const times = (list) => list.map((p) => p.time);
const minyanim = (list) => list.map((p) => p.minyan);

// ---------------------------------------------------------------- primitives

test('extractTimes normalizes and rejects impossible hours', () => {
  assert.deepEqual(times(extractTimes('סליחות- 5:20')), ['05:20']);
  assert.deepEqual(times(extractTimes('00:30 ואחר כך 22:30')), ['00:30', '22:30']);
  assert.deepEqual(extractTimes('ערבית 19.05').map((t) => t.time), ['19:05']);
  assert.deepEqual(extractTimes('25:00'), []);
  assert.deepEqual(extractTimes('בתאריך 12.09.2026'), [], 'a full date is not a time');
});

test('indexOfWord tolerates Hebrew prefixes but not suffixes', () => {
  assert.ok(indexOfWord('המנחה גדולה', 'מנחה') >= 0, 'ה prefix still matches');
  assert.ok(indexOfWord('בחול המועד', 'חול') >= 0, 'ב prefix still matches');
  assert.equal(indexOfWord('חולה', 'חול'), -1, 'חולה must not match חול');
  assert.equal(indexOfWord('חולים', 'חול'), -1);
});

test('findMinyan reads Hebrew ordinals', () => {
  assert.deepEqual(findMinyan('מניין שני'), { ordinal: 2, unnumbered: false });
  assert.deepEqual(findMinyan('מנין ראשון'), { ordinal: 1, unnumbered: false });
  assert.equal(findMinyan('מנין ג').ordinal, 3);
  assert.equal(findMinyan('מניין מוקדם').unnumbered, true);
  assert.equal(findMinyan('שחרית'), null);
});

// -------------------------------------------------- fixture 1: כלל ישראל

test('klal yisrael / erev rosh hashana', () => {
  const parsed = parseMessage(fixture('klal-yisrael-erev-rosh-hashana.txt'), registry);

  assert.equal(parsed.synagogueId, 'klal-yisrael');
  assert.equal(parsed.dayType, 'holiday');
  assert.equal(parsed.holiday.slug, 'erev-rosh-hashana');
  assert.equal(parsed.holiday.date, null, 'no Hebrew calendar - the date stays unset');

  const shacharit = of(parsed, 'shacharit');
  assert.deepEqual(times(shacharit), ['06:15', '08:00', '09:00']);
  assert.deepEqual(minyanim(shacharit), [1, 2, 3], 'explicit מנין ראשון/שני/שלישי');
  assert.match(shacharit[2].note, /בימ/, 'the parenthetical becomes a note');
  assert.equal(shacharit[0].name, 'שחרית + התרת נדרים', 'name comes from the section header');

  const sepharadi = of(parsed, 'selichot', 'sepharadi');
  assert.deepEqual(times(sepharadi), ['00:30', '05:20']);
  assert.deepEqual(minyanim(sepharadi), [null, null], 'distinct wording, not two minyanim');
  assert.equal(sepharadi[0].note, 'בבית הכנסת');

  const ashkenazi = of(parsed, 'selichot', 'ashkenazi');
  assert.deepEqual(times(ashkenazi), ['22:30']);
  assert.equal(ashkenazi[0].type, 'selichot', 'type inherited from the סליחות: header');

  const minchaGedola = of(parsed, 'mincha_gedola');
  assert.deepEqual(times(minchaGedola), ['13:15']);
  assert.equal(minchaGedola[0].minyan, null);

  assert.ok(
    parsed.notes.some((n) => n.startsWith('לאחר מנחה גדולה')),
    'the prose sentence is a note',
  );
  assert.ok(
    !parsed.prayers.some((p) => p.line.startsWith('לאחר')),
    'the prose sentence must not become a prayer',
  );
});

// ------------------------------------------------- fixture 2: מקדש מעט

test('makdash meat / tzom gedalia - minyan context must not leak', () => {
  const parsed = parseMessage(fixture('makdash-meat-tzom-gedalia.txt'), registry);

  assert.equal(parsed.synagogueId, 'makdash-meat');
  assert.equal(parsed.dayType, 'holiday');
  assert.equal(parsed.holiday.slug, 'tzom-gedalia');

  const selichot = of(parsed, 'selichot');
  assert.deepEqual(times(selichot), ['05:00', '06:00']);
  assert.deepEqual(minyanim(selichot), [1, 2]);

  const shacharit = of(parsed, 'shacharit');
  assert.deepEqual(times(shacharit), ['06:00', '07:00']);
  assert.deepEqual(minyanim(shacharit), [1, 2]);

  // The whole point: "מניין שני:" sits above מנחה and ערבית in the message, but
  // they are not a second minyan - they are simply the rest of the day.
  const mincha = of(parsed, 'mincha');
  assert.deepEqual(times(mincha), ['18:15']);
  assert.deepEqual(minyanim(mincha), [null]);

  const arvit = of(parsed, 'arvit');
  assert.deepEqual(times(arvit), ['19:05']);
  assert.deepEqual(minyanim(arvit), [null]);

  assert.ok(parsed.notes.includes('בברכה ועד בית הכנסת.'));
  assert.deepEqual(parsed.unparsed, []);
});

// -------------------------------------------- fixture 3: זכור לאברהם

test('zechor leavraham / weekday - bare minyan lines inherit the prayer above', () => {
  const parsed = parseMessage(fixture('zechor-leavraham-weekday.txt'), registry);

  // "זכור לאברהם" is a second name for מקדש מעט, not a second synagogue.
  assert.equal(parsed.synagogueId, 'makdash-meat');
  assert.equal(parsed.dayType, 'weekday');
  assert.equal(parsed.dayTypeInferred, false, 'the message says יום חול explicitly');

  const selichot = of(parsed, 'selichot');
  assert.deepEqual(times(selichot), ['05:00', '06:00']);
  assert.deepEqual(minyanim(selichot), [1, 2], '"מניין שני- 06:00" continues סליחות');

  const shacharit = of(parsed, 'shacharit');
  assert.deepEqual(times(shacharit), ['06:00', '07:00']);
  assert.deepEqual(minyanim(shacharit), [1, 2]);
  assert.deepEqual(
    shacharit.map((p) => p.note),
    ['הודו', 'הודו'],
  );

  assert.deepEqual(times(of(parsed, 'mincha')), ['18:30']);
  assert.deepEqual(times(of(parsed, 'arvit')), ['19:15']);

  // Shiurim and drashot with no time at all are real rows, not notes.
  const drasha = of(parsed, 'drasha');
  assert.equal(drasha.length, 1);
  assert.equal(drasha[0].time, null);

  const shiur = of(parsed, 'shiur');
  assert.equal(shiur.length, 1);
  assert.equal(shiur[0].time, null);

  assert.ok(parsed.notes.includes('שבוע טוב!'));
  assert.deepEqual(parsed.unparsed, []);
});

// ------------------------------------------------------------------ edges

test('an unknown synagogue leaves synagogueId null instead of guessing', () => {
  const parsed = parseMessage('זמני תפילות יום חול\nשחרית- 06:00', registry);
  assert.equal(parsed.synagogueId, null);
  assert.ok(parsed.confidence < 1);
});

test('a time with no prayer context is reported, never silently dropped', () => {
  const parsed = parseMessage('מקדש מעט\n\n07:45 בערך', registry);
  assert.equal(parsed.prayers.length, 0);
  assert.equal(parsed.unparsed.length, 1);
  assert.equal(parsed.unparsed[0].reason, 'time-without-prayer');
});

test('a prayer line with two times becomes two entries', () => {
  const parsed = parseMessage('מקדש מעט\nשחרית 06:15 07:30', registry);
  const shacharit = of(parsed, 'shacharit');
  assert.deepEqual(times(shacharit), ['06:15', '07:30']);
  assert.deepEqual(minyanim(shacharit), [1, 2]);
});

test('a shabbat message is filed as shabbat', () => {
  const parsed = parseMessage('מקדש מעט\nזמני תפילות שבת\nשחרית- 08:30\nמנחה- 18:00', registry);
  assert.equal(parsed.dayType, 'shabbat');
  assert.equal(parsed.holiday, null);
});

test('"מנחה ערב שבת" inside a weekday list does not flip the day type', () => {
  const parsed = parseMessage('מקדש מעט\nזמני תפילות יום חול\nמנחה ערב שבת - 13:30', registry);
  assert.equal(parsed.dayType, 'weekday');
});
