/*
 * Audit archive lifecycle.  This service intentionally touches audit_logs only;
 * stock, sales, batches and every other operational table are out of scope.
 */
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');
const db = require('../config/db');

const RETENTION_MONTHS = Math.max(1, Number(process.env.AUDIT_ARCHIVE_RETENTION_MONTHS || 2));
const DELETE_BATCH_SIZE = Math.min(10000, Math.max(100, Number(process.env.AUDIT_ARCHIVE_DELETE_BATCH_SIZE || 5000)));
const ARCHIVE_DIR = path.resolve(process.env.AUDIT_ARCHIVE_DIR || path.join(__dirname, '../../audit-archives'));
const LOCK_KEY = 'pharmacy_audit_archive_cleanup';

function archiveWindow(now = new Date()) {
  // Archive closed calendar months only; this avoids moving period boundaries
  // and makes the job idempotent. At least two full months remain live.
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - RETENTION_MONTHS, 1));
  const key = `before_${periodEnd.toISOString().slice(0, 7)}`;
  return { periodEnd, periodKey: key };
}

function stamp(date) { return date.toISOString().slice(0, 10); }
function safeCell(value) {
  if (value == null) return '';
  const string = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /^[=+\-@]/.test(string) ? `'${string}` : string;
}

async function writeWorkbook(rows, job, outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pharmacy Inventory System';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Audit Archive');
  sheet.addRow(['Audit Archive Report']);
  sheet.addRow(['Report Period From', job.period_start]);
  sheet.addRow(['Report Period To (exclusive)', job.period_end]);
  sheet.addRow(['Archive Generated', new Date()]);
  sheet.addRow(['Records Included', rows.length]);
  sheet.addRow(['Database', 'Production Pharmacy Database']);
  sheet.addRow(['Archive Status', 'Verified']);
  sheet.addRow([]);
  sheet.columns = [
    { header: 'Audit ID', key: 'audit_id', width: 13 }, { header: 'Timestamp', key: 'created_at', width: 22 },
    { header: 'User ID', key: 'user_id', width: 11 }, { header: 'User Name', key: 'full_name', width: 24 },
    { header: 'User Role', key: 'role', width: 14 }, { header: 'Session ID', key: 'session_id', width: 13 },
    { header: 'Guest/Authenticated', key: 'actor_type', width: 20 }, { header: 'Action', key: 'action', width: 22 },
    { header: 'Entity Type', key: 'entity_type', width: 18 }, { header: 'Entity ID', key: 'entity_id', width: 13 },
    { header: 'Description', key: 'description', width: 48 }, { header: 'IP Address', key: 'ip_address', width: 18 },
    { header: 'Result', key: 'status', width: 12 }, { header: 'Previous Value', key: 'old_values', width: 42 },
    { header: 'New Value', key: 'new_values', width: 42 },
  ];
  const headerRow = sheet.getRow(9);
  headerRow.values = sheet.columns.map((column) => column.header);
  headerRow.font = { bold: true };
  for (const row of rows) {
    sheet.addRow({
      ...row,
      actor_type: row.user_id ? 'Authenticated' : 'Guest/System',
      old_values: safeCell(row.old_values), new_values: safeCell(row.new_values),
      description: safeCell(row.description),
    });
  }
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.views = [{ state: 'frozen', ySplit: 9 }];
  await workbook.xlsx.writeFile(outputPath);

  // Re-open the file to verify the generated workbook, not merely its buffer.
  const check = new ExcelJS.Workbook();
  await check.xlsx.readFile(outputPath);
  const dataRows = check.getWorksheet('Audit Archive').actualRowCount - 9;
  if (dataRows !== rows.length) throw new Error(`Workbook row verification failed (${dataRows}/${rows.length})`);
}

async function archiveEligibleAuditLogs() {
  const client = await db.getClient();
  let locked = false;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [LOCK_KEY]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { skipped: true, reason: 'Another archive worker is running' };

    const { periodEnd, periodKey } = archiveWindow();
    const existing = await client.query('SELECT * FROM audit_archive_jobs WHERE period_key = $1', [periodKey]);
    let job = existing.rows[0];
    if (job?.status === 'DELETED') return { skipped: true, reason: 'Period already archived', job };

    if (!job) {
      const first = await client.query('SELECT MIN(created_at) AS period_start, COUNT(*)::int AS record_count FROM audit_logs WHERE created_at < $1 AND archive_job_id IS NULL', [periodEnd]);
      const count = first.rows[0]?.record_count || 0;
      if (!count) return { skipped: true, reason: 'No eligible audit records' };
      const inserted = await client.query(
        `INSERT INTO audit_archive_jobs (period_key, period_start, period_end, record_count, status)
         VALUES ($1, $2, $3, $4, 'GENERATING') RETURNING *`,
        [periodKey, first.rows[0].period_start, periodEnd, count]
      );
      job = inserted.rows[0];
    }

    if (job.status === 'GENERATING' || (job.status === 'FAILED' && !job.file_name)) {
      const rowsResult = await client.query(
        `SELECT al.*, u.full_name, u.role FROM audit_logs al LEFT JOIN users u ON u.user_id = al.user_id
         WHERE al.created_at < $1 AND al.archive_job_id IS NULL ORDER BY al.audit_id`, [periodEnd]
      );
      const rows = rowsResult.rows;
      if (!rows.length) throw new Error('No unarchived records available for this archive job');
      if (rows.length !== Number(job.record_count)) throw new Error('Eligible record count changed; retry next scheduled run');
      await fs.mkdir(ARCHIVE_DIR, { recursive: true, mode: 0o700 });
      const fileName = `pharmacy_audit_archive_${stamp(new Date(job.period_start))}_to_${stamp(new Date(job.period_end))}.xlsx`;
      const finalPath = path.join(ARCHIVE_DIR, fileName);
      const tempPath = `${finalPath}.tmp`;
      await writeWorkbook(rows, job, tempPath);
      const content = await fs.readFile(tempPath);
      if (!content.length) throw new Error('Generated archive file was empty');
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      await fs.rename(tempPath, finalPath);
      await client.query('UPDATE audit_archive_jobs SET file_name=$1, file_hash=$2, status=\'GENERATED\' WHERE archive_job_id=$3', [fileName, hash, job.archive_job_id]);
      await client.query('UPDATE audit_logs SET archive_job_id=$1 WHERE created_at < $2 AND archive_job_id IS NULL', [job.archive_job_id, periodEnd]);
      const marked = await client.query('SELECT COUNT(*)::int AS count FROM audit_logs WHERE archive_job_id=$1', [job.archive_job_id]);
      if (marked.rows[0].count !== rows.length) throw new Error('Database export verification failed');
      await client.query("UPDATE audit_archive_jobs SET status='VERIFIED', verified_at=NOW(), notification_status='READY' WHERE archive_job_id=$1", [job.archive_job_id]);
      job = (await client.query('SELECT * FROM audit_archive_jobs WHERE archive_job_id=$1', [job.archive_job_id])).rows[0];
    }

    if (job.status === 'FAILED' && job.file_name) job.status = 'GENERATED';
    // A crash after writing the file but before verification is recoverable:
    // validate the persisted file and its explicitly marked rows before delete.
    if (job.status === 'GENERATED') {
      const filePath = path.join(ARCHIVE_DIR, job.file_name || '');
      const content = await fs.readFile(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const marked = await client.query('SELECT COUNT(*)::int AS count FROM audit_logs WHERE archive_job_id=$1', [job.archive_job_id]);
      if (hash !== job.file_hash || marked.rows[0].count !== Number(job.record_count)) {
        throw new Error('Stored archive verification failed');
      }
      await client.query("UPDATE audit_archive_jobs SET status='VERIFIED', verified_at=NOW(), notification_status='READY' WHERE archive_job_id=$1", [job.archive_job_id]);
      job.status = 'VERIFIED';
    }

    if (job.status === 'VERIFIED') {
      let deleted = 0;
      while (true) {
        const result = await client.query(
          `DELETE FROM audit_logs WHERE audit_id IN (
             SELECT audit_id FROM audit_logs WHERE archive_job_id=$1 AND created_at < $2 LIMIT $3
           ) RETURNING audit_id`, [job.archive_job_id, periodEnd, DELETE_BATCH_SIZE]
        );
        deleted += result.rowCount;
        if (result.rowCount < DELETE_BATCH_SIZE) break;
      }
      await client.query("UPDATE audit_archive_jobs SET status='DELETED', deleted_at=NOW(), notification_status='READY' WHERE archive_job_id=$1", [job.archive_job_id]);
      // Normal VACUUM is deliberately left to PostgreSQL autovacuum: it cannot
      // run inside a transaction and VACUUM FULL is never automatic.
      return { success: true, deleted, jobId: job.archive_job_id };
    }
  } catch (error) {
    console.error('[AUDIT_ARCHIVE]', error.message);
    try { await client.query("UPDATE audit_archive_jobs SET status='FAILED', failure_reason=$1 WHERE period_key=$2 AND status <> 'DELETED'", [error.message, archiveWindow().periodKey]); } catch (_) {}
    return { success: false, error: error.message };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

async function getArchiveOverview() {
  const { periodEnd } = archiveWindow();
  const [eligible, jobs, databaseSize, largestTables] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS count FROM audit_logs WHERE created_at < $1 AND archive_job_id IS NULL', [periodEnd]),
    db.query('SELECT * FROM audit_archive_jobs ORDER BY created_at DESC LIMIT 24'),
    db.query('SELECT pg_database_size(current_database())::bigint AS bytes'),
    db.query(`SELECT relname AS name, pg_total_relation_size(oid)::bigint AS bytes
              FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
              ORDER BY pg_total_relation_size(oid) DESC LIMIT 5`),
  ]);
  const limitMb = Math.max(1, Number(process.env.DATABASE_STORAGE_LIMIT_MB || 500));
  const usedBytes = Number(databaseSize.rows[0]?.bytes || 0);
  return {
    retentionMonths: RETENTION_MONTHS, nextCutoff: periodEnd, eligibleRecords: eligible.rows[0].count, jobs: jobs.rows,
    storage: { estimated: true, limitMb, usedBytes, availableBytes: Math.max(0, limitMb * 1024 * 1024 - usedBytes), largestTables: largestTables.rows },
  };
}

function startAuditArchiveScheduler() {
  const runIfDue = () => {
    if (new Date().getUTCDate() === 1) archiveEligibleAuditLogs().catch((error) => console.error('[AUDIT_ARCHIVE]', error.message));
  };
  runIfDue();
  return setInterval(runIfDue, 12 * 60 * 60 * 1000);
}

module.exports = { archiveEligibleAuditLogs, getArchiveOverview, startAuditArchiveScheduler, ARCHIVE_DIR };
