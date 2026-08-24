/**
 * Audit Middleware
 * Injects `req.auditLog(action, module, options)` into every request.
 * All audit records are written by the backend — the frontend never touches audit_logs.
 */

const db = require('../config/db');

/**
 * Build an audit record and insert it.
 * All params are optional except action & module — safe to call from any controller.
 */
async function insertAudit(client, {
  userId,
  action,
  module,
  tableName,
  recordId,
  entityType,
  entityId,
  description,
  oldValues,
  newValues,
  metadata,
  ipAddress,
  userAgent,
  sessionId,
  status = 'SUCCESS',
}) {
  try {
    const query = `
      INSERT INTO audit_logs (
        user_id, action, module, table_name, record_id,
        entity_type, entity_id, description,
        old_values, new_values, metadata,
        ip_address, user_agent, session_id, status
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,
        $12,$13,$14,$15
      )
    `;
    const values = [
      userId || null,
      action,
      module || null,
      tableName || null,
      recordId || null,
      entityType || null,
      entityId || null,
      description || null,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      metadata ? JSON.stringify(metadata) : null,
      ipAddress || null,
      userAgent || null,
      sessionId || null,
      status,
    ];
    // Accept either a pg client (for transactions) or fall back to the pool
    if (client && typeof client.query === 'function') {
      await client.query(query, values);
    } else {
      await db.query(query, values);
    }
  } catch (err) {
    // Never throw from audit — log & continue
    console.error('[AUDIT ERROR]', err.message);
  }
}

/**
 * Express middleware that attaches req.auditLog() and extracts IP / UA.
 */
function auditMiddleware(req, _res, next) {
  req.ipAddress =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    null;
  req.userAgent = req.headers['user-agent'] || null;

  /**
   * req.auditLog(client, action, module, options)
   *   client  — pg client (pass inside a transaction) or null to use pool
   *   action  — e.g. 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'SALE', ...
   *   module  — e.g. 'MEDICINES', 'POS', 'AUTH', 'INVENTORY', ...
   *   options — { tableName, recordId, entityType, entityId, description,
   *               oldValues, newValues, metadata, status, sessionId }
   */
  req.auditLog = (client, action, module, options = {}) => {
    const userId =
      options.userId ?? req.user?.user_id ?? req.body?.user_id ?? null;
    return insertAudit(client, {
      userId,
      action,
      module,
      tableName: options.tableName,
      recordId: options.recordId,
      entityType: options.entityType,
      entityId: options.entityId,
      description: options.description,
      oldValues: options.oldValues,
      newValues: options.newValues,
      metadata: options.metadata,
      ipAddress: options.ipAddress ?? req.ipAddress,
      userAgent: options.userAgent ?? req.userAgent,
      sessionId: options.sessionId ?? req.sessionId,
      status: options.status ?? 'SUCCESS',
    });
  };

  next();
}

module.exports = { auditMiddleware, insertAudit };
