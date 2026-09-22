const db = require('../config/db');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { getArchiveOverview, ARCHIVE_DIR } = require('../services/auditArchiveService');

/*
 * Shared filter builder — the list endpoint and the CSV export use EXACTLY
 * the same filtering logic, so an exported file always matches what the
 * admin sees on screen.
 */
function buildFilters({ from, to, action, module, status, user }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (from) {
    conditions.push(`al.created_at >= $${idx++}::date`);
    params.push(String(from));
  }
  if (to) {
    // Include the entire "to" day: < to + 1 day (midnight boundary safe)
    conditions.push(`al.created_at < ($${idx++}::date + INTERVAL '1 day')`);
    params.push(String(to));
  }
  if (action) { conditions.push(`al.action = $${idx++}`); params.push(String(action).toUpperCase()); }
  if (module) { conditions.push(`al.module = $${idx++}`); params.push(String(module).toUpperCase()); }
  if (status) { conditions.push(`al.status = $${idx++}`); params.push(String(status).toUpperCase()); }
  if (user) {
    conditions.push(`(u.full_name ILIKE $${idx} OR u.username ILIKE $${idx})`);
    params.push(`%${String(user)}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

const BASE_SELECT = `
  SELECT
    al.audit_id                    AS id,
    al.user_id,
    al.action,
    al.module,
    al.table_name                  AS entity_type,
    al.record_id                   AS entity_id,
    al.description,
    al.status,
    al.ip_address,
    al.created_at                  AS timestamp,
    u.username,
    u.full_name
  FROM audit_logs al
  LEFT JOIN users u ON al.user_id = u.user_id
`;

/*
 * GET /api/audit-logs[?from&to&action&module&status&user&page&limit]
 *
 * ADMIN-ONLY (enforced in auditRoutes). Uses the REAL audit_logs columns.
 * An empty table returns a successful empty dataset — never 500.
 */
exports.getAuditLogs = async (req, res) => {
  try {
    const {
      from,
      to,
      action,
      module,
      status,
      user,
      page = '1',
      limit = '50',
    } = req.query;

    const { where, params } = buildFilters({ from, to, action, module, status, user });

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const countResult = await db.query(
      `SELECT COUNT(*) AS total
         FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.user_id
         ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.total || 0, 10);

    const result = await db.query(`
      ${BASE_SELECT}
      ${where}
      ORDER BY al.created_at DESC, al.audit_id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limitNum, offset]);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error('[AUDIT_LOGS]', err.message);
    // Structured empty failure — clients can still render gracefully.
    res.status(500).json({
      success: false,
      error: 'Unable to retrieve audit logs',
      data: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    });
  }
};

/*
 * GET /api/audit-logs/export[?from&to&action&module&status&user]
 *
 * ADMIN-ONLY. Streams a CSV of the FILTERED dataset (same filters as the
 * table view). Timestamps are exported in ISO-8601 UTC — the source of
 * truth — so spreadsheets can convert to any local timezone.
 */
exports.exportAuditLogs = async (req, res) => {
  try {
    const { from, to, action, module, status, user } = req.query;
    const { where, params } = buildFilters({ from, to, action, module, status, user });

    const result = await db.query(`
      ${BASE_SELECT}
      ${where}
      ORDER BY al.created_at DESC, al.audit_id DESC
      LIMIT 50000
    `, params);

    const esc = (value) => {
      const s = value == null ? '' : String(value);
      // Guard against CSV injection in spreadsheet applications.
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };

    const header = 'Audit ID,Timestamp (UTC),User,Username,Action,Module,Record Type,Record ID,Description,Result,IP Address';
    const lines = result.rows.map((row) => [
      row.id,
      row.timestamp ? new Date(row.timestamp).toISOString() : '',
      row.full_name || '',
      row.username || '',
      row.action || '',
      row.module || '',
      row.entity_type || '',
      row.entity_id ?? '',
      row.description || '',
      row.status || '',
      row.ip_address || '',
    ].map(esc).join(','));

    const csv = '\uFEFF' + header + '\n' + lines.join('\n');

    await req.auditLog(null, 'AUDIT_EXPORTED', 'SECURITY', {
      description: `Administrator exported ${result.rows.length} audit record(s)` +
        (where ? ' (filtered)' : ''),
      metadata: { filters: { from, to, action, module, status, user }, rows: result.rows.length },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${stamp}.csv"`);
    return res.send(csv);
  } catch (err) {
    console.error('[AUDIT_EXPORT]', err.message);
    res.status(500).json({ success: false, error: 'Unable to export audit logs' });
  }
};

/*
 * GET /api/audit-logs/meta/actions
 * Distinct action/module values for building filter dropdowns.
 */
exports.getAuditMeta = async (_req, res) => {
  try {
    const actions = await db.query(`SELECT DISTINCT action FROM audit_logs ORDER BY action`);
    const modules = await db.query(`SELECT DISTINCT module FROM audit_logs WHERE module IS NOT NULL ORDER BY module`);
    res.json({
      success: true,
      actions: actions.rows.map((r) => r.action).filter(Boolean),
      modules: modules.rows.map((r) => r.module).filter(Boolean),
    });
  } catch (err) {
    console.error('[AUDIT_META]', err.message);
    res.json({ success: false, actions: [], modules: [] });
  }
};

// Archive metadata and preview are ADMIN-only at the route layer. They expose
// no file paths and never trigger deletion from a web request.
exports.getArchiveOverview = async (_req, res) => {
  try { return res.json({ success: true, ...(await getArchiveOverview()) }); }
  catch (err) {
    console.error('[AUDIT_ARCHIVE_OVERVIEW]', err.message);
    return res.status(500).json({ success: false, error: 'Unable to load audit archive status' });
  }
};

exports.downloadArchive = async (req, res) => {
  try {
    const job = await db.query(
      "SELECT archive_job_id, file_name, file_hash, status FROM audit_archive_jobs WHERE archive_job_id=$1 AND status IN ('VERIFIED','DELETED')",
      [req.params.id]
    );
    const record = job.rows[0];
    if (!record?.file_name || path.basename(record.file_name) !== record.file_name) return res.status(404).json({ error: 'Archive not available' });
    const filePath = path.join(ARCHIVE_DIR, record.file_name);
    const bytes = await fs.readFile(filePath);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (hash !== record.file_hash) return res.status(409).json({ error: 'Archive verification failed; download is disabled' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${record.file_name}"`);
    return res.send(bytes);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Archive file is unavailable' });
    console.error('[AUDIT_ARCHIVE_DOWNLOAD]', err.message);
    return res.status(500).json({ error: 'Unable to download archive' });
  }
};
