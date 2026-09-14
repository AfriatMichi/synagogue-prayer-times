/**
 * Environment and filesystem layout. Everything else resolves paths from here,
 * so tests can point the same modules at a temp directory.
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const PATHS = {
  root: ROOT,
  registry: join(ROOT, 'synagogues', 'registry.json'),
  data: join(ROOT, 'data'),
  dataSynagogues: join(ROOT, 'data', 'synagogues'),
  dataAll: join(ROOT, 'data', 'all.json'),
  dataIndex: join(ROOT, 'data', 'index.json'),
  state: join(ROOT, 'state'),
  offset: join(ROOT, 'state', 'offset.json'),
  pending: join(ROOT, 'state', 'pending'),
  archive: join(ROOT, 'state', 'archive'),
};

export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
export const OWNER_ID = String(process.env.TELEGRAM_OWNER_ID ?? '').trim();
export const DRY_RUN = process.env.DRY_RUN === '1';

/**
 * Seconds getUpdates may block waiting for a message (Telegram long polling).
 * 0 returns immediately. The workflow sets ~25 so a forwarded message is picked
 * up within seconds instead of waiting for the next cron tick.
 */
export const POLL_TIMEOUT = Math.min(50, Math.max(0, Number(process.env.POLL_TIMEOUT) || 0));

/** How many recently handled update ids to remember, to absorb replays. */
export const PROCESSED_RING = 200;

/** Telegram drops unconfirmed updates after 24h; nothing older is worth a reply. */
export const MAX_UPDATE_AGE_SECONDS = 24 * 60 * 60;

export function assertConfigured() {
  const missing = [];
  if (!BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!OWNER_ID) missing.push('TELEGRAM_OWNER_ID');
  if (missing.length) {
    throw new Error(
      `Missing required secret(s): ${missing.join(', ')}. ` +
        'Set them with: gh secret set <NAME> --repo <owner>/<repo>',
    );
  }
}
