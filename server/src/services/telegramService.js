/**
 * telegramService.js — the ONLY place that talks to Telegram.
 *
 * Architecture (the browser never touches Telegram):
 *
 *     React  →  Express backend  →  PostgreSQL (source of truth)
 *                                        ↓
 *                                   Alert service
 *                                        ↓
 *                                  Telegram Bot API
 *                                        ↓
 *                                     Telegram
 *
 * Security rules enforced here:
 *   - the bot token comes ONLY from the backend environment (server/.env);
 *   - it is never returned by an API, never logged and never bundled for React;
 *   - it is normalized (quotes / spaces pasted into .env removed) exactly like
 *     the Gemini key;
 *   - a Telegram failure can NEVER break an inventory operation: every helper
 *     resolves with { ok: false } instead of throwing.
 *
 * Required environment (server/.env):
 *   TELEGRAM_BOT_TOKEN=123456:AA...     (from @BotFather — ROTATE if leaked)
 *   TELEGRAM_CHAT_ID=123456789          (the DESTINATION chat, not the bot id)
 */

const { readEnv, readRaw, secretFingerprint } = require('../config/env');

const BOT_TOKEN = readEnv('TELEGRAM_BOT_TOKEN', 'TELEGRAM_TOKEN', 'TELEGRAM_API_TOKEN');
const CHAT_ID = readEnv('TELEGRAM_CHAT_ID', 'TELEGRAM_GROUP_ID');
const API_BASE = readRaw('TELEGRAM_API_BASE') || 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = Number(readRaw('TELEGRAM_TIMEOUT_MS')) || 10000;
const DOCUMENT_TIMEOUT_MS = Number(readRaw('TELEGRAM_DOCUMENT_TIMEOUT_MS')) || 45000;
// Telegram's bot upload limit for documents is 50 MB; stay comfortably below it.
const DOCUMENT_MAX_BYTES = Number(readRaw('TELEGRAM_DOCUMENT_MAX_BYTES')) || 45 * 1024 * 1024;

/** Is a token present AND shaped like a real bot token ("<digits>:<secret>")? */
function hasToken() {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(BOT_TOKEN);
}

function isConfigured() {
  return hasToken() && Boolean(CHAT_ID);
}

/** Escape pharmacy data before embedding it in an HTML-formatted message. */
function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** One Bot API call with a hard timeout. Never throws. */
async function callTelegram(method, payload = null, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  if (!hasToken()) {
    return { ok: false, skipped: true, error: 'Telegram bot token is not configured.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || !body.ok) {
      // Telegram's own error text is safe — it never contains the token.
      return { ok: false, error: (body && body.description) || `Telegram HTTP ${response.status}` };
    }
    return { ok: true, result: body.result };
  } catch (err) {
    const reason = err && err.name === 'AbortError'
      ? 'Telegram request timed out.'
      : 'Telegram is unreachable (network error).';
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one message to the configured chat.
 * Returns { ok, skipped?, error?, message_id? } — it NEVER throws, because a
 * notification failure must never roll back an inventory change.
 */
async function sendTelegramMessage(message, { chatId = CHAT_ID, parseMode = 'HTML' } = {}) {
  if (!message) return { ok: false, skipped: true, error: 'Empty message.' };
  if (!isConfigured()) {
    return {
      ok: false,
      skipped: true,
      error: !hasToken()
        ? 'Telegram bot token is not configured (set TELEGRAM_BOT_TOKEN).'
        : 'Telegram chat id is not configured (set TELEGRAM_CHAT_ID).',
    };
  }

  const result = await callTelegram('sendMessage', {
    chat_id: chatId,
    text: String(message).slice(0, 4000),
    parse_mode: parseMode,
    disable_web_page_preview: true,
  });

  return result.ok
    ? { ok: true, message_id: result.result && result.result.message_id }
    : { ok: false, error: result.error };
}

/**
 * Upload a document (Excel/PDF report) to the configured chat as an attachment.
 *
 * Uses multipart/form-data (Telegram's sendDocument endpoint). Returns
 * { ok, message_id? } or { ok:false, skipped?, error? } — it NEVER throws, so a
 * failed report delivery can be recorded and retried instead of breaking an
 * inventory operation.
 */
async function sendTelegramDocument(buffer, filename, { chatId = CHAT_ID, caption = '' } = {}) {
  if (!hasToken()) {
    return { ok: false, skipped: true, error: 'Telegram bot token is not configured.' };
  }
  if (!chatId) {
    return { ok: false, skipped: true, error: 'Telegram chat id is not configured (set TELEGRAM_CHAT_ID).' };
  }

  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (!bytes.length) return { ok: false, error: 'Empty document.' };
  if (bytes.length > DOCUMENT_MAX_BYTES) {
    return { ok: false, error: `Document is too large for Telegram (${bytes.length} bytes > ${DOCUMENT_MAX_BYTES}).` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOCUMENT_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', String(caption).slice(0, 1000));
    // `filename` must be a safe, shell-free name; callers control it.
    form.append('document', new Blob([new Uint8Array(bytes)]), filename || 'report.xlsx');

    const response = await fetch(`${API_BASE}/bot${BOT_TOKEN}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || !body.ok) {
      return { ok: false, error: (body && body.description) || `Telegram HTTP ${response.status}` };
    }
    return { ok: true, message_id: body.result && body.result.message_id };
  } catch (err) {
    const reason = err && err.name === 'AbortError'
      ? 'Telegram document upload timed out.'
      : 'Telegram is unreachable (network error).';
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discover destination chat ids.
 *
 * A bot can only message a chat AFTER that chat has messaged the bot, and the
 * numeric bot id (for example 8720078982) is NOT the chat id. Send "/start" to
 * the bot in Telegram, then call this to read the real chat id from getUpdates.
 */
async function discoverChats() {
  const updates = await callTelegram('getUpdates', { limit: 50, allowed_updates: ['message'] });
  if (!updates.ok) return { ok: false, error: updates.error, chats: [] };

  const chats = new Map();
  for (const update of updates.result || []) {
    const chat = (update && update.message && update.message.chat)
      || (update && update.channel_post && update.channel_post.chat);
    if (!chat) continue;
    const stamp = update.message && update.message.date;
    chats.set(String(chat.id), {
      chat_id: String(chat.id),
      type: chat.type,
      title: chat.title || null,
      username: chat.username || null,
      name: [chat.first_name, chat.last_name].filter(Boolean).join(' ') || null,
      last_message_at: stamp ? new Date(stamp * 1000).toISOString() : null,
    });
  }
  return { ok: true, chats: [...chats.values()] };
}

/** Secret-free configuration summary for the API and the startup log. */
function describeTelegramStatus() {
  return {
    configured: isConfigured(),
    token_present: hasToken(),
    token_fingerprint: BOT_TOKEN ? secretFingerprint(BOT_TOKEN) : 'missing',
    chat_id_configured: Boolean(CHAT_ID),
    hint: isConfigured()
      ? 'Telegram notifications are configured correctly.'
      : !hasToken()
        ? 'Set TELEGRAM_BOT_TOKEN in server/.env (regenerate it in @BotFather if it was ever shared publicly).'
        : 'Send "/start" to the bot in Telegram, then read the chat id from GET /api/notifications/telegram/chats and set TELEGRAM_CHAT_ID.',
  };
}

/* One safe startup line — never prints the token. */
if (isConfigured()) {
  console.log(`[TELEGRAM] Configuration: available (token "${secretFingerprint(BOT_TOKEN)}", chat id set).`);
} else {
  console.warn(`[TELEGRAM] Configuration: missing — ${describeTelegramStatus().hint}`);
}

module.exports = {
  isConfigured,
  hasToken,
  escapeHtml,
  sendTelegramMessage,
  sendTelegramDocument,
  discoverChats,
  describeTelegramStatus,
  callTelegram,
};
