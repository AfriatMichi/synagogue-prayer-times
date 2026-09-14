#!/usr/bin/env node
/**
 * Poller entry point. One GitHub Actions run = one pass of this file.
 *
 * Ordering guarantee: Telegram only drops an update once the *next* getUpdates
 * confirms it, and the stored offset only moves forward in a file the workflow
 * commits afterwards. A failed commit therefore replays the same updates rather
 * than losing them; `processedUpdateIds` absorbs the duplicates.
 *
 * Git is intentionally not invoked here - committing and pushing is the
 * workflow's job, so this process stays a pure "read Telegram, write files".
 */
import { appendFileSync } from 'node:fs';
import {
  MAX_UPDATE_AGE_SECONDS,
  OWNER_ID,
  PATHS,
  PROCESSED_RING,
  assertConfigured,
} from './config.js';
import {
  TelegramError,
  answerCallbackQuery,
  deleteWebhook,
  editMessageText,
  escapeHtml,
  getUpdates,
  sendMessage,
} from './telegram.js';
import { loadRegistry } from './synagogues.js';
import { parseMessage } from './parser.js';
import { validate } from './validator.js';
import {
  archivePending,
  createPending,
  listPending,
  loadPending,
  readJson,
  savePending,
  writeJson,
} from './pending.js';
import { currentPrayerCount, publish } from './publisher.js';
import { HELP_TEXT, renderKeyboard, renderPreview } from './preview.js';
import { DAY_TYPE_LABELS } from './dictionary.js';

const log = [];
function note(line) {
  log.push(line);
  console.log(line);
}

function isOwner(from, chat) {
  return String(from?.id) === OWNER_ID || String(chat?.id) === OWNER_ID;
}

function describeDay(parsed) {
  if (parsed.dayType === 'holiday' && parsed.holiday) return parsed.holiday.label;
  return DAY_TYPE_LABELS[parsed.dayType] ?? parsed.dayType;
}

async function safeAnswer(callbackId, text) {
  try {
    await answerCallbackQuery(callbackId, text);
  } catch (err) {
    // Callback queries expire long before our next poll; this is expected.
    console.warn(`answerCallbackQuery ignored: ${err.message}`);
  }
}

async function refreshPreview(record, registry) {
  if (!record.previewMessageId || !record.chatId) return;
  try {
    await editMessageText(record.chatId, record.previewMessageId, renderPreview(record), {
      reply_markup: renderKeyboard(record, registry),
    });
  } catch (err) {
    console.warn(`could not refresh preview ${record.id}: ${err.message}`);
  }
}

async function closePreview(record, banner) {
  if (!record.previewMessageId || !record.chatId) return;
  try {
    await editMessageText(
      record.chatId,
      record.previewMessageId,
      `${renderPreview(record)}\n\n${banner}`,
      { reply_markup: { inline_keyboard: [] } },
    );
  } catch (err) {
    console.warn(`could not close preview ${record.id}: ${err.message}`);
  }
}

async function approve(record, registry, chatId) {
  record.validation = validate(record.parsed, {
    currentPrayerCount: record.parsed.synagogueId
      ? currentPrayerCount(record.parsed.synagogueId, record.parsed, registry)
      : 0,
  });
  if (!record.validation.ok) {
    savePending(record);
    await sendMessage(
      chatId,
      `⛔ לא ניתן לפרסם את <code>${record.id}</code>:\n• ${record.validation.errors
        .map(escapeHtml)
        .join('\n• ')}`,
    );
    return false;
  }

  const { file } = publish(record, registry);
  record.publishedAt = new Date().toISOString();
  archivePending(record, 'published');
  await closePreview(record, '✅ <b>פורסם</b>');
  await sendMessage(
    chatId,
    `✅ פורסם: <b>${escapeHtml(record.parsed.synagogueName)}</b> — ${escapeHtml(
      describeDay(record.parsed),
    )}\n<code>${escapeHtml(file.split(/[\\/]/).slice(-2).join('/'))}</code>`,
  );
  note(`published ${record.id} -> ${record.parsed.synagogueId} (${record.parsed.dayType})`);
  return true;
}

async function reject(record, chatId) {
  archivePending(record, 'rejected');
  await closePreview(record, '❌ <b>בוטל</b>');
  await sendMessage(chatId, `❌ העדכון <code>${record.id}</code> בוטל.`);
  note(`rejected ${record.id}`);
}

async function handleCommand(text, msg, registry) {
  const chatId = msg.chat.id;
  const [rawCmd, ...args] = text.split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();

  switch (cmd) {
    case '/start':
    case '/help':
      await sendMessage(chatId, HELP_TEXT);
      return;

    case '/list': {
      const body = registry
        .map((s) => `${s.icon} <b>${escapeHtml(s.name)}</b> — <code>${s.id}</code>`)
        .join('\n');
      await sendMessage(chatId, `<b>בתי כנסת מוכרים:</b>\n${body}`);
      return;
    }

    case '/pending': {
      const items = listPending();
      if (!items.length) {
        await sendMessage(chatId, 'אין עדכונים ממתינים.');
        return;
      }
      const body = items
        .map(
          (r) =>
            `<code>${r.id}</code> · ${escapeHtml(r.parsed.synagogueName ?? 'לא זוהה')} · ${escapeHtml(
              describeDay(r.parsed),
            )} · ${r.createdAt.slice(0, 16).replace('T', ' ')}`,
        )
        .join('\n');
      await sendMessage(chatId, `<b>ממתינים לאישור:</b>\n${body}`);
      return;
    }

    case '/approve': {
      const record = loadPending(args[0]);
      if (!record) {
        await sendMessage(chatId, `לא נמצא עדכון ממתין בשם <code>${escapeHtml(args[0] ?? '')}</code>.`);
        return;
      }
      await approve(record, registry, chatId);
      return;
    }

    case '/reject': {
      const record = loadPending(args[0]);
      if (!record) {
        await sendMessage(chatId, `לא נמצא עדכון ממתין בשם <code>${escapeHtml(args[0] ?? '')}</code>.`);
        return;
      }
      await reject(record, chatId);
      return;
    }

    case '/date': {
      const record = loadPending(args[0]);
      if (!record) {
        await sendMessage(chatId, 'לא נמצא עדכון ממתין.');
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args[1] ?? '')) {
        await sendMessage(chatId, 'פורמט תאריך: /date &lt;id&gt; YYYY-MM-DD');
        return;
      }
      if (record.parsed.dayType !== 'holiday' || !record.parsed.holiday) {
        await sendMessage(chatId, 'העדכון הזה אינו חג, ואין לו תאריך.');
        return;
      }
      record.parsed.holiday.date = args[1];
      record.validation = validate(record.parsed);
      savePending(record);
      await refreshPreview(record, registry);
      await sendMessage(chatId, `📅 נקבע תאריך ${args[1]} לעדכון <code>${record.id}</code>.`);
      return;
    }

    case '/shul': {
      const record = loadPending(args[0]);
      if (!record) {
        await sendMessage(chatId, 'לא נמצא עדכון ממתין.');
        return;
      }
      const shul = registry.find((s) => s.id === args[1]);
      if (!shul) {
        await sendMessage(chatId, 'מזהה בית כנסת לא מוכר. שלח /list כדי לראות את הרשימה.');
        return;
      }
      record.parsed.synagogueId = shul.id;
      record.parsed.synagogueName = shul.name;
      record.validation = validate(record.parsed, {
        currentPrayerCount: currentPrayerCount(shul.id, record.parsed, registry),
      });
      savePending(record);
      await refreshPreview(record, registry);
      await sendMessage(chatId, `🕍 העדכון <code>${record.id}</code> שויך ל<b>${escapeHtml(shul.name)}</b>.`);
      return;
    }

    case '/raw': {
      const record = loadPending(args[0]);
      if (!record) {
        await sendMessage(chatId, 'לא נמצא עדכון ממתין.');
        return;
      }
      await sendMessage(chatId, `<pre>${escapeHtml(record.rawText)}</pre>`);
      return;
    }

    default:
      await sendMessage(chatId, 'פקודה לא מוכרת. שלח /help.');
  }
}

async function handleMessage(update, msg, registry) {
  const chatId = msg.chat.id;
  const text = (msg.text ?? msg.caption ?? '').trim();

  if (!text) {
    if (msg.photo || msg.document || msg.video || msg.sticker) {
      await sendMessage(
        chatId,
        '🖼 תמונות אינן נתמכות — המערכת עובדת על טקסט בלבד (אין OCR).\nהעתק את הזמנים כטקסט ושלח שוב.',
      );
    }
    return;
  }

  if (text.startsWith('/')) {
    await handleCommand(text, msg, registry);
    return;
  }

  const parsed = parseMessage(text, registry);
  const validation = validate(parsed, {
    currentPrayerCount: parsed.synagogueId
      ? currentPrayerCount(parsed.synagogueId, parsed, registry)
      : 0,
  });
  const record = createPending({ parsed, validation, update, rawText: text });

  const sent = await sendMessage(chatId, renderPreview(record), {
    reply_markup: renderKeyboard(record, registry),
  });
  record.previewMessageId = sent?.message_id ?? null;
  savePending(record);

  if (msg.photo) {
    await sendMessage(chatId, 'ℹ️ ההודעה כללה גם תמונה — רק הטקסט נותח.');
  }
  note(
    `pending ${record.id}: ${parsed.synagogueId ?? 'no-shul'} / ${parsed.dayType} / ` +
      `${parsed.prayers.length} prayers / ${parsed.unparsed.length} unparsed`,
  );
}

async function handleCallback(cb, registry) {
  if (!isOwner(cb.from, cb.message?.chat)) {
    await safeAnswer(cb.id, 'לא מורשה');
    return;
  }
  const [action, id, extra] = String(cb.data ?? '').split(':');
  const chatId = cb.message?.chat?.id ?? cb.from.id;
  const record = loadPending(id);

  if (!record) {
    await safeAnswer(cb.id, 'העדכון כבר טופל');
    return;
  }

  if (action === 'ok') {
    const ok = await approve(record, registry, chatId);
    await safeAnswer(cb.id, ok ? 'פורסם' : 'יש שגיאות');
    return;
  }
  if (action === 'no') {
    await reject(record, chatId);
    await safeAnswer(cb.id, 'בוטל');
    return;
  }
  if (action === 'sh') {
    const shul = registry.find((s) => s.id === extra);
    if (!shul) {
      await safeAnswer(cb.id, 'בית כנסת לא מוכר');
      return;
    }
    record.parsed.synagogueId = shul.id;
    record.parsed.synagogueName = shul.name;
    record.validation = validate(record.parsed, {
      currentPrayerCount: currentPrayerCount(shul.id, record.parsed, registry),
    });
    savePending(record);
    await refreshPreview(record, registry);
    await safeAnswer(cb.id, shul.name);
    return;
  }
  await safeAnswer(cb.id, 'פעולה לא מוכרת');
}

async function handleUpdate(update, registry) {
  if (update.callback_query) {
    await handleCallback(update.callback_query, registry);
    return;
  }
  const msg = update.message ?? update.edited_message;
  if (!msg?.chat) return;

  if (!isOwner(msg.from, msg.chat)) {
    note(`ignored update ${update.update_id} from chat ${msg.chat.id} (not the owner)`);
    return;
  }
  const age = Math.floor(Date.now() / 1000) - (msg.date ?? 0);
  if (age > MAX_UPDATE_AGE_SECONDS) {
    note(`skipped stale update ${update.update_id} (${Math.round(age / 3600)}h old)`);
    return;
  }
  await handleMessage(update, msg, registry);
}

async function fetchUpdates(offset) {
  try {
    return await getUpdates(offset);
  } catch (err) {
    if (err instanceof TelegramError && err.code === 409) {
      // A webhook is registered; this project polls, so drop it and retry once.
      note('409 conflict - deleting webhook and retrying getUpdates');
      await deleteWebhook();
      return getUpdates(offset);
    }
    throw err;
  }
}

async function main() {
  assertConfigured();
  const registry = loadRegistry();
  const state = readJson(PATHS.offset, { offset: 0, processedUpdateIds: [], lastRunDate: null });
  state.processedUpdateIds ??= [];

  const updates = await fetchUpdates(state.offset);
  note(`fetched ${updates.length} update(s) from offset ${state.offset}`);

  let maxUpdateId = state.offset - 1;
  const processed = new Set(state.processedUpdateIds);

  for (const update of updates) {
    maxUpdateId = Math.max(maxUpdateId, update.update_id);
    if (processed.has(update.update_id)) {
      note(`update ${update.update_id} already handled - skipping replay`);
      continue;
    }
    try {
      await handleUpdate(update, registry);
    } catch (err) {
      // One bad message must not strand every later update behind it.
      console.error(`update ${update.update_id} failed:`, err);
      note(`⚠️ update ${update.update_id} failed: ${err.message}`);
    }
    processed.add(update.update_id);
    state.processedUpdateIds.push(update.update_id);
  }

  state.offset = maxUpdateId + 1;
  state.processedUpdateIds = state.processedUpdateIds.slice(-PROCESSED_RING);

  // Daily heartbeat: GitHub disables `schedule:` on a repo that sees no
  // activity for 60 days. A once-a-day change keeps the cron alive without
  // producing a commit on every single run.
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastRunDate !== today) state.lastRunDate = today;

  writeJson(PATHS.offset, state);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Telegram poller\n\n${log.map((l) => `- ${l}`).join('\n')}\n`,
      'utf8',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
