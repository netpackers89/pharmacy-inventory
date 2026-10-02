/**
 * reportSchedulerService.js — schedules and delivers the weekly / monthly
 * Excel reports (inventory + audit) to the configured Telegram chat.
 *
 * RELIABILITY GUARANTEES
 *   • Idempotent: every report is identified by a UNIQUE period_key in
 *     report_deliveries, so a restart, a second server instance or an
 *     overlapping cron tick can never send the same week/month twice.
 *   • Deterministic windows: WEEKLY = the previous ISO week, MONTHLY = the
 *     previous calendar month, resolved in the reporting timezone.
 *   • Never fabricates success: a report is only marked SENT when Telegram
 *     confirms delivery. Failures are stored and retryable.
 *   • Granular: individual report types and the whole scheduler can be
 *     disabled from the settings table or the environment.
 *
 * Mechanism: node-cron when available, with a DB-guarded interval fallback so
 * the feature still works if node-cron is absent.
 */

const db = require('../config/db');
const telegram = require('./telegramService');
const excel = require('./reportExcelService');
const { readRaw } = require('../config/env');
const ExcelJS = require('exceljs');

const DEFAULT_WEEKLY_CRON = readRaw('REPORT_WEEKLY_CRON') || '0 7 * * 1';   // Monday 07:00
const DEFAULT_MONTHLY_CRON = readRaw('REPORT_MONTHLY_CRON') || '0 7 1 * *'; // 1st of month 07:00
const requestedIntervalHours = Number(readRaw('REPORT_INTERVAL_HOURS') || 12);
const INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24].includes(requestedIntervalHours) ? requestedIntervalHours : 12;
const DEFAULT_INTERVAL_CRON = INTERVAL_HOURS === 24 ? '0 0 * * *' : `0 */${INTERVAL_HOURS} * * *`;
const requestedIntervalFormat = String(readRaw('REPORT_INTERVAL_FORMAT') || 'TEXT').toUpperCase();
const INTERVAL_FORMAT = ['TEXT', 'CSV', 'EXCEL'].includes(requestedIntervalFormat) ? requestedIntervalFormat : 'TEXT';
const REPORT_HOUR = Math.min(23, Math.max(0, Number(readRaw('REPORT_HOUR') || 7)));
const CATCHUP_WINDOW_HOURS = Math.max(1, Number(readRaw('REPORT_CATCHUP_HOURS') || 72));

let started = false;
const tasks = [];

/* ── settings toggles (stored in the settings table) ──────────────────── */

/**
 * Which notification/report types are enabled. Values come from the settings
 * table when present, otherwise the environment or a sensible default.
 */
async function getReportSettings() {
  const defaults = {
    telegram_enabled: String(readRaw('REPORTS_ENABLED') || 'true').toLowerCase() !== 'false',
    interval_report_enabled: String(readRaw('REPORT_INTERVAL_ENABLED') || 'true').toLowerCase() !== 'false',
    weekly_report_enabled: true,
    monthly_report_enabled: true,
    audit_report_enabled: true,
    inventory_report_enabled: true,
  };
  try {
    const { rows } = await db.query(
      'SELECT setting_key, setting_value FROM settings WHERE setting_key = ANY($1::text[])',
      [Object.keys(defaults)]
    );
    for (const row of rows) {
      const value = String(row.setting_value).trim().toLowerCase();
      defaults[row.setting_key] = !['false', '0', 'off', 'no', 'disabled'].includes(value);
    }
  } catch (_) {
    // Settings are optional — fall back to defaults.
  }
  return defaults;
}

/* ── delivery ledger ──────────────────────────────────────────────────── */

/** Try to claim the unique slot for this period; returns { claimed, reportId }. */
async function claimDelivery({ type, scope, period, generatedBy, triggerSource, periodKey }) {
  const key = periodKey || excel.periodKey(type, scope, period);
  const insert = await db.query(
    `INSERT INTO report_deliveries
       (report_type, scope, period_start, period_end, period_key,
        generated_by, trigger_source, delivery_status, last_attempt_at)
     VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, 'PENDING', NOW())
     ON CONFLICT (period_key) DO NOTHING
     RETURNING report_id`,
    [type, scope, period.periodStart, period.periodEndExclusive, key,
      generatedBy || null, triggerSource]
  );
  if (insert.rows.length) {
    return { claimed: true, reportId: insert.rows[0].report_id, key, previousStatus: null };
  }

  const existing = await db.query(
    'SELECT report_id, delivery_status FROM report_deliveries WHERE period_key = $1',
    [key]
  );
  const row = existing.rows[0] || {};
  return { claimed: false, reportId: row.report_id, key, previousStatus: row.delivery_status };
}

function csvValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    return JSON.stringify(value);
  }
  return String(value);
}

function csvCell(value) {
  return `"${csvValue(value).replace(/"/g, '""')}"`;
}

async function workbookToCsv(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const lines = [];
  workbook.eachSheet((sheet) => {
    if (lines.length) lines.push('');
    lines.push(csvCell(sheet.name));
    sheet.eachRow({ includeEmpty: true }, (row) => {
      lines.push(row.values.slice(1).map(csvCell).join(','));
    });
  });
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

function textReport(type, scope, period, stats = {}) {
  const heading = type === 'INTERVAL'
    ? '12-hour inventory update'
    : `${type === 'WEEKLY' ? 'Weekly' : 'Monthly'} ${scope.toLowerCase()} report`;
  const values = scope === 'AUDIT'
    ? [['Audit events', stats.auditEvents], ['Stock movements', stats.movementCount], ['Failed actions', stats.failures]]
    : [
      ['Medicines', stats.medicines], ['Units in stock', stats.totalStock],
      ['Low-stock medicines', stats.lowStock], ['Out-of-stock medicines', stats.outOfStock],
      ['Near-expiry batches', stats.expiringBatches], ['Expired batches', stats.expiredBatches],
      ['Received', stats.received], ['Issued', stats.issued], ['Losses', stats.lost],
      ['Adjustments', stats.adjusted], ['Stock movements', stats.movementCount],
      ['Audit events', stats.auditEvents],
    ];
  const details = values.map(([label, value]) => `${label}: ${Number(value) || 0}`).join('\n');
  return `<b>${telegram.escapeHtml(heading)}</b>\nPeriod: ${telegram.escapeHtml(period.periodStart)} to ${telegram.escapeHtml(excel.inclusiveEnd(period))}\n\n${details}`;
}

/** Period object reconstructed from a stored delivery row (for retries). */
function periodFromRow(row) {
  const start = String(row.period_start).slice(0, 10);
  const end = String(row.period_end).slice(0, 10);
  return { periodStart: start, periodEndExclusive: end, label: `${start} to ${end}` };
}

/* ── generate + deliver one report ────────────────────────────────────── */

/**
 * Generate and deliver one report.
 * Returns a structured result — never throws for delivery problems.
 */
async function deliverReport({
  type, scope, period, generatedBy = null, triggerSource = 'SCHEDULED', force = false,
  format = 'EXCEL', periodKey: suppliedPeriodKey,
}) {
  const t = String(type).toUpperCase();
  const s = String(scope).toUpperCase();
  const outputFormat = String(format || 'EXCEL').toUpperCase();
  const key = suppliedPeriodKey || (outputFormat === 'EXCEL'
    ? excel.periodKey(t, s, period)
    : `${excel.periodKey(t, s, period)}_${outputFormat}`);

  const claim = await claimDelivery({ type: t, scope: s, period, generatedBy, triggerSource, periodKey: key });

  if (!claim.claimed && claim.previousStatus === 'SENT' && !force) {
    return { ok: true, skipped: true, reason: 'already-sent', periodKey: claim.key, reportId: claim.reportId };
  }
  if (!claim.claimed && claim.previousStatus === 'PENDING') {
    return { ok: true, skipped: true, reason: 'delivery-in-progress', periodKey: claim.key, reportId: claim.reportId };
  }
  if (!claim.claimed) {
    await db.query(
      `UPDATE report_deliveries
          SET delivery_attempts = delivery_attempts + 1, last_attempt_at = NOW(),
              trigger_source = $2, updated_at = NOW()
        WHERE report_id = $1`,
      [claim.reportId, triggerSource]
    );
  }

  let built;
  try {
    built = s === 'AUDIT'
      ? await excel.auditReport(t, period, { generatedBy })
      : t === 'INTERVAL'
        ? await excel.inventoryReport(t, period, { generatedBy })
        : (t === 'WEEKLY'
          ? await excel.weeklyInventoryReport(period, { generatedBy })
          : await excel.monthlyInventoryReport(period, { generatedBy }));
  } catch (err) {
    await db.query(
      `UPDATE report_deliveries
          SET delivery_status = 'FAILED', failure_reason = $2, updated_at = NOW()
        WHERE report_id = $1`,
      [claim.reportId, `Generation failed: ${err.message}`.slice(0, 500)]
    );
    return { ok: false, periodKey: claim.key, reportId: claim.reportId, error: err.message };
  }

  const message = outputFormat === 'TEXT' ? textReport(t, s, period, built.stats) : null;
  const document = outputFormat === 'CSV' ? await workbookToCsv(built.buffer) : built.buffer;
  const fileName = outputFormat === 'CSV' ? built.fileName.replace(/\.xlsx$/i, '.csv') : built.fileName;
  const byteSize = outputFormat === 'TEXT' ? Buffer.byteLength(message) : document.length;

  await db.query(
    `UPDATE report_deliveries
        SET file_name = $2, row_count = $3, byte_size = $4, report_format = $5, updated_at = NOW()
      WHERE report_id = $1`,
    [claim.reportId, outputFormat === 'TEXT' ? 'Telegram text message' : fileName,
      built.rowCount, byteSize, outputFormat]
  );

  const kind = s === 'AUDIT' ? 'audit' : 'inventory';
  const caption = `${t === 'INTERVAL' ? '12-hour' : t === 'WEEKLY' ? 'Weekly' : 'Monthly'} ${kind} report · ${period.periodStart} to ${excel.inclusiveEnd(period)}`;
  const sent = outputFormat === 'TEXT'
    ? await telegram.sendTelegramMessage(message)
    : await telegram.sendTelegramDocument(document, fileName, { caption });

  if (sent.ok) {
    await db.query(
      `UPDATE report_deliveries
          SET delivery_status = 'SENT', telegram_message_id = $2, failure_reason = NULL, updated_at = NOW()
        WHERE report_id = $1`,
      [claim.reportId, sent.message_id || null]
    );
    return {
      ok: true, delivered: true, periodKey: claim.key, reportId: claim.reportId,
      fileName: outputFormat === 'TEXT' ? null : fileName, format: outputFormat,
      rowCount: built.rowCount, bytes: byteSize, messageId: sent.message_id, period,
    };
  }

  await db.query(
    `UPDATE report_deliveries
        SET delivery_status = $2, failure_reason = $3, updated_at = NOW()
      WHERE report_id = $1`,
    [claim.reportId, sent.skipped ? 'SKIPPED' : 'FAILED', (sent.error || 'Unknown Telegram error').slice(0, 500)]
  );
  return {
    ok: false, periodKey: claim.key, reportId: claim.reportId,
    fileName: outputFormat === 'TEXT' ? null : fileName, format: outputFormat, rowCount: built.rowCount,
    deliveryStatus: sent.skipped ? 'SKIPPED' : 'FAILED',
    error: sent.error,
  };
}

/* ── scheduled runs ───────────────────────────────────────────────────── */

async function runScheduled(type) {
  const settings = await getReportSettings();
  if (!settings.telegram_enabled) return [{ ok: true, skipped: true, reason: 'telegram-disabled' }];

  const typeKey = `${String(type).toLowerCase()}_report_enabled`;
  if (settings[typeKey] === false) return [{ ok: true, skipped: true, reason: typeKey }];

  const period = excel.resolvePeriod(type);
  const scopes = [];
  if (settings.inventory_report_enabled !== false) scopes.push('INVENTORY');
  if (settings.audit_report_enabled !== false) scopes.push('AUDIT');

  const results = [];
  for (const scope of scopes) {
    try {
      // eslint-disable-next-line no-await-in-loop
      results.push(await deliverReport({ type, scope, period, triggerSource: 'SCHEDULED' }));
    } catch (err) {
      console.error(`[REPORTS] ${type} ${scope} failed:`, err.message);
      results.push({ ok: false, scope, error: err.message });
    }
  }
  console.log(
    `[REPORTS] ${type} ${period.periodStart}→${excel.inclusiveEnd(period)}:`,
    results.map((r) => (r.delivered ? 'sent' : r.skipped ? `skip(${r.reason})` : 'failed')).join(', ')
  );
  return results;
}

const runWeekly = () => runScheduled('WEEKLY');
const runMonthly = () => runScheduled('MONTHLY');

function currentIntervalSlot(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: excel.TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const hour = Math.floor(Number(values.hour) / INTERVAL_HOURS) * INTERVAL_HOURS;
  const slotHour = String(hour).padStart(2, '0');
  return {
    period: excel.periodFromRange(date, date),
    key: `INTERVAL_INVENTORY_${INTERVAL_FORMAT}_${date}_${slotHour}`,
  };
}

async function runInterval() {
  const settings = await getReportSettings();
  if (!settings.telegram_enabled || !settings.interval_report_enabled) {
    return [{ ok: true, skipped: true, reason: 'interval-report-disabled' }];
  }
  const slot = currentIntervalSlot();
  const result = await deliverReport({
    type: 'INTERVAL', scope: 'INVENTORY', period: slot.period,
    periodKey: slot.key, format: INTERVAL_FORMAT, triggerSource: 'SCHEDULED',
  });
  console.log(`[REPORTS] ${INTERVAL_HOURS}-hour inventory ${slot.key}:`, result.delivered ? 'sent' : result.skipped ? `skip(${result.reason})` : 'failed');
  return [result];
}

/**
 * Startup catch-up: a deployment that restarted around the scheduled time can
 * still deliver the just-missed period. Deduplication makes it safe on every boot.
 */
async function catchUpReports() {
  const results = [];
  for (const type of ['WEEKLY', 'MONTHLY']) {
    const period = excel.resolvePeriod(type);
    const ageHours = (Date.now() - Date.parse(`${period.periodEndExclusive}T00:00:00Z`)) / 3600000;
    if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > CATCHUP_WINDOW_HOURS) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      results.push({ type, results: await runScheduled(type) });
    } catch (err) {
      results.push({ type, error: err.message });
    }
  }
  try { results.push({ type: 'INTERVAL', results: await runInterval() }); } catch (err) {
    results.push({ type: 'INTERVAL', error: err.message });
  }
  return results;
}

/* ── scheduler lifecycle ──────────────────────────────────────────────── */

function localNowParts(now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: excel.TZ, weekday: 'short', hour: '2-digit', hourCycle: 'h23', day: '2-digit',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { weekday: map.weekday, hour: Number(map.hour), day: Number(map.day) };
}

function startReportScheduler() {
  if (started) return tasks;
  started = true;

  if (String(readRaw('REPORTS_ENABLED') || 'true').toLowerCase() === 'false') {
    console.warn('[REPORTS] Scheduler disabled (REPORTS_ENABLED=false).');
    return tasks;
  }
  if (!telegram.isConfigured()) {
    console.warn('[REPORTS] Scheduler not started: Telegram is not configured.');
    return tasks;
  }

  let cron = null;
  try { cron = require('node-cron'); } catch (_) { cron = null; }

  if (cron && typeof cron.schedule === 'function') {
    tasks.push(cron.schedule(DEFAULT_WEEKLY_CRON, () => { runWeekly().catch(() => {}); }, { timezone: excel.TZ }));
    tasks.push(cron.schedule(DEFAULT_MONTHLY_CRON, () => { runMonthly().catch(() => {}); }, { timezone: excel.TZ }));
    tasks.push(cron.schedule(DEFAULT_INTERVAL_CRON, () => { runInterval().catch(() => {}); }, { timezone: excel.TZ }));
    console.log(`[REPORTS] Scheduler started (${excel.TZ}): every ${INTERVAL_HOURS}h "${DEFAULT_INTERVAL_CRON}", weekly "${DEFAULT_WEEKLY_CRON}", monthly "${DEFAULT_MONTHLY_CRON}".`);
  } else {
    const tick = () => {
      const { weekday, hour, day } = localNowParts(new Date());
      if (hour % INTERVAL_HOURS === 0) runInterval().catch(() => {});
      if (hour !== REPORT_HOUR) return;
      if (weekday === 'Mon') runWeekly().catch(() => {});
      if (day === '1') runMonthly().catch(() => {});
    };
    const interval = setInterval(tick, 15 * 60 * 1000);
    if (typeof interval.unref === 'function') interval.unref();
    tasks.push(interval);
    console.log(`[REPORTS] Scheduler started (interval fallback; node-cron unavailable) in ${excel.TZ}.`);
  }

  const catchUp = setTimeout(() => { catchUpReports().catch(() => {}); }, 45000);
  if (typeof catchUp.unref === 'function') catchUp.unref();

  return tasks;
}

/* ── admin helpers ────────────────────────────────────────────────────── */

async function getRecentDeliveries(limit = 40) {
  const { rows } = await db.query(
    `SELECT report_id, report_type, scope, report_format, period_start, period_end, period_key,
            file_name, row_count, byte_size, trigger_source, delivery_status,
            delivery_attempts, last_attempt_at, telegram_message_id, failure_reason,
            generated_by, created_at
       FROM report_deliveries
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 40, 1), 200)]
  );
  return rows;
}

/** Re-generate and re-send a previously FAILED/SKIPPED report (no duplicates). */
async function retryDelivery(reportId, userId = null) {
  const { rows } = await db.query('SELECT * FROM report_deliveries WHERE report_id = $1', [reportId]);
  const row = rows[0];
  if (!row) throw Object.assign(new Error('Report delivery not found.'), { status: 404 });
  if (row.delivery_status === 'SENT') {
    throw Object.assign(new Error('This report was already delivered; re-sending is disabled to avoid duplicates.'), { status: 409 });
  }
  return deliverReport({
    type: row.report_type,
    scope: row.scope,
    format: row.report_format || 'EXCEL',
    period: periodFromRow(row),
    periodKey: row.period_key,
    generatedBy: userId,
    triggerSource: 'RETRY',
  });
}

module.exports = {
  startReportScheduler,
  runWeekly,
  runMonthly,
  runInterval,
  runScheduled,
  catchUpReports,
  deliverReport,
  getRecentDeliveries,
  retryDelivery,
  getReportSettings,
  CONFIG: {
    DEFAULT_WEEKLY_CRON,
    DEFAULT_MONTHLY_CRON,
    DEFAULT_INTERVAL_CRON,
    INTERVAL_HOURS,
    INTERVAL_FORMAT,
    REPORT_HOUR,
    CATCHUP_WINDOW_HOURS,
    TIMEZONE: excel.TZ,
  },
};