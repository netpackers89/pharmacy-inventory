const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { insertAudit } = require('./auditMiddleware');

const JWT_SECRET = process.env.JWT_SECRET || 'pharm_secret_jwt_key_2026';

if (!process.env.JWT_SECRET) {
  console.warn('[SECURITY] JWT_SECRET is not set - using a development default. Set JWT_SECRET in production!');
}

/*
 * authenticate
 *
 * Verifies the JWT AND validates the server-side session:
 *   - a logged-out / revoked session invalidates the token immediately,
 *     so clearing localStorage on the client is never the only logout;
 *   - last_activity_at is bumped so inactivity can be reported accurately.
 * Guest tokens (no session row) skip the session check but remain read-only.
 */
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = {
    ...decoded,
    user_id: decoded.user_id ?? decoded.id ?? decoded.userId ?? null,
    id: decoded.id ?? decoded.user_id ?? decoded.userId ?? null,
    role: decoded.role || 'USER',
    is_guest: decoded.role === 'GUEST',
  };

  // Real accounts must have an open session. Revoked/closed sessions reject
  // the token here - the database is the source of truth, not React.
  if (!user.is_guest && user.session_id) {
    try {
      const result = await db.query(
        `SELECT session_id FROM user_sessions
          WHERE session_id = $1 AND user_id = $2 AND logout_at IS NULL
          LIMIT 1`,
        [user.session_id, user.user_id]
      );
      if (result.rows.length === 0) {
        return res.status(401).json({
          error: 'Session ended. Please sign in again.',
          code: 'SESSION_ENDED',
        });
      }
      // Keep activity fresh (cheap PK update; enables accurate reporting).
      db.query(
        `UPDATE user_sessions SET last_activity_at = NOW() WHERE session_id = $1`,
        [user.session_id]
      ).catch(() => {});
    } catch (err) {
      console.error('[AUTH] Session validation error:', err.message);
      return res.status(500).json({ error: 'Server authentication error' });
    }
  }

  req.user = user;
  req.sessionId = user.session_id ?? null;
  return next();
};

/*
 * requireStaff
 *
 * Server-side Guest Mode enforcement.
 * Guests (role === 'GUEST') may only perform read operations (GET).
 * Every mutating method is rejected with 403 before hitting controllers,
 * so hiding buttons in the UI is never the only line of defence.
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const requireStaff = (req, res, next) => {
  if (!WRITE_METHODS.has(req.method)) return next();

  if (req.user && req.user.role === 'GUEST') {
    return res.status(403).json({
      error: 'Guest accounts are read-only. Sign in with a pharmacy account to make changes.',
      code: 'GUEST_READ_ONLY',
    });
  }

  return next();
};

/*
 * enforceGuestReadOnly
 *
 * Global guard mounted before every API route.
 * Reads the Bearer token directly and blocks mutating requests
 * issued by guest sessions — even on routes that don't use
 * authenticate/requireStaff explicitly.
 */
const enforceGuestReadOnly = (req, res, next) => {
  if (!WRITE_METHODS.has(req.method)) return next();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === 'GUEST') {
      return res.status(403).json({
        error: 'This action is unavailable in Guest Mode. Sign in with a pharmacy account to make changes.',
        code: 'GUEST_READ_ONLY',
      });
    }
  } catch (_) {
    // Invalid/expired tokens are handled later by authenticate().
  }

  return next();
};

/*
 * requireAdmin
 *
 * Administrator-only guard. Must run AFTER authenticate().
 * Blocks guests, pharmacists, staff and unauthenticated users from
 * administrative operations (user management, system data, settings).
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    // Security event: a non-admin attempted an administrative operation.
    insertAudit(null, {
      action: 'AUTHZ_DENIED',
      module: 'SECURITY',
      userId: req.user?.user_id ?? null,
      description: `Authorization denied: ${req.method} ${req.originalUrl} requires ADMIN role`,
      ipAddress: req.ipAddress,
      userAgent: req.userAgent,
      sessionId: req.sessionId,
      status: 'FAILED',
      metadata: { role: req.user?.role || 'ANONYMOUS', path: req.originalUrl },
    }).catch(() => {});

    return res.status(403).json({
      error: 'Administrator authorization required.',
      code: 'ADMIN_REQUIRED',
    });
  }
  return next();
};

module.exports = { authenticate, requireStaff, enforceGuestReadOnly, requireAdmin };
