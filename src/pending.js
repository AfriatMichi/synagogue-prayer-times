/**
 * Pending-update store. Plain JSON files committed to the repo - that *is* the
 * database, and it is also the audit trail.
 *
 * A pending record written during run N is what run N+1 reads when the approval
 * callback arrives, so these files must be committed in the same run that sends
 * the preview.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from './config.js';

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function writeJson(file, value) {
  ensureDir(join(file, '..'));
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`corrupt JSON at ${file}: ${err.message}`);
    return fallback;
  }
}

/** Short, typable id - it has to fit in "/approve a3f2c1" and in callback_data. */
export function newPendingId() {
  return randomBytes(3).toString('hex');
}

export function pendingFile(id, dir = PATHS.pending) {
  return join(dir, `${id}.json`);
}

/**
 * @param {{parsed: object, validation: object, update: object, rawText: string}} input
 * @returns {object} the pending record
 */
export function createPending({ parsed, validation, update, rawText }, dir = PATHS.pending) {
  const message = update.message ?? update.edited_message ?? {};
  const record = {
    id: newPendingId(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    updateId: update.update_id ?? null,
    chatId: message.chat?.id ?? null,
    messageId: message.message_id ?? null,
    previewMessageId: null,
    rawText,
    parsed,
    validation,
    publishedAt: null,
    error: null,
  };
  writeJson(pendingFile(record.id, dir), record);
  return record;
}

export function loadPending(id, dir = PATHS.pending) {
  return readJson(pendingFile(id, dir));
}

export function savePending(record, dir = PATHS.pending) {
  writeJson(pendingFile(record.id, dir), record);
  return record;
}

/** All pending records, oldest first. */
export function listPending(dir = PATHS.pending) {
  ensureDir(dir);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(join(dir, f)))
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/**
 * Move a record out of the pending directory. Approved or rejected, it stays in
 * the repo as history.
 */
export function archivePending(record, status, { pending = PATHS.pending, archive = PATHS.archive } = {}) {
  ensureDir(archive);
  record.status = status;
  record.archivedAt = new Date().toISOString();
  const from = pendingFile(record.id, pending);
  const to = join(archive, `${record.createdAt.slice(0, 10)}-${record.id}.json`);
  writeJson(from, record);
  renameSync(from, to);
  return to;
}
