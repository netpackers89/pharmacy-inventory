const telegram = require('../services/telegramService');
const alertService = require('../services/inventoryAlertService');

/*
 * NOTIFICATIONS CONTROLLER
 *
 * Telegram is an outbound notification channel only. These endpoints expose
 * configuration STATUS, a manual test, chat-id discovery, a manual inventory
 * check and the delivery ledger. The bot token itself is never returned,
 * logged or echoed — only a 4-character fingerprint.
 *
 * All routes are administrator-only (see notificationRoutes.js).
 */

/** GET /api/notifications/status */
exports.status = async (req, res) => {
  try {
    const config = telegram.describeTelegramStatus();
    let lastAlert = null;
    if (config.configured) {
      const recent = await alertService.getRecentNotifications(1);
      lastAlert = recent[0] || null;
    }
    res.json({
      telegram: config,
      last_alert: lastAlert,
      schedule: {
        every_minutes: alertService.CONFIG.CHECK_INTERVAL_MINUTES,
        expiry_alert_days: alertService.CONFIG.EXPIRY_BUCKETS,
        critical_stock_threshold: alertService.CONFIG.CRITICAL_STOCK_THRESHOLD,
        max_messages_per_run: alertService.CONFIG.MAX_MESSAGES_PER_RUN,
      },
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[NOTIFICATIONS] status:', err.message);
    res.status(500).json({ error: 'Could not read notification status.', code: 'NOTIFICATION_STATUS_FAILED' });
  }
};

/** POST /api/notifications/telegram/test */
exports.test = async (req, res) => {
  const result = await telegram.sendTelegramMessage(
    '✅ <b>Pharmacy Inventory Telegram Test</b>\n\nTelegram notifications are configured correctly.'
  );

  if (result.ok) {
    return res.json({ success: true, message: 'Test notification delivered.', message_id: result.message_id });
  }
  // Missing configuration is a setup problem, not a server failure.
  return res.status(result.skipped ? 400 : 502).json({
    success: false,
    message: result.error || 'Telegram notification could not be delivered.',
    code: result.skipped ? 'TELEGRAM_NOT_CONFIGURED' : 'TELEGRAM_UNAVAILABLE',
  });
};

/**
 * GET /api/notifications/telegram/chats
 * A bot cannot message a chat it has never heard from, and the numeric bot id
 * is NOT the chat id. Send "/start" to the bot, then read the real chat id here.
 */
exports.chats = async (req, res) => {
  const result = await telegram.discoverChats();
  if (!result.ok) {
    return res.status(502).json({
      success: false,
      message: result.error || 'Could not read Telegram updates.',
      code: 'TELEGRAM_UNAVAILABLE',
    });
  }
  res.json({
    success: true,
    chats: result.chats,
    hint: result.chats.length
      ? 'Copy the chat_id you want alerts in, then set TELEGRAM_CHAT_ID in server/.env and restart the server.'
      : `Open Telegram, send "/start" to your bot, then call this endpoint again.`,
  });
};

/** POST /api/notifications/run-check — evaluate inventory now (deduplicated). */
exports.runCheck = async (req, res) => {
  const summary = await alertService.evaluateInventoryAlerts({ reason: 'manual' });
  const status = summary.ok ? 200 : (summary.skipped ? 400 : 500);
  res.status(status).json({
    success: Boolean(summary.ok),
    ...summary,
  });
};

/** GET /api/notifications/log — most recent delivered alerts. */
exports.log = async (req, res) => {
  try {
    const rows = await alertService.getRecentNotifications(req.query.limit);
    res.json({ notifications: rows });
  } catch (err) {
    console.error('[NOTIFICATIONS] log:', err.message);
    res.status(500).json({ error: 'Could not read the notification log.', code: 'NOTIFICATION_LOG_FAILED' });
  }
};
