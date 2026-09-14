/**
 * Minimal Telegram Bot API client over the built-in fetch. Long polling only -
 * this project never registers a webhook.
 */
import { BOT_TOKEN, DRY_RUN } from './config.js';

export class TelegramError extends Error {
  constructor(method, code, description, parameters) {
    super(`Telegram ${method} failed (${code}): ${description}`);
    this.name = 'TelegramError';
    this.method = method;
    this.code = code;
    this.description = description;
    this.parameters = parameters ?? {};
  }
}

const API = (method) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call a Bot API method. Retries once on 429 honouring `retry_after`.
 * @param {string} method
 * @param {object} params
 */
export async function call(method, params = {}) {
  if (DRY_RUN && method !== 'getUpdates') {
    console.log(`[dry-run] ${method} ${JSON.stringify(params)}`);
    return { ok: true, result: { message_id: 0 }, dryRun: true };
  }

  // A long poll legitimately blocks for `timeout` seconds; anything beyond that
  // plus a margin is a hung connection, not a slow answer.
  const budget = ((Number(params.timeout) || 0) + 20) * 1000;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(API(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(budget),
    });
    const body = await res.json().catch(() => ({ ok: false, description: 'non-JSON response' }));

    if (body.ok) return body.result;

    if (body.error_code === 429 && attempt === 0) {
      const wait = (body.parameters?.retry_after ?? 3) * 1000;
      console.warn(`rate limited on ${method}, waiting ${wait}ms`);
      await sleep(wait);
      continue;
    }
    throw new TelegramError(method, body.error_code, body.description, body.parameters);
  }
  throw new TelegramError(method, 0, 'exhausted retries');
}

/**
 * Fetch pending updates. Passing `offset` also confirms every update below it,
 * which is why the caller must only advance the stored offset after the new
 * state has been committed.
 */
export function getUpdates(offset, { limit = 100, timeout = 0 } = {}) {
  return call('getUpdates', {
    offset,
    limit,
    timeout,
    allowed_updates: ['message', 'edited_message', 'callback_query'],
  });
}

export function sendMessage(chatId, text, extra = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

export function editMessageText(chatId, messageId, text, extra = {}) {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

export function answerCallbackQuery(id, text = '', showAlert = false) {
  return call('answerCallbackQuery', { callback_query_id: id, text, show_alert: showAlert });
}

export function deleteWebhook() {
  return call('deleteWebhook', { drop_pending_updates: false });
}

export function getMe() {
  return call('getMe');
}

/** Escape text for parse_mode: 'HTML'. */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
