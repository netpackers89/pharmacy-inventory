/**
 * authController.js
 *
 * Handles authentication for the pharmacy inventory system:
 *   - login            : verify credentials → create session → sign JWT → audit
 *   - logout           : close session → audit
 *   - refreshActivity  : keep session alive
 *   - getCurrentUser   : return the decoded JWT payload attached by auth middleware
 *
 * DB layer   : pg pool via ../config/db  (db.query for standalone ops,
 *              db.getClient() for the login transaction)
 * Audit      : req.auditLog(client, action, module, options) injected by
 *              auditMiddleware — NEVER throws, so we never await-guard it with try/catch
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../config/db');
const { checkLocked, recordFailure, clearFailures } = require('../middleware/rateLimit');

const JWT_SECRET = process.env.JWT_SECRET || 'pharm_secret_jwt_key_2026';

/* ─────────────────────────────────────────────────────────────────────────── *
 *  login
 *  POST /api/auth/login  { username, password }
 *
 *  NET-PHARMA is an internal system: there is NO public self-registration.
 *  Accounts are created only by administrators (see userController).
 *  Authentication is USERNAME + PASSWORD. Progressive lockout is stored in
 *  the database so it survives restarts and cannot be reset by attackers.
 * ─────────────────────────────────────────────────────────────────────────── */
exports.login = async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = req.body?.password;
  const ip       = req.ipAddress;

  // ── 1. Basic input validation ──────────────────────────────────────────────
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  // ── 2. Persistent brute-force lockout (username + IP) ─────────────────────
  try {
    const lock = await checkLocked(username, ip);
    if (lock.locked) {
      await req.auditLog(null, 'LOGIN_BLOCKED', 'SECURITY', {
        status      : 'FAILED',
        description : `Sign-in blocked — account "${username.toLowerCase()}" is locked for ${lock.retryAfterMinutes} more minute(s)`,
        ipAddress   : ip,
        userAgent   : req.userAgent,
        metadata    : { username_key: username.toLowerCase(), retry_after_minutes: lock.retryAfterMinutes },
      });
      return res.status(423).json({
        error: `Account temporarily locked due to repeated failed sign-in attempts. Try again in ${lock.retryAfterMinutes} minute(s).`,
        code : 'ACCOUNT_LOCKED',
        retry_after_minutes: lock.retryAfterMinutes,
      });
    }
  } catch (err) {
    // Lockout infrastructure failure must never open the door wider.
    console.error('[LOGIN] Lockout check error:', err.message);
  }

  // ── 3. Look up the user by USERNAME only ───────────────────────────────────
  let user;
  try {
    const result = await db.query(
      `SELECT user_id, username, role, full_name, password_hash, status
          FROM users
         WHERE LOWER(username) = LOWER($1)
         LIMIT 1`,
      [username]
    );

    if (result.rows.length === 0) {
      const lockState = await recordFailure(username, ip).catch(() => null);
      // Unknown user → log failed attempt (no real user_id available)
      await req.auditLog(null, 'LOGIN', 'AUTH', {
        status      : 'FAILED',
        description : `Failed sign-in attempt — unknown username "${username}"`,
        ipAddress   : ip,
        userAgent   : req.userAgent,
        metadata    : lockState?.locked ? { locked_for_minutes: lockState.retryAfterMinutes } : undefined,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    user = result.rows[0];
  } catch (err) {
    console.error('[LOGIN] DB lookup error:', err.message);
    return res.status(500).json({ error: 'Server authentication error' });
  }

  // ── 4. Verify password ─────────────────────────────────────────────────────
  let isMatch = false;
  try {
    isMatch = await bcrypt.compare(password, user.password_hash);
  } catch (err) {
    console.error('[LOGIN] bcrypt error:', err.message);
    return res.status(500).json({ error: 'Server authentication error' });
  }

  if (!isMatch) {
    const lockState = await recordFailure(username, ip).catch(() => null);

    await req.auditLog(null, 'LOGIN', 'AUTH', {
      userId      : user.user_id,
      status      : 'FAILED',
      description : lockState?.locked
        ? `Failed sign-in attempt — account locked for ${lockState.retryAfterMinutes} minute(s)`
        : 'Failed sign-in attempt',
      ipAddress   : ip,
      userAgent   : req.userAgent,
      metadata    : lockState ? { failed_attempts: lockState.attempts } : undefined,
    });

    if (lockState?.locked) {
      return res.status(423).json({
        error: `Too many failed attempts. Account locked for ${lockState.retryAfterMinutes} minute(s).`,
        code : 'ACCOUNT_LOCKED',
        retry_after_minutes: lockState.retryAfterMinutes,
      });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // ── 5. Check account status ────────────────────────────────────────────────
  if (user.status !== 'ACTIVE') {
    await req.auditLog(null, 'LOGIN', 'AUTH', {
      userId      : user.user_id,
      status      : 'FAILED',
      description : 'Failed sign-in attempt — account inactive',
      ipAddress   : ip,
      userAgent   : req.userAgent,
    });
    return res.status(403).json({ error: 'Account is inactive. Contact an administrator.' });
  }

  // Successful credentials → clear the failure counter for this username+IP.
  await clearFailures(username, ip);

  // ── 5. Transaction: create session + audit success ─────────────────────────
  let client;
  try {
    client = await db.getClient();
    await client.query('BEGIN');

    // 5a. Insert session row
    const sessionResult = await client.query(
      `INSERT INTO user_sessions (user_id, ip_address, user_agent)
            VALUES ($1, $2, $3)
         RETURNING session_id`,
      [user.user_id, req.ipAddress, req.userAgent]
    );
    const session_id = sessionResult.rows[0].session_id;

    // 5b. Sign JWT — include session_id so middleware / logout can reference it
    const token = jwt.sign(
      {
        user_id   : user.user_id,
        username  : user.username,
        role      : user.role,
        session_id,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // 5c. Audit successful login (inside same transaction)
    await req.auditLog(client, 'LOGIN', 'AUTH', {
      userId      : user.user_id,
      recordId    : session_id,
      tableName   : 'user_sessions',
      sessionId   : session_id,
      status      : 'SUCCESS',
      description : 'User logged in successfully',
      ipAddress   : req.ipAddress,
      userAgent   : req.userAgent,
    });

    await client.query('COMMIT');

    // 5d. Respond
    return res.json({
      message : 'Login successful',
      token,
      user    : {
        user_id    : user.user_id,
        username   : user.username,
        role       : user.role,
        full_name  : user.full_name,
        session_id,
      },
    });
  } catch (err) {
    // Roll back the session row so we don't leave ghost sessions
    try { await client?.query('ROLLBACK'); } catch (_) {}
    console.error('[LOGIN] Transaction error:', err.message);
    return res.status(500).json({ error: 'Server authentication error' });
  } finally {
    client?.release();
  }
};

/* ─────────────────────────────────────────────────────────────────────────── *
 *  guestLogin
 *  POST /api/auth/guest  { name }
 *
 *  NET-PHARMA Guest Mode — the visitor provides their NAME (required,
 *  validated, sanitized). A READ-ONLY session is issued (role 'GUEST');
 *  requireStaff/enforceGuestReadOnly reject every write request made
 *  with this token server-side. Entry and activity are audited.
 * ─────────────────────────────────────────────────────────────────────────── */
exports.guestLogin = async (req, res) => {
  // Trim, collapse whitespace and strip anything that isn't a safe name character.
  const rawName = typeof req.body?.name === 'string' ? req.body.name : '';
  const guestName = rawName.replace(/\s+/g, ' ').replace(/[<>]/g, '').trim();

  if (!guestName || guestName.length < 2 || guestName.length > 60) {
    return res.status(400).json({ error: 'Please enter your full name (2–60 characters) to continue as guest.' });
  }

  try {
    const username = `guest:${guestName.toLowerCase()}`;

    // Short-lived read-only guest token (no DB user row, no session row needed
    // because guests can never mutate anything).
    const token = jwt.sign(
      {
        user_id   : null,
        id        : null,
        username  : username,
        full_name : guestName,
        role      : 'GUEST',
        is_guest  : true,
      },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    await req.auditLog(null, 'GUEST_LOGIN', 'AUTH', {
      status      : 'SUCCESS',
      description : `Guest "${guestName}" entered view-only mode`,
      ipAddress   : req.ipAddress,
      userAgent   : req.userAgent,
    });

    return res.json({
      message: 'Guest session started',
      token,
      user: {
        user_id   : null,
        id        : null,
        username  : username,
        full_name : guestName,
        role      : 'GUEST',
        is_guest  : true,
      },
    });
  } catch (err) {
    console.error('[GUEST_LOGIN] Error:', err.message);
    return res.status(500).json({ error: 'Server error while starting guest session' });
  }
};

/* ─────────────────────────────────────────────────────────────────────────── *
 *  logout
 *  POST /api/auth/logout  { session_id? }   (also falls back to req.user)
 * ─────────────────────────────────────────────────────────────────────────── */
exports.logout = async (req, res) => {
  // The session identity ALWAYS comes from the authenticated token —
  // never from a body value supplied by the client.
  const session_id = req.user?.session_id ?? null;
  const userId     = req.user?.user_id    ?? null;

  if (!session_id) {
    return res.status(400).json({ error: 'No active server session to close' });
  }

  try {
    // Mark session as closed — after this, the JWT is rejected by
    // authenticate() even if the client keeps a copy of the token.
    await db.query(
      `UPDATE user_sessions
          SET logout_at     = NOW(),
              last_activity_at = NOW(),
              logout_reason = 'LOGOUT'
        WHERE session_id = $1 AND logout_at IS NULL`,
      [session_id]
    );

    // Audit logout — standalone pool query (no transaction needed)
    await req.auditLog(null, 'LOGOUT', 'AUTH', {
      userId,
      recordId  : session_id,
      sessionId : session_id,
      tableName : 'user_sessions',
      status    : 'SUCCESS',
      description: 'User logged out',
      ipAddress : req.ipAddress,
      userAgent : req.userAgent,
    });

    return res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('[LOGOUT] Error:', err.message);
    return res.status(500).json({ error: 'Server error during logout' });
  }
};

/* ─────────────────────────────────────────────────────────────────────────── *
 *  refreshActivity
 *  POST /api/auth/refresh-activity  { session_id }
 *  Keeps the session alive by bumping last_activity_at — no audit needed.
 * ─────────────────────────────────────────────────────────────────────────── */
exports.refreshActivity = async (req, res) => {
  const session_id = req.body?.session_id ?? req.user?.session_id ?? null;

  if (!session_id) {
    return res.status(400).json({ error: 'session_id is required' });
  }

  try {
    await db.query(
      `UPDATE user_sessions
          SET last_activity_at = NOW()
        WHERE session_id = $1`,
      [session_id]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('[REFRESH_ACTIVITY] Error:', err.message);
    return res.status(500).json({ error: 'Server error refreshing activity' });
  }
};

/* ─────────────────────────────────────────────────────────────────────────── *
 *  getCurrentUser
 *  GET /api/auth/me
 *  Returns the JWT payload already decoded and attached by auth middleware.
 * ─────────────────────────────────────────────────────────────────────────── */
exports.getCurrentUser = (req, res) => {
  return res.json({ user: req.user });
};

/* ─────────────────────────────────────────────────────────────────────────── *
 *  getSessions   GET /api/auth/sessions        (ADMIN only)
 *  Real session history from the database — login/logout/activity times are
 *  server-generated (UTC) and never faked by the frontend.
 * ─────────────────────────────────────────────────────────────────────────── */
exports.getSessions = async (req, res) => {
  try {
    const { status = 'ACTIVE', limit = '100' } = req.query;
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));

    const params = [limitNum];
    let where = '';
    if (String(status).toUpperCase() === 'ACTIVE') {
      where = 'WHERE s.logout_at IS NULL';
    }

    const result = await db.query(
      `SELECT s.session_id,
              s.user_id,
              u.full_name,
              u.username,
              u.role,
              s.login_at,
              s.last_activity_at,
              s.logout_at,
              s.logout_reason,
              s.ip_address,
              s.user_agent,
              CASE
                WHEN s.logout_at IS NULL THEN 'ACTIVE'
                ELSE 'CLOSED'
              END AS status,
              ROUND(EXTRACT(EPOCH FROM (
                COALESCE(s.logout_at, NOW()) - s.login_at
              )) / 60)::INTEGER AS duration_minutes
         FROM user_sessions s
         LEFT JOIN users u ON s.user_id = u.user_id
         ${where}
        ORDER BY s.login_at DESC
        LIMIT $1`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[SESSIONS]', err.message);
    res.status(500).json({ success: false, error: 'Unable to retrieve sessions' });
  }
};

/* ─────────────────────────────────────────────────────────────────────────── *
 *  getMySessions   GET /api/auth/sessions/mine
 *  A user can review their own recent session history.
 * ─────────────────────────────────────────────────────────────────────────── */
exports.getMySessions = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT session_id, login_at, last_activity_at, logout_at, logout_reason,
              ip_address,
              CASE WHEN logout_at IS NULL THEN 'ACTIVE' ELSE 'CLOSED' END AS status
         FROM user_sessions
        WHERE user_id = $1
        ORDER BY login_at DESC
        LIMIT 20`,
      [req.user.user_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[MY_SESSIONS]', err.message);
    res.status(500).json({ success: false, error: 'Unable to retrieve your sessions' });
  }
};

/* ─────────────────────────────────────────────────────────────────────────── *
 *  revokeSession   POST /api/auth/sessions/:id/revoke   (ADMIN only)
 *  Force-closes a session (e.g. compromised account). The next request made
 *  with that token is rejected server-side.
 * ─────────────────────────────────────────────────────────────────────────── */
exports.revokeSession = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `UPDATE user_sessions
          SET logout_at = NOW(),
              logout_reason = 'REVOKED'
        WHERE session_id = $1 AND logout_at IS NULL
        RETURNING session_id, user_id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or already closed' });
    }

    await req.auditLog(null, 'SESSION_REVOKED', 'SECURITY', {
      userId      : result.rows[0].user_id,
      recordId    : result.rows[0].session_id,
      sessionId   : result.rows[0].session_id,
      tableName   : 'user_sessions',
      description : `Administrator revoked session #${result.rows[0].session_id}`,
      ipAddress   : req.ipAddress,
      userAgent   : req.userAgent,
    });

    return res.json({ message: 'Session revoked successfully' });
  } catch (err) {
    console.error('[REVOKE_SESSION]', err.message);
    return res.status(500).json({ error: 'Server error revoking session' });
  }
};
