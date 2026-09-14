#!/usr/bin/env node
/**
 * Create a data file for every synagogue in the registry that does not have one
 * yet, then rebuild the aggregates. Safe to re-run: existing files are never
 * touched, so published times survive.
 *
 * Run it after adding a synagogue to synagogues/registry.json:
 *   npm run bootstrap
 */
import { existsSync } from 'node:fs';
import { PATHS } from './config.js';
import { writeJson } from './pending.js';
import { loadRegistry } from './synagogues.js';
import { documentFile, emptyDocument, rebuildAggregates } from './publisher.js';

const registry = loadRegistry();
let created = 0;

for (const shul of registry) {
  const file = documentFile(shul.id);
  if (existsSync(file)) continue;
  writeJson(file, emptyDocument(shul));
  created += 1;
  console.log(`created ${shul.id}.json`);
}

if (!existsSync(PATHS.offset)) {
  writeJson(PATHS.offset, { offset: 0, processedUpdateIds: [], lastRunDate: null });
  console.log('created state/offset.json');
}

const total = rebuildAggregates({ registry });
console.log(`bootstrap done: ${created} new file(s), ${total} synagogue(s) in data/all.json`);
