#!/usr/bin/env node
/**
 * Offline parser inspector - no Telegram token needed.
 *
 *   node src/cli.js tests/fixtures/makdash-meat-tzom-gedalia.txt
 *   cat message.txt | node src/cli.js
 *
 * Prints what the parser understood, what it filed as a note, and what it could
 * not place. Use it to tune synagogues/registry.json and src/dictionary.js
 * against a message that came out wrong.
 */
import { readFileSync } from 'node:fs';
import { parseMessage } from './parser.js';
import { validate } from './validator.js';
import { loadRegistry } from './synagogues.js';
import { DAY_TYPE_LABELS, NUSACH_LABELS } from './dictionary.js';

function readInput() {
  const file = process.argv[2];
  if (file) return readFileSync(file, 'utf8');
  return readFileSync(0, 'utf8');
}

const text = readInput();
if (!text.trim()) {
  console.error('nothing to parse - pass a file path or pipe text on stdin');
  process.exit(1);
}

const registry = loadRegistry();
const parsed = parseMessage(text, registry);
const validation = validate(parsed);

const day =
  parsed.dayType === 'holiday' && parsed.holiday
    ? `${parsed.holiday.label}${parsed.holiday.date ? ` (${parsed.holiday.date})` : ' (no date)'}`
    : DAY_TYPE_LABELS[parsed.dayType];

console.log(`synagogue : ${parsed.synagogueName ?? '-- not recognised --'} [${parsed.synagogueId ?? '-'}]`);
console.log(`day       : ${day}${parsed.dayTypeInferred ? ' (inferred)' : ''}`);
console.log(`confidence: ${parsed.confidence}`);
console.log('');

console.log(`prayers (${parsed.prayers.length}):`);
for (const p of parsed.prayers) {
  const bits = [];
  if (p.minyan) bits.push(`minyan ${p.minyan}`);
  if (p.nusach) bits.push(NUSACH_LABELS[p.nusach]);
  if (p.note) bits.push(p.note);
  console.log(
    `  ${String(p.order).padStart(2)}. ${(p.time ?? '  --  ').padEnd(6)} ${p.type.padEnd(18)} ${p.name}` +
      (bits.length ? `   {${bits.join(' | ')}}` : ''),
  );
}

if (parsed.notes.length) {
  console.log(`\nnotes (${parsed.notes.length}):`);
  for (const n of parsed.notes) console.log(`  • ${n}`);
}

if (parsed.unparsed.length) {
  console.log(`\nUNPARSED (${parsed.unparsed.length}):`);
  for (const u of parsed.unparsed) console.log(`  ! ${u.line}   [${u.reason}]`);
}

if (validation.errors.length) {
  console.log(`\nerrors:`);
  for (const e of validation.errors) console.log(`  ⛔ ${e}`);
}
if (validation.warnings.length) {
  console.log(`\nwarnings:`);
  for (const w of validation.warnings) console.log(`  ⚠️  ${w}`);
}

