import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry, matchSynagogue } from '../src/synagogues.js';
import { matchKey, normalizeText } from '../src/normalize.js';

const registry = loadRegistry();

test('the shipped registry is well formed', () => {
  assert.ok(registry.length >= 7);
  const ids = registry.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
  for (const shul of registry) {
    assert.match(shul.id, /^[a-z0-9-]+$/, `${shul.id} must be a url-safe slug`);
    assert.ok(shul.aliases.length > 0, `${shul.id} needs at least one alias`);
  }
});

test('aliases match inside a real message line', () => {
  assert.equal(matchSynagogue('מקדש מעט:', registry).id, 'makdash-meat');
  assert.equal(matchSynagogue('*כלל ישראל- ערב ראש השנה*', registry).id, 'klal-yisrael');
  assert.equal(
    matchSynagogue('זמני תפילות יום חול "זכור לאברהם"', registry).id,
    'makdash-meat',
  );
});

test('זכור לאברהם and מקדש מעט are the same synagogue', () => {
  // The gabbai uses both names for one shul; they must land in one data file.
  assert.equal(matchSynagogue('זכור לאברהם', registry).id, 'makdash-meat');
  assert.equal(matchSynagogue('מקדש מעט', registry).id, 'makdash-meat');
  assert.equal(registry.find((s) => s.id === 'zechor-leavraham'), undefined);
});

test('נווה רחמים is deliberately absent', () => {
  // The portal feeds that shul from its own scraper in another repo, so the bot
  // must never recognise it and publish times nothing reads.
  assert.equal(registry.find((s) => s.id === 'neve-rachamim'), undefined);
  assert.equal(matchSynagogue('זמני תפילות נווה רחמים', registry), null);
});

test('the longest alias wins', () => {
  const hit = matchSynagogue('זמני תפילות בית כנסת מרכזי', registry);
  assert.equal(hit.id, 'merkazi');
  assert.equal(hit.alias, 'בית כנסת מרכזי');
});

test('unrelated text matches nothing', () => {
  assert.equal(matchSynagogue('שבת שלום ומבורך', registry), null);
  assert.equal(matchSynagogue('', registry), null);
});

// ------------------------------------------------------------- normalize

test('normalizeText strips bidi marks, markdown and exotic dashes', () => {
  assert.equal(normalizeText('*שחרית*‏ –  6:15'), 'שחרית - 6:15');
  assert.equal(normalizeText('a b'), 'a b');
  assert.equal(normalizeText('שחרית־6:15'), 'שחרית-6:15');
});

test('normalizeText keeps blank lines as section breaks', () => {
  assert.equal(normalizeText('א\n\nב'), 'א\n\nב');
  assert.equal(normalizeText('א\n\n\n\n\nב'), 'א\n\nב');
});

test('matchKey drops geresh and gershayim so abbreviations match', () => {
  assert.equal(matchKey('ר"ה'), 'רה');
  assert.equal(matchKey('בימ״ד'), 'בימד');
  assert.equal(matchKey('מנין א׳'), 'מנין א');
});
