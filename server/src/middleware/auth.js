const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'pharm_secret_jwt_key_2026';

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      ...decoded,
      user_id: decoded.user_id ?? decoded.id ?? decoded.userId ?? null,
      id: decoded.id ?? decoded.user_id ?? decoded.userId ?? null,
      role: decoded.role || 'USER',
      is_guest: decoded.role === 'GUEST',
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
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
    return res.status(403).json({
      error: 'Administrator authorization required.',
      code: 'ADMIN_REQUIRED',
    });
  }
  return next();
};

module.exports = { authenticate, requireStaff, enforceGuestReadOnly, requireAdmin };
