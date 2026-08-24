const db = require('../config/db');

exports.getAuditLogs = async (req, res) => {
  try {
    const { from, to, action, entity_type, limit = 200 } = req.query;
    let conditions = [];
    const params = [];
    let idx = 1;

    if (from && to) {
      conditions.push(`al.timestamp BETWEEN $${idx++} AND $${idx++}`);
      params.push(from, to + ' 23:59:59');
    }
    if (action) {
      conditions.push(`al.action = $${idx++}`);
      params.push(action);
    }
    if (entity_type) {
      conditions.push(`al.entity_type = $${idx++}`);
      params.push(entity_type);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(parseInt(limit));

    const result = await db.query(`
      SELECT 
        COALESCE(al.audit_id, al.id) AS id,
        al.action,
        COALESCE(al.entity_type, al.table_name) AS entity_type,
        COALESCE(al.entity_id, al.record_id) AS entity_id,
        COALESCE(al.description, al.new_values::text) AS description,
        al.old_value,
        al.new_value,
        COALESCE(al.created_at, al.timestamp) AS timestamp,
        u.username,
        u.full_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.user_id
      ${where}
      ORDER BY COALESCE(al.created_at, al.timestamp) DESC
      LIMIT $${idx}
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};
