/**
 * inventoryAlertService.js — evaluates pharmacy inventory and pushes alerts.
 *
 * DESIGN PRINCIPLES
 *   - The PostgreSQL database is the source of truth; Telegram is only a
 *     notification channel. A Telegram failure never affects inventory.
 *   - Alerts are evaluated by a backend scheduler (never by React renders) and
 *     after a medicine/stock change (debounced, after the HTTP response).
 *   - DUPLICATE PREVENTION: every alert carries a fingerprint
 *       alert_type + medicine + batch + state
 *     which is stored in notification_log. The same alert is therefore sent
 *     ONCE. It is only sent again when the state changes (e.g. LOW → CRITICAL →
 *     OUT OF STOCK, or 90-day bucket → 30-day bucket) or after
 *     ALERT_REPEAT_HOURS, and it is silently dropped when the situation clears.
 *
 * Throttles: ALERT_MAX_MESSAGES_PER_RUN (default 20) messages per run so a
 * first run over a large catalogue cannot flood the chat.
 */

const db = require('../config/db');
const telegram = require('./telegramService');
const { readRaw } = require('../config/env');

function clampNumber(value, min, max, fallback) {
  // NOTE: Number('') is 0 (not NaN), so a missing env var must be handled first.
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/* Expiry buckets: the batch is announced when it ENTERS each bucket. */
const EXPIRY_BUCKETS = (readRaw('EXPIRY_ALERT_DAYS') || '90,60,30,7')
  .split(',')
  .map((n) => Number(String(n).trim()))
  .filter((n) => Number.isFinite(n) && n > 0)
  .sort((a, b) => a - b);

const CRITICAL_STOCK_THRESHOLD = clampNumber(readRaw('CRITICAL_STOCK_THRESHOLD'), 0, 10000, 5);
const REPEAT_HOURS = clampNumber(readRaw('ALERT_REPEAT_HOURS'), 0, 720, 0);
const MAX_MESSAGES_PER_RUN = clampNumber(readRaw('ALERT_MAX_MESSAGES_PER_RUN'), 1, 100, 20);
const CHECK_INTERVAL_MINUTES = clampNumber(readRaw('ALERT_CHECK_INTERVAL_MINUTES'), 5, 1440, 30);

const CHANNEL = 'TELEGRAM';

/** Human-facing stock status → alert type, using the medicine's own reorder level. */
function classifyStock(stock, reorderLevel) {
  const qty = Number(stock) || 0;
  const reorder = Number(reorderLevel) || 0;
  if (qty <= 0) return 'OUT_OF_STOCK';
  if (qty <= CRITICAL_STOCK_THRESHOLD) return 'CRITICAL_STOCK';
  if (reorder > 0 && qty <= reorder) return 'LOW_STOCK';
  return null;
}

/** Which expiry bucket (in days) does this batch fall into? null = no alert. */
function expiryBucket(daysLeft) {
  const days = Number(daysLeft);
  if (!Number.isFinite(days)) return null;
  if (days < 0) return 'EXPIRED';
  for (const threshold of EXPIRY_BUCKETS) {
    if (days <= threshold) return `EXPIRING_${threshold}`;
  }
  return null;
}

const label = (med) => [
  med.generic_name,
  med.brand_name ? `(${med.brand_name})` : '',
  med.strength || '',
].filter(Boolean).join(' ').trim() || `Medicine #${med.medicine_id}`;

/* ── Message builders (all values come from the database and are escaped) ── */

const unitLabel = (med) => String(med.base_unit || 'UNIT').toLowerCase();

/** ⚠️ LOW STOCK / 📉 CRITICAL STOCK / 🚨 OUT OF STOCK */
function stockMessage(med, alertType) {
  const qty = Number(med.stock) || 0;
  const unit = unitLabel(med);

  if (alertType === 'OUT_OF_STOCK') {
    return [
      '🚨 <b>OUT OF STOCK</b>',
      '',
      `Medicine: ${telegram.escapeHtml(label(med))}`,
      `Current stock: 0 ${unit}`,
      '',
      'Immediate inventory attention required.',
    ].join('\n');
  }

  if (alertType === 'CRITICAL_STOCK') {
    return [
      '📉 <b>CRITICAL STOCK</b>',
      '',
      `Medicine: ${telegram.escapeHtml(label(med))}`,
      `Current stock: ${qty} ${unit}`,
      `Critical threshold: ${CRITICAL_STOCK_THRESHOLD} ${unit}`,
      '',
      'Stock is critically low — reorder urgently.',
    ].join('\n');
  }

  return [
    '⚠️ <b>LOW STOCK</b>',
    '',
    `Medicine: ${telegram.escapeHtml(label(med))}`,
    `Current stock: ${qty} ${unit}`,
    `Minimum stock: ${Number(med.reorder_level) || 0} ${unit}`,
    '',
    'Please review and reorder.',
  ].join('\n');
}

/** ⏳ EXPIRY ALERT / 🚨 EXPIRED MEDICINE */
function expiryMessage(batch, alertType) {
  const days = Number(batch.days_left);
  const expiry = batch.expiry_date ? String(batch.expiry_date).slice(0, 10) : 'unknown';
  const medName = telegram.escapeHtml(label(batch));
  const batchNo = telegram.escapeHtml(batch.batch_number || 'n/a');
  const qty = Number(batch.stock_quantity) || 0;
  const unit = unitLabel(batch);

  if (alertType === 'EXPIRED') {
    return [
      '🚨 <b>EXPIRED MEDICINE</b>',
      '',
      `Medicine: ${medName}`,
      `Batch: ${batchNo}`,
      `Expiry: ${expiry}`,
      `Current stock: ${qty} ${unit}`,
      '',
      'Remove from active stock according to pharmacy procedures.',
    ].join('\n');
  }

  return [
    '⏳ <b>EXPIRY ALERT</b>',
    '',
    `Medicine: ${medName}`,
    `Batch: ${batchNo}`,
    `Expiry: ${expiry}`,
    `Remaining: ${days} day${days === 1 ? '' : 's'}`,
    `Stock: ${qty} ${unit}`,
    '',
    'Please review this batch (FEFO — dispense first).',
  ].join('\n');
}

/* ── Alert candidates straight out of PostgreSQL ─────────────────────────── */

/** Medicines at or below their reorder level (and out-of-stock medicines). */
async function buildStockAlerts() {
  const { rows } = await db.query(`
    SELECT m.medicine_id,
           m.generic_name,
           m.brand_name,
           m.strength,
           m.base_unit,
           COALESCE(m.reorder_level, 0)::int AS reorder_level,
           COALESCE(SUM(b.stock_quantity) FILTER (WHERE b.status = 'ACTIVE'), 0)::int AS stock
      FROM medicines m
      LEFT JOIN batches b ON b.medicine_id = m.medicine_id AND b.status = 'ACTIVE'
     WHERE m.status = 'ACTIVE'
     GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.base_unit, m.reorder_level
     ORDER BY stock ASC
     LIMIT 500
  `);

  const alerts = [];
  for (const med of rows) {
    const alertType = classifyStock(med.stock, med.reorder_level);
    if (!alertType) continue;
    alerts.push({
      alert_type: alertType,
      medicine_id: med.medicine_id,
      batch_id: null,
      state: alertType,
      // The fingerprint deliberately excludes the exact quantity: a normal sale
      // must not re-trigger an alert that was already delivered.
      fingerprint: `${alertType}:m${med.medicine_id}`,
      message: stockMessage(med, alertType),
    });
  }
  return alerts;
}

/** Batches that are expired or inside one of the expiry buckets. */
async function buildExpiryAlerts() {
  const widestBucket = EXPIRY_BUCKETS[EXPIRY_BUCKETS.length - 1] || 90;
  const { rows } = await db.query(
    `SELECT b.batch_id,
            b.batch_number,
            b.expiry_date,
            b.stock_quantity,
            (b.expiry_date - CURRENT_DATE)::int AS days_left,
            m.medicine_id,
            m.generic_name,
            m.brand_name,
            m.strength,
            m.base_unit
       FROM batches b
       JOIN medicines m ON m.medicine_id = b.medicine_id
      WHERE b.status = 'ACTIVE'
        AND m.status = 'ACTIVE'
        AND COALESCE(b.stock_quantity, 0) > 0
        AND b.expiry_date IS NOT NULL
        AND b.expiry_date <= CURRENT_DATE + ($1::int * INTERVAL '1 day')
      ORDER BY b.expiry_date ASC
      LIMIT 500`,
    [widestBucket]
  );

  const alerts = [];
  for (const batch of rows) {
    const alertType = expiryBucket(batch.days_left);
    if (!alertType) continue;
    alerts.push({
      alert_type: alertType,
      medicine_id: batch.medicine_id,
      batch_id: batch.batch_id,
      state: alertType,
      fingerprint: `${alertType}:b${batch.batch_id}`,
      message: expiryMessage(batch, alertType),
    });
  }
  return alerts;
}

/* ── notification-type toggles (settings table) ──────────────────────────── */

/**
 * Which individual notification types are enabled.
 * Stored in the settings table (admin-editable) and falls back to enabled when
 * an administrator has not configured a key.
 */
async function getAlertToggles() {
  const toggles = {
    alerts_enabled: true,
    alert_low_stock_enabled: true,
    alert_out_of_stock_enabled: true,
    alert_expiry_enabled: true,
  };
  try {
    const { rows } = await db.query(
      'SELECT setting_key, setting_value FROM settings WHERE setting_key = ANY($1::text[])',
      [Object.keys(toggles)]
    );
    for (const row of rows) {
      const value = String(row.setting_value === undefined || row.setting_value === null ? '' : row.setting_value)
        .trim()
        .toLowerCase();
      toggles[row.setting_key] = !['false', '0', 'off', 'no', 'disabled'].includes(value);
    }
  } catch (_) { /* settings are optional */ }
  return toggles;
}

/** Apply the per-type toggles to a candidate alert type. */
function isAlertEnabled(alertType, toggles) {
  const type = String(alertType || '');
  if (type === 'EXPIRED' || type.startsWith('EXPIRING_')) return toggles.alert_expiry_enabled;
  if (type === 'OUT_OF_STOCK' || type === 'CRITICAL_STOCK') return toggles.alert_out_of_stock_enabled;
  if (type === 'LOW_STOCK') return toggles.alert_low_stock_enabled;
  return true;
}

/* ── Delivery with duplicate prevention ──────────────────────────────────── */

/**
 * Evaluate the whole inventory and deliver only NEW alerts.
 * Called by the scheduler, by the manual endpoint and (debounced) after a
 * medicine/stock change. Never throws.
 */
async function evaluateInventoryAlerts({ reason = 'scheduler' } = {}) {
  if (!telegram.isConfigured()) {
    return { ok: false, skipped: true, reason: 'Telegram is not configured.', sent: 0 };
  }

  try {
    const toggles = await getAlertToggles();
    if (!toggles.alerts_enabled) {
      return { ok: true, skipped: true, reason: 'Alert notifications are disabled by an administrator.', sent: 0 };
    }

    const [stockAlerts, expiryAlerts] = await Promise.all([buildStockAlerts(), buildExpiryAlerts()]);
    const candidates = [...stockAlerts, ...expiryAlerts].filter((c) => isAlertEnabled(c.alert_type, toggles));
    const activeFingerprints = candidates.map((c) => c.fingerprint);

    const knownRes = await db.query(
      'SELECT fingerprint, last_sent_at FROM notification_log WHERE channel = $1',
      [CHANNEL]
    );
    const known = new Map(knownRes.rows.map((r) => [r.fingerprint, r.last_sent_at]));

    /*
     * Anything that is no longer an active alert is removed from the ledger, so
     * the NEXT time it becomes a problem the pharmacist is notified again.
     */
    await db.query(
      'DELETE FROM notification_log WHERE channel = $1 AND NOT (fingerprint = ANY($2::text[]))',
      [CHANNEL, activeFingerprints]
    );

    const summary = {
      ok: true, reason, checked: candidates.length,
      sent: 0, failed: 0, skipped: 0, capped: 0, alerts: [],
    };

    for (const candidate of candidates) {
      const lastSent = known.get(candidate.fingerprint);
      if (lastSent) {
        const ageHours = (Date.now() - new Date(lastSent).getTime()) / 3600000;
        if (REPEAT_HOURS <= 0 || ageHours < REPEAT_HOURS) {
          summary.skipped += 1; // already delivered, state unchanged
          continue;
        }
      }

      if (summary.sent + summary.failed >= MAX_MESSAGES_PER_RUN) {
        summary.capped += 1;
        continue;
      }

      const delivery = await telegram.sendTelegramMessage(candidate.message);

      if (!delivery.ok) {
        summary.failed += 1;
        console.error(`[ALERTS] Telegram delivery failed for ${candidate.fingerprint}: ${delivery.error}`);
        continue;
      }

      summary.sent += 1;
      /*
       * Only DELIVERED alerts are recorded. A failed send is deliberately not
       * stored, so the next run retries it instead of treating it as sent.
       */
      await db.query(
        `INSERT INTO notification_log
           (medicine_id, batch_id, alert_type, state, channel, fingerprint, message,
            delivery_status, last_sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'SENT', CURRENT_TIMESTAMP)
         ON CONFLICT (fingerprint) DO UPDATE
           SET last_sent_at = CURRENT_TIMESTAMP,
               delivery_status = 'SENT',
               failure_reason = NULL,
               message = EXCLUDED.message`,
        [candidate.medicine_id, candidate.batch_id, candidate.alert_type, candidate.state,
          CHANNEL, candidate.fingerprint, candidate.message]
      );
      summary.alerts.push({ type: candidate.alert_type, medicine_id: candidate.medicine_id });
    }

    if (summary.sent > 0) {
      // Let connected dashboards refresh their alert badges — enhancement only.
      try { require('../socket').emitDataUpdated('notifications'); } catch (_) { /* ignore */ }
    }

    console.log(
      `[ALERTS] Check complete (${reason}): ${summary.checked} active, ${summary.sent} sent, ` +
      `${summary.skipped} already notified, ${summary.failed} failed, ${summary.capped} deferred.`
    );
    return summary;
  } catch (err) {
    console.error('[ALERTS] Inventory alert check failed:', err.message);
    return { ok: false, reason, error: 'Inventory alert check failed.', sent: 0 };
  }
}

/* ── Change-triggered checks (debounced, never blocks an HTTP response) ──── */

let changeCheckTimer = null;

/**
 * Ask for an inventory check shortly after a medicine/stock change. The HTTP
 * response has already been sent by then, so Telegram latency can never slow
 * down the pharmacist's screen.
 */
function enqueueMedicineCheck(medicineId) {
  if (!telegram.isConfigured()) return;
  if (Number.isFinite(Number(medicineId)) === false) return;
  if (changeCheckTimer) return;
  changeCheckTimer = setTimeout(() => {
    changeCheckTimer = null;
    evaluateInventoryAlerts({ reason: 'inventory-change' }).catch(() => { /* already handled */ });
  }, 2000);
  if (typeof changeCheckTimer.unref === 'function') changeCheckTimer.unref();
}

/* ── Scheduler ───────────────────────────────────────────────────────────── */

let schedulerTimer = null;

/**
 * Background alert checking — independent of React and of user requests.
 * Runs once shortly after boot (a restart re-checks real inventory) and then
 * every ALERT_CHECK_INTERVAL_MINUTES (default 30). Socket.IO is deliberately
 * NOT used for scheduling; only for telling the open UI that something changed.
 */
function startAlertScheduler() {
  if (schedulerTimer) return schedulerTimer;
  if (!telegram.isConfigured()) {
    console.warn('[ALERTS] Scheduler not started: Telegram is not configured.');
    return null;
  }

  const intervalMs = CHECK_INTERVAL_MINUTES * 60 * 1000;

  const firstRun = setTimeout(() => {
    evaluateInventoryAlerts({ reason: 'startup' }).catch(() => { /* already handled */ });
  }, 15000);
  if (typeof firstRun.unref === 'function') firstRun.unref();

  schedulerTimer = setInterval(() => {
    evaluateInventoryAlerts({ reason: 'scheduler' }).catch(() => { /* already handled */ });
  }, intervalMs);
  if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref();

  console.log(`[ALERTS] Inventory alert scheduler started (every ${CHECK_INTERVAL_MINUTES} minutes).`);
  return schedulerTimer;
}

/** Recent delivery ledger for the settings/alerts screen. */
async function getRecentNotifications(limit = 50) {
  const { rows } = await db.query(
    `SELECT n.notification_id, n.medicine_id, n.batch_id, n.alert_type, n.state, n.channel,
            n.delivery_status, n.last_sent_at, n.created_at,
            m.generic_name, m.brand_name, m.strength
       FROM notification_log n
       LEFT JOIN medicines m ON m.medicine_id = n.medicine_id
      WHERE n.channel = $1
      ORDER BY n.last_sent_at DESC
      LIMIT $2`,
    [CHANNEL, Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return rows;
}

module.exports = {
  buildStockAlerts,
  buildExpiryAlerts,
  evaluateInventoryAlerts,
  enqueueMedicineCheck,
  startAlertScheduler,
  getRecentNotifications,
  classifyStock,
  expiryBucket,
  getAlertToggles,
  isAlertEnabled,
  CONFIG: {
    EXPIRY_BUCKETS,
    CRITICAL_STOCK_THRESHOLD,
    REPEAT_HOURS,
    MAX_MESSAGES_PER_RUN,
    CHECK_INTERVAL_MINUTES,
  },
};
