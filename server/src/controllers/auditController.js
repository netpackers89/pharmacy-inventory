const db = require('../config/db');

/*
 * GET /api/audit-logs[?from&to&action&module&page&limit]
 *
 * Uses the REAL audit_logs columns (audit_id, created_at, module, …).
 * Date ranges are inclusive of the full "to" day (no midnight-boundary
 * data loss). An empty table returns a successful empty dataset — never 500.
 */
exports.getAuditLogs = async (req, res) => {
  try {
    const {
      from,
      to,
      action,
      module,
      status,
      page = '1',
      limit = '50',
    } = req.query;

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

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM audit_logs al ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.total || 0, 10);

    params.push(limitNum, offset);
    const result = await db.query(`
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
      ${where}
      ORDER BY al.created_at DESC, al.audit_id DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, params);

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
