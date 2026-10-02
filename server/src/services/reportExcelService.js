/**
 * reportExcelService.js — builds the Excel (.xlsx) workbooks for the scheduled
 * and on-demand reports.
 *
 * The PostgreSQL database is the ONLY source of truth: every figure in every
 * workbook is a real query over medicines / batches / stock_movements / sales /
 * audit_logs / notification_log. This module never writes inventory data — it
 * only reads, formats and returns a Buffer.
 *
 * Workbooks produced:
 *   • weeklyInventoryReport()   — summary, low/zero stock, expiry, receipts,
 *                                 issues, losses/adjustments, movements, audit.
 *   • monthlyInventoryReport()  — same period totals plus medicine-wise
 *                                 activity, user activity and failures.
 *   • auditReport()             — weekly OR monthly audit workbook.
 *   • binCardReport()           — the formal, printable Bin Card per medicine.
 *
 * Each builder returns { buffer, fileName, rowCount, period, notes } so the
 * caller can record delivery, stream a download or upload to Telegram without
 * regenerating the report.
 */

const ExcelJS = require('exceljs');
const db = require('../config/db');
const { readRaw } = require('../config/env');

/* Reporting timezone — a calendar-date concept only, so DST never shifts a
   reporting period. Defaults to the pharmacy's timezone. */
const TZ = readRaw('REPORT_TIMEZONE') || readRaw('TZ') || 'Africa/Addis_Ababa';

/* How near is "near expiry" in the reports/alerts (days). */
const EXPIRY_WARNING_DAYS = Math.max(
  1,
  Number(String(readRaw('EXPIRY_ALERT_DAYS') || '90,60,30,7').split(',')[0].trim()) || 90
);

/* Hard caps so a huge movement/audit table can never exhaust memory. */
const MAX_MOVEMENT_ROWS = Math.max(100, Number(readRaw('REPORT_MAX_MOVEMENT_ROWS') || 5000));
const MAX_AUDIT_ROWS = Math.max(100, Number(readRaw('REPORT_MAX_AUDIT_ROWS') || 5000));
const MAX_BIN_CARD_ROWS = Math.max(100, Number(readRaw('REPORT_MAX_BIN_CARD_ROWS') || 3000));

/* ── small formatting helpers ─────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' in the reporting timezone, for "today". */
function todayInTz(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const [y, m, d] = parts.split('-').map(Number);
  return { y, m, d };
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** A DATE column (string or JS Date) → 'YYYY-MM-DD'. */
function dateOnly(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** A timestamp column → 'YYYY-MM-DD HH:mm'. */
function dateTime(value) {
  if (value === null || value === undefined || value === '') return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Excel formula-injection guard (same rule the audit archive uses). */
function safeCell(value) {
  if (value === null || value === undefined) return '';
  const string = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /^[=+\-@]/.test(string) ? `'${string}` : string;
}

const titleCase = (value) => String(value || '')
  .toLowerCase()
  .split(/[_\s]+/)
  .filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ');

/** Readable label for a type (RESUPPLY → "Resupply"). */
const label = (value) => titleCase(value);

/* ── period resolution ────────────────────────────────────────────────── */

const DAY_MS = 86400000;

/**
 * Resolve the reporting window for a scheduled report.
 *
 *   WEEKLY  → the previous ISO week (Monday 00:00 .. next Monday 00:00)
 *   MONTHLY → the previous calendar month (1st .. 1st of this month)
 *
 * `periodEnd` is EXCLUSIVE. Dates are calendar dates in the reporting
 * timezone, so a period never shifts by a partial day.
 */
function resolvePeriod(type, now = new Date()) {
  const { y, m, d } = todayInTz(now);
  const todayUtc = Date.UTC(y, m - 1, d);

  if (String(type).toUpperCase() === 'MONTHLY') {
    const start = Date.UTC(y, m - 2, 1);       // previous month, day 1
    const endExclusive = Date.UTC(y, m - 1, 1); // this month, day 1
    return {
      periodStart: isoDay(start),
      periodEndExclusive: isoDay(endExclusive),
      label: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })
        .format(new Date(start)),
    };
  }

  // WEEKLY (default)
  const dow = (new Date(todayUtc).getUTCDay() + 6) % 7; // 0 = Monday
  const thisMonday = todayUtc - dow * DAY_MS;
  const start = thisMonday - 7 * DAY_MS;
  return {
    periodStart: isoDay(start),
    periodEndExclusive: isoDay(thisMonday),
    label: `${isoDay(start)} to ${isoDay(thisMonday - DAY_MS)}`,
  };
}

/** Inclusive last day, for display only. */
const inclusiveEnd = (period) => isoDay(Date.parse(`${period.periodEndExclusive}T00:00:00Z`) - DAY_MS);

function periodKey(type, scope, period) {
  return `${String(type).toUpperCase()}_${String(scope).toUpperCase()}_${period.periodStart}_${period.periodEndExclusive}`;
}

function safeFileName(type, scope, period) {
  return `${String(type).toLowerCase()}_${String(scope).toLowerCase()}_report_${period.periodStart}_${period.periodEndExclusive}.xlsx`;
}

/* ── workbook styling helpers ─────────────────────────────────────────── */

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3B63' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const TITLE_FONT = { bold: true, size: 14, color: { argb: 'FF14284A' } };
const SUBTITLE_FONT = { bold: true, size: 11 };
const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFD0D7E2' } },
  left: { style: 'thin', color: { argb: 'FFD0D7E2' } },
  bottom: { style: 'thin', color: { argb: 'FFD0D7E2' } },
  right: { style: 'thin', color: { argb: 'FFD0D7E2' } },
};

function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smart Pharmacy Inventory System';
  wb.created = new Date();
  wb.modified = new Date();
  return wb;
}

/**
 * Write an optional title block followed by a formatted, filterable table.
 * Returns the number of DATA rows written (header/title rows excluded).
 */
function writeTable(sheet, { titleLines = [], headers, widths, rows, freeze = true }) {
  for (const line of titleLines) {
    const row = sheet.addRow(line);
    row.getCell(1).font = line.length === 1 ? TITLE_FONT : SUBTITLE_FONT;
  }
  if (titleLines.length) sheet.addRow([]);

  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  });
  headerRow.height = 22;

  headers.forEach((_h, i) => { sheet.getColumn(i + 1).width = (widths && widths[i]) || 16; });

  for (const r of rows) {
    const row = sheet.addRow(r);
    row.eachCell({ includeEmpty: true }, (cell) => { cell.border = THIN_BORDER; });
  }

  if (freeze) sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];
  sheet.autoFilter = {
    from: { row: headerRow.number, column: 1 },
    to: { row: headerRow.number, column: headers.length },
  };
  return rows.length;
}

/* ── data loaders (real database rows only) ───────────────────────────── */

/** Current stock position per medicine, with its own reorder/max levels. */
async function loadStockPositions() {
  const { rows } = await db.query(`
    SELECT m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form,
           COALESCE(m.base_unit, 'UNIT') AS base_unit,
           COALESCE(m.reorder_level, 0)::int AS reorder_level,
           COALESCE(m.max_level, 0)::int     AS max_level,
           m.status,
           COALESCE(SUM(b.stock_quantity), 0)::int AS stock
      FROM medicines m
      LEFT JOIN batches b ON b.medicine_id = m.medicine_id AND b.status <> 'INACTIVE'
     GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form,
              m.base_unit, m.reorder_level, m.max_level, m.status
     ORDER BY m.generic_name ASC
  `);
  return rows;
}

/**
 * Medicine-wise received / issued / lost / adjusted totals inside the period.
 * Signs are normalised so "lost" is never reported as a negative number.
 */
async function loadMovementTotals(period) {
  const { rows } = await db.query(`
    SELECT m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form,
           COALESCE(m.base_unit, 'UNIT') AS base_unit,
           COALESCE(SUM(CASE WHEN sm.movement_type = 'RESUPPLY' AND sm.quantity > 0
                        THEN sm.quantity ELSE 0 END), 0)::int AS received,
           COALESCE(SUM(CASE WHEN sm.movement_type = 'SALE' AND sm.quantity < 0
                        THEN -sm.quantity ELSE 0 END), 0)::int AS issued,
           COALESCE(SUM(CASE WHEN sm.movement_type IN ('DAMAGE', 'EXPIRY') AND sm.quantity < 0
                        THEN -sm.quantity ELSE 0 END), 0)::int AS lost,
           COALESCE(SUM(CASE WHEN sm.movement_type = 'RETURN' AND sm.quantity < 0
                        THEN -sm.quantity ELSE 0 END), 0)::int AS returned,
           COALESCE(SUM(CASE WHEN sm.movement_type IN ('ADJUSTMENT', 'PHYSICAL_COUNT')
                        THEN sm.quantity ELSE 0 END), 0)::int AS adjusted,
           COUNT(*)::int AS movement_count
      FROM stock_movements sm
      JOIN batches b ON b.batch_id = sm.batch_id
      JOIN medicines m ON m.medicine_id = b.medicine_id
     WHERE sm.movement_date >= $1::date AND sm.movement_date < $2::date
     GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.base_unit
     ORDER BY m.generic_name ASC
  `, [period.periodStart, period.periodEndExclusive]);
  return rows;
}

/** Detailed stock movement rows inside the period (newest first). */
async function loadMovements(period) {
  const { rows } = await db.query(`
    SELECT sm.movement_id, sm.movement_date, sm.movement_type,
           sm.quantity, sm.previous_stock, sm.new_stock,
           sm.reference_type, sm.reference_id, sm.reason, sm.notes,
           b.batch_number, b.expiry_date,
           m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form,
           COALESCE(m.base_unit, 'UNIT') AS base_unit,
           u.full_name, u.username
      FROM stock_movements sm
      JOIN batches b ON b.batch_id = sm.batch_id
      JOIN medicines m ON m.medicine_id = b.medicine_id
      LEFT JOIN users u ON u.user_id = sm.user_id
     WHERE sm.movement_date >= $1::date AND sm.movement_date < $2::date
     ORDER BY sm.movement_date DESC, sm.movement_id DESC
     LIMIT $3
  `, [period.periodStart, period.periodEndExclusive, MAX_MOVEMENT_ROWS]);
  return rows;
}

/** Near-expiry and already-expired batches that still hold stock. */
async function loadExpiry(warningDays) {
  const { rows } = await db.query(`
    SELECT m.generic_name, m.brand_name, m.strength, m.dosage_form,
           COALESCE(m.base_unit, 'UNIT') AS base_unit,
           b.batch_number, b.expiry_date, b.stock_quantity,
           (b.expiry_date - CURRENT_DATE)::int AS days_to_expiry
      FROM batches b
      JOIN medicines m ON m.medicine_id = b.medicine_id
     WHERE b.status <> 'INACTIVE' AND b.stock_quantity > 0
       AND b.expiry_date <= (CURRENT_DATE + ($1::int * INTERVAL '1 day'))
     ORDER BY b.expiry_date ASC
  `, [warningDays]);
  return rows;
}

/**
 * Balance per medicine as of a boundary, derived from the movement ledger.
 * The latest movement per batch carries the authoritative running balance
 * (stock_movements.new_stock); the medicine total is the sum of its batches.
 */
async function loadBalancesAsOf(dateBoundaryExclusive) {
  const { rows } = await db.query(`
    SELECT medicine_id, SUM(new_stock)::int AS balance
      FROM (
        SELECT DISTINCT ON (sm.batch_id) b.medicine_id, sm.new_stock
          FROM stock_movements sm
          JOIN batches b ON b.batch_id = sm.batch_id
         WHERE sm.movement_date < $1::date
         ORDER BY sm.batch_id, sm.movement_date DESC, sm.movement_id DESC
      ) latest
     GROUP BY medicine_id
  `, [dateBoundaryExclusive]);
  return rows;
}

/** Audit events inside the period (newest first). */
async function loadAuditEvents(period) {
  const { rows } = await db.query(`
    SELECT al.audit_id, al.created_at, al.action, al.module, al.table_name,
           al.record_id, al.entity_type, al.entity_id, al.description,
           al.old_values, al.new_values, al.status, al.ip_address,
           u.full_name, u.username
      FROM audit_logs al
      LEFT JOIN users u ON u.user_id = al.user_id
     WHERE al.created_at >= $1::date AND al.created_at < $2::date
     ORDER BY al.created_at DESC, al.audit_id DESC
     LIMIT $3
  `, [period.periodStart, period.periodEndExclusive, MAX_AUDIT_ROWS]);
  return rows;
}

/** Audit activity grouped by user, plus failure counts. */
async function loadUserActivity(period) {
  const { rows } = await db.query(`
    SELECT COALESCE(u.full_name, 'System / Guest') AS full_name,
           COALESCE(u.username, '—') AS username,
           COALESCE(u.role, 'SYSTEM') AS role,
           COUNT(*)::int AS events,
           COUNT(*) FILTER (WHERE al.status = 'FAILED')::int AS failures
      FROM audit_logs al
      LEFT JOIN users u ON u.user_id = al.user_id
     WHERE al.created_at >= $1::date AND al.created_at < $2::date
     GROUP BY u.full_name, u.username, u.role
     ORDER BY events DESC
  `, [period.periodStart, period.periodEndExclusive]);
  return rows;
}

/** Failed audit events (failed operations / discrepancies) inside the period. */
async function loadFailures(period) {
  const { rows } = await db.query(`
    SELECT al.created_at, al.action, al.module, al.description, al.ip_address,
           COALESCE(u.full_name, 'System / Guest') AS full_name, u.username
      FROM audit_logs al
      LEFT JOIN users u ON u.user_id = al.user_id
     WHERE al.status = 'FAILED'
       AND al.created_at >= $1::date AND al.created_at < $2::date
     ORDER BY al.created_at DESC, al.audit_id DESC
     LIMIT 2000
  `, [period.periodStart, period.periodEndExclusive]);
  return rows;
}

/** Delivered alerts (notification ledger) for the period. */
async function loadNotifications(period) {
  const { rows } = await db.query(`
    SELECT n.notification_id, n.alert_type, n.state, n.delivery_status,
           n.last_sent_at, n.failure_reason,
           m.generic_name, m.brand_name, m.strength,
           b.batch_number, b.expiry_date
      FROM notification_log n
      LEFT JOIN medicines m ON m.medicine_id = n.medicine_id
      LEFT JOIN batches b ON b.batch_id = n.batch_id
     WHERE n.created_at >= $1::date AND n.created_at < $2::date
     ORDER BY n.last_sent_at DESC
     LIMIT 1000
  `, [period.periodStart, period.periodEndExclusive]);
  return rows;
}

/* ── derived classification / statistics ──────────────────────────────── */

function classifyPosition(pos) {
  const stock = num(pos.stock);
  const reorder = num(pos.reorder_level);
  if (stock <= 0) return 'OUT OF STOCK';
  if (reorder > 0 && stock <= reorder) return 'LOW';
  return 'OK';
}

function summarise({ positions, totals, expiry, movements, audit, failures, notifications }) {
  const outOfStock = positions.filter((p) => num(p.stock) <= 0).length;
  const lowStock = positions.filter(
    (p) => num(p.stock) > 0 && num(p.reorder_level) > 0 && num(p.stock) <= num(p.reorder_level)
  ).length;
  return {
    medicines: positions.length,
    totalStock: positions.reduce((s, p) => s + num(p.stock), 0),
    outOfStock,
    lowStock,
    expiringBatches: expiry.filter((e) => num(e.days_to_expiry) >= 0).length,
    expiredBatches: expiry.filter((e) => num(e.days_to_expiry) < 0).length,
    received: totals.reduce((s, t) => s + num(t.received), 0),
    issued: totals.reduce((s, t) => s + num(t.issued), 0),
    lost: totals.reduce((s, t) => s + num(t.lost), 0),
    returned: totals.reduce((s, t) => s + num(t.returned), 0),
    adjusted: totals.reduce((s, t) => s + num(t.adjusted), 0),
    movementCount: movements.length,
    auditEvents: audit.length,
    failures: failures.length,
    alerts: notifications.length,
  };
}

/** Add one formatted worksheet from a plain row matrix. */
function addSheet(wb, name, titleLines, headers, widths, rows) {
  const sheet = wb.addWorksheet(name);
  writeTable(sheet, { titleLines, headers, widths, rows });
  return sheet;
}

/** The Summary sheet (metric / value layout, no filter). */
function addSummarySheet(wb, {
  type, period, stats, generatedBy, openingTotal, closingTotal, notes, showInventory = true,
}) {
  const sheet = wb.addWorksheet('Summary');
  sheet.getColumn(1).width = 48;
  sheet.getColumn(2).width = 94;

  const rows = [
    [`${label(type)} ${showInventory ? 'Inventory' : 'Audit'} Report`, ''],
    ['Reporting period', `${period.periodStart} to ${inclusiveEnd(period)} (end exclusive ${period.periodEndExclusive})`],
    ['Generated at', dateTime(new Date())],
    ['Generated by', generatedBy || 'System (scheduled)'],
    ['Time zone', TZ],
    ['', ''],
  ];

  if (showInventory) {
    rows.push(
      ['INVENTORY POSITION', ''],
      ['Medicines tracked', stats.medicines],
      ['Total units in stock', stats.totalStock],
      ['Medicines out of stock', stats.outOfStock],
      ['Medicines at / below reorder level', stats.lowStock],
      ['Batches expiring soon', stats.expiringBatches],
      ['Batches already expired (with stock)', stats.expiredBatches],
      ['', ''],
    );
  }

  rows.push(
    ['ACTIVITY IN THIS PERIOD', ''],
    ['Units received', stats.received],
    ['Units issued / dispensed', stats.issued],
    ['Units lost (damage / expiry)', stats.lost],
    ['Units returned', stats.returned],
    ['Adjustment delta (net)', stats.adjusted],
    ['Stock movement records', stats.movementCount],
    ['Audit events', stats.auditEvents],
    ['Failed operations', stats.failures],
    ['Alerts delivered', stats.alerts],
  );

  if (showInventory) {
    rows.push(
      ['', ''],
      ['STOCK RECONCILIATION (movement ledger)', ''],
      ['Opening stock (start of period)', openingTotal === null || openingTotal === undefined ? 'n/a' : openingTotal],
      ['Closing stock (end of period)', closingTotal === null || closingTotal === undefined ? 'n/a' : closingTotal],
      ['Net change', (openingTotal == null || closingTotal == null) ? 'n/a' : closingTotal - openingTotal],
    );
  }

  rows.push(['', ''], ['NOTES & LIMITATIONS', '']);
  for (const note of notes) rows.push(['•', note]);

  rows.forEach(([key, value], index) => {
    const row = sheet.addRow([key, value === undefined || value === null ? '' : value]);
    if (index === 0) row.getCell(1).font = TITLE_FONT;
    else if (value === '') row.getCell(1).font = SUBTITLE_FONT;
    else row.getCell(1).font = { bold: true };
  });
  return sheet;
}

/* ── worksheet builders ───────────────────────────────────────────────── */

/** Low-stock and zero-stock medicines (compare stock with the reorder level). */
function sheetStockAttention(wb, positions) {
  const attention = positions.filter((p) => classifyPosition(p) !== 'OK');
  const rows = attention.map((p) => [
    p.generic_name, p.brand_name || '', p.strength || '', p.dosage_form || '',
    num(p.stock), num(p.reorder_level), num(p.max_level), p.base_unit,
    classifyPosition(p), p.status || '',
  ]);
  addSheet(wb, 'Low & Zero Stock',
    [[`Medicines requiring attention (${attention.length})`], []],
    ['Medicine', 'Brand', 'Strength', 'Dosage form', 'Current stock',
      'Reorder (emergency) level', 'Max level', 'Unit', 'Stock state', 'Medicine status'],
    [34, 22, 14, 16, 14, 16, 12, 10, 16, 16], rows);
}

/** Near-expiry and already-expired batches that still hold stock. */
function sheetExpiry(wb, expiry) {
  const rows = expiry.map((e) => [
    e.generic_name, e.brand_name || '', e.strength || '', e.dosage_form || '',
    e.batch_number, dateOnly(e.expiry_date), num(e.stock_quantity), e.base_unit,
    num(e.days_to_expiry), num(e.days_to_expiry) < 0 ? 'EXPIRED' : 'EXPIRING SOON',
  ]);
  addSheet(wb, 'Expiry',
    [[`Near-expiry & expired batches (${expiry.length})`], [`Warning window: ${EXPIRY_WARNING_DAYS} days`], []],
    ['Medicine', 'Brand', 'Strength', 'Dosage form', 'Batch no.', 'Expiry date',
      'Stock', 'Unit', 'Days to expiry', 'State'],
    [34, 22, 14, 16, 18, 14, 10, 10, 14, 16], rows);
}

/** Medicine-wise received / issued / lost / adjusted totals for the period. */
function sheetMovementTotals(wb, totals) {
  const rows = totals.map((t) => [
    t.generic_name, t.brand_name || '', t.strength || '', t.dosage_form || '', t.base_unit,
    num(t.received), num(t.issued), num(t.lost), num(t.returned), num(t.adjusted), num(t.movement_count),
  ]);
  addSheet(wb, 'Stock Movement Totals',
    [['Medicine-wise movement totals for the period'], []],
    ['Medicine', 'Brand', 'Strength', 'Dosage form', 'Unit', 'Received', 'Issued',
      'Lost', 'Returned', 'Adjustment (net)', 'Movements'],
    [34, 22, 14, 16, 10, 12, 12, 10, 12, 16, 12], rows);
}

/** Transaction-by-transaction stock movements for the period. */
function sheetMovements(wb, movements) {
  const capped = movements.length >= MAX_MOVEMENT_ROWS ? `, capped at ${MAX_MOVEMENT_ROWS}` : '';
  const rows = movements.map((m) => [
    dateTime(m.movement_date), m.movement_type,
    m.generic_name, m.brand_name || '', m.strength || '', m.dosage_form || '',
    m.batch_number || '', dateOnly(m.expiry_date),
    num(m.quantity), num(m.previous_stock), num(m.new_stock),
    m.reference_type || '', m.reference_id == null ? '' : m.reference_id,
    m.reason || '', m.notes || '', m.full_name || m.username || 'System',
  ]);
  addSheet(wb, 'Stock Movements',
    [[`Detailed stock movements (${movements.length}${capped})`], []],
    ['Date / time', 'Type', 'Medicine', 'Brand', 'Strength', 'Dosage form', 'Batch',
      'Expiry', 'Qty change', 'Stock before', 'Stock after', 'Reference type',
      'Reference id', 'Reason', 'Notes', 'User'],
    [18, 14, 30, 20, 12, 14, 16, 12, 12, 12, 12, 16, 12, 20, 30, 22], rows);
}

/** Audit events (who changed what, when, and with which before/after values). */
function sheetAudit(wb, events) {
  const capped = events.length >= MAX_AUDIT_ROWS ? `, capped at ${MAX_AUDIT_ROWS}` : '';
  const rows = events.map((e) => [
    dateTime(e.created_at), e.full_name || 'System / Guest', e.username || '',
    e.action, e.module || '', e.table_name || '', e.record_id == null ? '' : e.record_id,
    e.description || '',
    e.old_values == null ? '' : safeCell(e.old_values),
    e.new_values == null ? '' : safeCell(e.new_values),
    e.status || '', e.ip_address || '',
  ]);
  addSheet(wb, 'Audit Events',
    [[`Audit events (${events.length}${capped})`], []],
    ['Date / time', 'User', 'Username', 'Action', 'Module', 'Entity', 'Record id',
      'Description', 'Previous value', 'New value', 'Outcome', 'IP address'],
    [18, 24, 16, 18, 14, 16, 12, 40, 34, 34, 12, 16], rows);
}

/** Audit activity grouped by user, with failure counts. */
function sheetUserActivity(wb, users) {
  const rows = users.map((u) => [
    u.full_name, u.username, u.role, num(u.events), num(u.failures),
  ]);
  addSheet(wb, 'User Activity',
    [['User activity & failures for the period'], []],
    ['User', 'Username', 'Role', 'Events', 'Failed events'],
    [30, 20, 14, 12, 14], rows);
}

/** Failed operations / discrepancies. */
function sheetFailures(wb, failures) {
  const rows = failures.map((f) => [
    dateTime(f.created_at), f.action, f.module || '', f.full_name || 'System / Guest',
    f.username || '', f.description || '', f.ip_address || '',
  ]);
  addSheet(wb, 'Failures & Discrepancies',
    [[`Failed operations & discrepancies (${failures.length})`], []],
    ['Date / time', 'Action', 'Module', 'User', 'Username', 'Description', 'IP address'],
    [18, 18, 14, 24, 16, 46, 16], rows);
}

/** Alerts that were delivered to Telegram during the period. */
function sheetNotifications(wb, notes) {
  const rows = notes.map((n) => [
    dateTime(n.last_sent_at), n.alert_type, n.state, n.delivery_status,
    n.generic_name || '', n.brand_name || '', n.strength || '',
    n.batch_number || '', dateOnly(n.expiry_date), n.failure_reason || '',
  ]);
  addSheet(wb, 'Alerts Delivered',
    [[`Alerts delivered to Telegram (${notes.length})`], []],
    ['Sent at', 'Alert type', 'State', 'Delivery', 'Medicine', 'Brand', 'Strength',
      'Batch', 'Expiry', 'Failure reason'],
    [18, 18, 14, 12, 30, 20, 12, 16, 12, 34], rows);
}

/* ── the report builders ──────────────────────────────────────────────── */

const OPENING_BALANCE_NOTE =
  'Opening/closing balances are reconstructed from the stock movement ledger (the latest new_stock per batch before the boundary). Where a batch history begins inside the period its opening balance is its earliest known value, so a total can be a lower bound.';
const CAPPED_NOTE =
  'Very large movement or audit tables are capped (see each sheet header) so the workbook stays openable.';

async function collectInventoryData(period) {
  const [positions, totals, movements, expiry, audit, users, failures, notifications, closingRows, openingRows] =
    await Promise.all([
      loadStockPositions(),
      loadMovementTotals(period),
      loadMovements(period),
      loadExpiry(EXPIRY_WARNING_DAYS),
      loadAuditEvents(period),
      loadUserActivity(period),
      loadFailures(period),
      loadNotifications(period),
      loadBalancesAsOf(period.periodEndExclusive),
      loadBalancesAsOf(period.periodStart),
    ]);
  return { positions, totals, movements, expiry, audit, users, failures, notifications, closingRows, openingRows };
}

function sumBalances(rows) {
  if (!rows || !rows.length) return null;
  return rows.reduce((s, r) => s + num(r.balance), 0);
}

async function buildInventoryReport(type, period, options = {}) {
  const data = await collectInventoryData(period);
  const stats = summarise(data);
  const openingTotal = sumBalances(data.openingRows);
  const closingTotal = sumBalances(data.closingRows);
  const notes = [OPENING_BALANCE_NOTE, CAPPED_NOTE];
  if (!data.movements.length) notes.push('No stock movements were recorded in this period.');

  const wb = newWorkbook();
  addSummarySheet(wb, {
    type, period, stats, generatedBy: options.generatedBy, openingTotal, closingTotal, notes,
  });
  sheetStockAttention(wb, data.positions);
  sheetExpiry(wb, data.expiry);
  sheetMovementTotals(wb, data.totals);
  sheetMovements(wb, data.movements);
  sheetAudit(wb, data.audit);
  if (String(type).toUpperCase() === 'MONTHLY') {
    sheetUserActivity(wb, data.users);
    sheetFailures(wb, data.failures);
    sheetNotifications(wb, data.notifications);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    fileName: safeFileName(type, 'INVENTORY', period),
    rowCount: data.movements.length + data.audit.length,
    period,
    stats,
    notes,
  };
}

const weeklyInventoryReport = (period, options) => buildInventoryReport('WEEKLY', period, options);
const monthlyInventoryReport = (period, options) => buildInventoryReport('MONTHLY', period, options);

/** Weekly / monthly AUDIT workbook (audit events + stock movements + users). */
async function auditReport(type, period, options = {}) {
  const [events, movements, users, failures] = await Promise.all([
    loadAuditEvents(period),
    loadMovements(period),
    loadUserActivity(period),
    loadFailures(period),
  ]);

  const wb = newWorkbook();
  const stats = {
    medicines: 0, totalStock: 0, outOfStock: 0, lowStock: 0, expiringBatches: 0, expiredBatches: 0,
    received: 0, issued: 0, lost: 0, returned: 0, adjusted: 0,
    movementCount: movements.length, auditEvents: events.length,
    failures: failures.length, alerts: 0,
  };
  addSummarySheet(wb, {
    type, period, stats, generatedBy: options.generatedBy,
    openingTotal: null, closingTotal: null, showInventory: false,
    notes: [
      'This audit workbook lists the audit_logs and stock_movements actually recorded in the period.',
      CAPPED_NOTE,
    ],
  });
  sheetAudit(wb, events);
  sheetMovements(wb, movements);
  sheetUserActivity(wb, users);
  sheetFailures(wb, failures);

  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    fileName: safeFileName(type, 'AUDIT', period),
    rowCount: events.length,
    period,
    stats,
  };
}

/* ── formal Bin Card ──────────────────────────────────────────────────── */

/** Medicine identification section for the Bin Card header. */
async function loadBinCardMedicine(medicineId) {
  const { rows } = await db.query(`
    SELECT m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form,
           COALESCE(m.base_unit, 'UNIT') AS base_unit,
           COALESCE(m.reorder_level, 0)::int AS reorder_level,
           COALESCE(m.max_level, 0)::int AS max_level,
           m.status, c.name AS category_name,
           COALESCE(SUM(b.stock_quantity), 0)::int AS total_stock
      FROM medicines m
      LEFT JOIN batches b ON b.medicine_id = m.medicine_id AND b.status <> 'INACTIVE'
      LEFT JOIN categories c ON c.category_id = m.category_id
     WHERE m.medicine_id = $1
     GROUP BY m.medicine_id, c.name
  `, [medicineId]);
  return rows[0] || null;
}

/** Average Monthly Consumption = units sold in the last 90 days ÷ 3. */
async function loadAmc(medicineId) {
  const { rows } = await db.query(`
    SELECT COALESCE(SUM(si.quantity), 0)::int AS units_90d
      FROM sale_items si
      JOIN batches b ON b.batch_id = si.batch_id
      JOIN sales s ON s.sale_id = si.sale_id
     WHERE b.medicine_id = $1 AND s.status = 'COMPLETED'
       AND s.sale_date >= CURRENT_DATE - INTERVAL '90 days'
  `, [medicineId]);
  return Math.round((num(rows[0] && rows[0].units_90d) / 3) * 10) / 10;
}

/** Every receipt / issue / loss / adjustment for one medicine. */
async function loadBinCardTransactions({ medicineId, from, toExclusive, batchId, movementType }) {
  const { rows } = await db.query(`
    SELECT sm.movement_id, sm.movement_date, sm.movement_type,
           sm.reference_type, sm.reference_id, sm.reason, sm.notes,
           sm.quantity, sm.previous_stock, sm.new_stock,
           b.batch_id, b.batch_number, b.expiry_date,
           s.name AS supplier_name, u.full_name, u.username
      FROM stock_movements sm
      JOIN batches b ON b.batch_id = sm.batch_id
      LEFT JOIN suppliers s ON s.supplier_id = b.supplier_id
      LEFT JOIN users u ON u.user_id = sm.user_id
     WHERE b.medicine_id = $1
       AND ($2::date IS NULL OR sm.movement_date >= $2::date)
       AND ($3::date IS NULL OR sm.movement_date < $3::date)
       AND ($4::bigint IS NULL OR sm.batch_id = $4)
       AND ($5::text IS NULL OR sm.movement_type = $5)
     ORDER BY sm.movement_date ASC, sm.movement_id ASC
     LIMIT $6
  `, [medicineId, from || null, toExclusive || null, batchId || null, movementType || null, MAX_BIN_CARD_ROWS]);
  return rows;
}

/** Document number for a movement row. */
function docNumber(tx) {
  if (tx.reference_id != null) {
    return `${tx.reference_type ? `${tx.reference_type}-` : ''}${tx.reference_id}`;
  }
  if (tx.reference_type) return tx.reference_type;
  return `MOV-${tx.movement_id}`;
}

/** "Received from / Issued to" — derived from the real movement type. */
function counterparty(tx) {
  switch (tx.movement_type) {
    case 'RESUPPLY': return tx.supplier_name || 'Supplier';
    case 'SALE': return 'Customer / POS';
    case 'RETURN': return 'Customer return';
    case 'DAMAGE': return 'Write-off (damage)';
    case 'EXPIRY': return 'Write-off (expiry)';
    case 'ADJUSTMENT': return 'Stock adjustment';
    case 'PHYSICAL_COUNT': return 'Physical count';
    default: return tx.reason || '—';
  }
}

/**
 * Build the formal, printable Bin Card for ONE medicine.
 * Balances use the authoritative stock_movements.new_stock column; a running
 * balance is reconstructed separately as a cross-check and any mismatch is
 * reported as a limitation rather than hidden.
 */
async function binCardReport({
  medicineId, from = null, to = null, batchId = null, movementType = null, generatedBy = null,
} = {}) {
  if (medicineId === undefined || medicineId === null || medicineId === '') {
    throw Object.assign(new Error('A medicine must be selected for a Bin Card.'), { status: 400 });
  }

  const medicine = await loadBinCardMedicine(medicineId);
  if (!medicine) throw Object.assign(new Error('Medicine not found.'), { status: 404 });

  const toExclusive = to ? isoDay(Date.parse(`${to}T00:00:00Z`) + DAY_MS) : null;
  const [amc, transactions] = await Promise.all([
    loadAmc(medicineId),
    loadBinCardTransactions({ medicineId, from, toExclusive, batchId, movementType }),
  ]);

  const truncated = transactions.length >= MAX_BIN_CARD_ROWS;
  const opening = transactions.length ? num(transactions[0].previous_stock) : num(medicine.total_stock);

  let ledger = 0;
  const rows = transactions.map((tx) => {
    ledger += num(tx.quantity);
    const isAdj = tx.movement_type === 'ADJUSTMENT' || tx.movement_type === 'PHYSICAL_COUNT';
    const receivedQty = num(tx.quantity) > 0 && !isAdj ? num(tx.quantity) : 0;
    const issuedQty = num(tx.quantity) < 0 && !isAdj ? Math.abs(num(tx.quantity)) : 0;
    const lossAdj = isAdj ? num(tx.quantity) : 0;
    const remarks = [tx.reason, tx.notes].filter(Boolean).join(' — ')
      || (tx.full_name || tx.username || '');
    return [
      dateOnly(tx.movement_date), docNumber(tx), label(tx.movement_type), counterparty(tx),
      receivedQty, issuedQty, lossAdj, num(tx.new_stock),
      tx.batch_number || '', dateOnly(tx.expiry_date), remarks,
    ];
  });

  const lastDbBalance = transactions.length ? num(transactions[transactions.length - 1].new_stock) : null;
  const reconstructed = opening + ledger;
  const reconciled = lastDbBalance === null || Math.abs(reconstructed - lastDbBalance) < 0.0001;

  const wb = newWorkbook();
  const sheet = wb.addWorksheet('Bin Card');

  const ident = [
    ['Product Name', medicine.generic_name],
    ['Brand', medicine.brand_name || '—'],
    ['Strength & Dosage Form', `${medicine.strength || ''} ${medicine.dosage_form || ''}`.trim() || '—'],
    ['Unit of Issue', medicine.base_unit],
    ['Maximum Stock Level', num(medicine.max_level) || '—'],
    ['Emergency Order Point', num(medicine.reorder_level) || '—'],
    ['Average Monthly Consumption (AMC)', `${amc} units / month`],
    ['Category', medicine.category_name || '—'],
    ['Current stock on hand', num(medicine.total_stock)],
    ['Medicine status', medicine.status || '—'],
    ['Filters applied', `Date ${from || 'all'} → ${to || 'all'}${batchId ? ` · batch ${batchId}` : ''}${movementType ? ` · ${movementType}` : ''}`],
    ['Generated', `${dateTime(new Date())} (by ${generatedBy || 'System'})`],
    [],
    ['Opening stock (before the first listed movement)', opening],
  ];

  sheet.getColumn(1).width = 46;
  sheet.getColumn(2).width = 60;
  for (const [key, value] of ident) {
    const row = sheet.addRow([key, value === undefined || value === null ? '' : value]);
    row.getCell(1).font = { bold: true };
  }
  sheet.getRow(1).font = TITLE_FONT;
  sheet.addRow([]);

  writeTable(sheet, {
    titleLines: [[`BIN CARD — ${medicine.generic_name}${medicine.brand_name ? ` (${medicine.brand_name})` : ''}`], []],
    headers: ['Date', 'Doc. No.', 'Receiving or Issuing', 'Received from or Issued to',
      'Received Qty', 'Issued Qty', 'Loss/Adj Qty', 'Balance', 'Batch No.', 'Expiry Date', 'Remarks'],
    widths: [12, 16, 20, 26, 12, 12, 12, 10, 16, 12, 40],
    rows,
  });

  const notes = [
    'Balance is the authoritative running balance recorded on each stock movement (stock_movements.new_stock).',
    reconciled
      ? `The reconstructed running balance (${reconstructed}) matches the last recorded balance (${lastDbBalance === null ? 'n/a' : lastDbBalance}).`
      : `LIMITATION: the reconstructed running balance (${reconstructed}) does not match the last recorded balance (${lastDbBalance}). This happens when filters exclude earlier movements or history is incomplete — trust the Balance column (database truth).`,
  ];
  if (truncated) notes.push(`Only the first ${MAX_BIN_CARD_ROWS} movements are included (dataset was larger).`);
  if (!transactions.length) notes.push('No stock movements matched these filters.');

  for (const note of notes) {
    const row = sheet.addRow(['•', note]);
    row.getCell(1).font = SUBTITLE_FONT;
  }

  const buffer = await wb.xlsx.writeBuffer();
  const slug = String(medicine.generic_name || 'medicine')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'medicine';

  return {
    buffer: Buffer.from(buffer),
    fileName: `bin_card_${slug}_${from || 'all'}_${to || 'all'}.xlsx`,
    rowCount: transactions.length,
    medicine,
    reconciled,
  };
}

/** Build a reporting period from explicit, inclusive from/to dates. */
function periodFromRange(from, to) {
  const start = dateOnly(from);
  const endInclusive = dateOnly(to);
  const endExclusive = isoDay(Date.parse(`${endInclusive}T00:00:00Z`) + DAY_MS);
  return { periodStart: start, periodEndExclusive: endExclusive, label: `${start} to ${endInclusive}` };
}

/**
 * Shared Bin Card data — used by the Excel, PDF and DOCX builders so all
 * three always contain the SAME rows, opening balance and limitations.
 *
 * Balances come from the authoritative stock_movements.new_stock column; a
 * running balance is reconstructed separately as a cross-check, and any
 * mismatch is reported as a limitation rather than hidden.
 */
async function getBinCardData({
  medicineId, from = null, to = null, batchId = null, movementType = null,
} = {}) {
  if (medicineId === undefined || medicineId === null || medicineId === '') {
    throw Object.assign(new Error('A medicine must be selected for a Bin Card.'), { status: 400 });
  }

  const medicine = await loadBinCardMedicine(medicineId);
  if (!medicine) throw Object.assign(new Error('Medicine not found.'), { status: 404 });

  const toExclusive = to ? isoDay(Date.parse(`${to}T00:00:00Z`) + DAY_MS) : null;
  const [amc, transactions] = await Promise.all([
    loadAmc(medicineId),
    loadBinCardTransactions({ medicineId, from, toExclusive, batchId, movementType }),
  ]);

  const truncated = transactions.length >= MAX_BIN_CARD_ROWS;
  const opening = transactions.length ? num(transactions[0].previous_stock) : num(medicine.total_stock);

  let ledger = 0;
  const rows = transactions.map((tx) => {
    ledger += num(tx.quantity);
    const isAdj = tx.movement_type === 'ADJUSTMENT' || tx.movement_type === 'PHYSICAL_COUNT';
    const receivedQty = num(tx.quantity) > 0 && !isAdj ? num(tx.quantity) : 0;
    const issuedQty = num(tx.quantity) < 0 && !isAdj ? Math.abs(num(tx.quantity)) : 0;
    const lossAdj = isAdj ? num(tx.quantity) : 0;
    const remarks = [tx.reason, tx.notes].filter(Boolean).join(' — ')
      || (tx.full_name || tx.username || '');
    return {
      date: dateOnly(tx.movement_date),
      docNo: docNumber(tx),
      receivingIssuing: label(tx.movement_type),
      counterparty: counterparty(tx),
      receivedQty,
      issuedQty,
      lossAdj,
      balance: num(tx.new_stock),
      batchNo: tx.batch_number || '',
      expiryDate: dateOnly(tx.expiry_date),
      remarks,
    };
  });

  const lastDbBalance = transactions.length ? num(transactions[transactions.length - 1].new_stock) : null;
  const reconstructed = opening + ledger;
  const reconciled = lastDbBalance === null || Math.abs(reconstructed - lastDbBalance) < 0.0001;

  return {
    medicine,
    amc,
    opening,
    rows,
    reconciled,
    reconstructed,
    lastDbBalance,
    truncated,
    hasHistory: transactions.length > 0,
    filters: `Date ${from || 'all'} → ${to || 'all'}${batchId ? ` · batch ${batchId}` : ''}${movementType ? ` · ${movementType}` : ''}`,
  };
}

/** Slug used for export filenames. */
function binCardSlug(medicine) {
  return String(medicine?.generic_name || 'medicine')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'medicine';
}

module.exports = {
  TZ,
  EXPIRY_WARNING_DAYS,
  resolvePeriod,
  periodFromRange,
  periodKey,
  inclusiveEnd,
  safeFileName,
  inventoryReport: buildInventoryReport,
  weeklyInventoryReport,
  monthlyInventoryReport,
  auditReport,
  binCardReport,
  getBinCardData,
  binCardSlug,
};
