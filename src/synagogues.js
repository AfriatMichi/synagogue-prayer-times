/**
 * Synagogue registry: the list of shuls the bot knows, and the aliases used to
 * recognise them inside a gabbai message.
 *
 * Adding a synagogue is a pure data edit - see synagogues/README.md.
 */
import { readFileSync } from 'node:fs';
import { matchKey } from './normalize.js';
import { PATHS } from './config.js';

let cached = null;

/** @returns {Array<{id: string, name: string, icon: string, aliases: string[]}>} */
export function loadRegistry(file = PATHS.registry) {
  if (cached && file === PATHS.registry) return cached;
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`registry must be an array: ${file}`);
  for (const shul of parsed) {
    if (!shul.id || !shul.name) throw new Error(`registry entry missing id/name: ${JSON.stringify(shul)}`);
    if (!Array.isArray(shul.aliases)) shul.aliases = [];
    shul.icon ??= '🏠';
  }
  if (file === PATHS.registry) cached = parsed;
  return parsed;
}

export function getSynagogue(id, registry = loadRegistry()) {
  return registry.find((s) => s.id === id) ?? null;
}

/**
 * Find the synagogue a piece of text refers to.
 *
 * Longest alias wins, so "בית כנסת מרכזי" is preferred over the bare "מרכזי"
 * when both are present. Matching is substring-based on the normalized key,
 * which is why aliases must stay specific: "נווה שלום", never "שלום".
 *
 * @returns {{id: string, name: string, icon: string, alias: string}|null}
 */
export function matchSynagogue(text, registry = loadRegistry()) {
  const key = matchKey(text);
  if (!key) return null;

  let best = null;
  for (const shul of registry) {
    for (const alias of shul.aliases) {
      const aliasKey = matchKey(alias);
      if (!aliasKey) continue;
      const index = key.indexOf(aliasKey);
      if (index < 0) continue;
      if (!best || aliasKey.length > best.aliasKey.length || (aliasKey.length === best.aliasKey.length && index < best.index)) {
        best = { id: shul.id, name: shul.name, icon: shul.icon, alias, aliasKey, index };
      }
    }
  }
  if (!best) return null;
  return { id: best.id, name: best.name, icon: best.icon, alias: best.alias };
}
