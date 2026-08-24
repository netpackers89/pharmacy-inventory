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

const JWT_SECRET = process.env.JWT_SECRET || 'pharm_secret_jwt_key_2026';

/* ─────────────────────────────────────────────────────────────────────────── *
 *  login
 *  POST /api/auth/login  { username (email or username), password }
 *
 *  NET-PHARMA is an internal system: there is NO public self-registration.
 *  Accounts are created only by administrators (see userController).
 * ─────────────────────────────────────────────────────────────────────────── */
exports.login = async (req, res) => {
  const rawIdentifier = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = req.body?.password;

  // ── 1. Basic input validation ──────────────────────────────────────────────
  if (!rawIdentifier || !password) {
    return res.status(400).json({ error: 'Email/username and password are required' });
  }

  // ── 2. Look up the user (identifier may be a username or email-style name) ─
  let user;
  try {
    const result = await db.query(
      `SELECT user_id, username, role, full_name, password_hash, status
          FROM users
         WHERE username = $1 OR LOWER(username) = LOWER($1)
         LIMIT 1`,
      [rawIdentifier]
    );

    if (result.rows.length === 0) {
      // Unknown user → log failed attempt (no real user_id available)
      await req.auditLog(null, 'LOGIN', 'AUTH', {
        status      : 'FAILED',
        description : `Failed login attempt — account not found for "${rawIdentifier}"`,
        ipAddress   : req.ipAddress,
        userAgent   : req.userAgent,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    user = result.rows[0];
  } catch (err) {
    console.error('[LOGIN] DB lookup error:', err.message);
    return res.status(500).json({ error: 'Server authentication error' });
  }

  // ── 3. Verify password ─────────────────────────────────────────────────────
  let isMatch = false;
  try {
    isMatch = await bcrypt.compare(password, user.password_hash);
  } catch (err) {
    console.error('[LOGIN] bcrypt error:', err.message);
    return res.status(500).json({ error: 'Server authentication error' });
  }

  if (!isMatch) {
    // Wrong password → audit failed attempt then reject
    await req.auditLog(null, 'LOGIN', 'AUTH', {
      userId      : user.user_id,
      status      : 'FAILED',
      description : 'Failed login attempt',
      ipAddress   : req.ipAddress,
      userAgent   : req.userAgent,
    });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // ── 4. Check account status ────────────────────────────────────────────────
  if (user.status !== 'ACTIVE') {
    await req.auditLog(null, 'LOGIN', 'AUTH', {
      userId      : user.user_id,
      status      : 'FAILED',
      description : 'Failed login attempt — account inactive',
      ipAddress   : req.ipAddress,
      userAgent   : req.userAgent,
    });
    return res.status(403).json({ error: 'Account is inactive. Contact an administrator.' });
  }

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
  // Accept session_id from body or from the decoded JWT (set by auth middleware)
  const session_id = req.body?.session_id ?? req.user?.session_id ?? null;
  const userId     = req.user?.user_id    ?? req.body?.user_id    ?? null;

  if (!session_id) {
    return res.status(400).json({ error: 'session_id is required' });
  }

  try {
    // Mark session as closed
    await db.query(
      `UPDATE user_sessions
          SET logout_at     = NOW(),
              logout_reason = 'LOGOUT'
        WHERE session_id = $1`,
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
