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
 *  POST /api/auth/login  { username, password }
 * ─────────────────────────────────────────────────────────────────────────── */
exports.login = async (req, res) => {
  const { username, password } = req.body;

  // ── 1. Basic input validation ──────────────────────────────────────────────
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  // ── 2. Look up the user ────────────────────────────────────────────────────
  let user;
  try {
    const result = await db.query(
      `SELECT user_id, username, role, full_name, password_hash, status
         FROM users
        WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      // Unknown user → log failed attempt (no real user_id available)
      await req.auditLog(null, 'LOGIN', 'AUTH', {
        status      : 'FAILED',
        description : 'Failed login attempt — user not found',
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


/* ─────────────────────────────────────────────────────────────────────────── *
 *  signup
 *  POST /api/auth/signup  { username, password, full_name, role }
 * ─────────────────────────────────────────────────────────────────────────── */
exports.signup = async (req, res) => {
  const { username, password, full_name, role = 'USER' } = req.body;

  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'Username, password, and full name are required' });
  }

  try {
    // Check if user already exists
    const existingUser = await db.query(
      `SELECT user_id FROM users WHERE username = $1`,
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert new user
    const newUser = await db.query(
      `INSERT INTO users (username, password_hash, full_name, role, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')
       RETURNING user_id, username, role, full_name`,
      [username, passwordHash, full_name, role]
    );

    return res.status(201).json({
      message: 'User registered successfully',
      user: newUser.rows[0],
    });
  } catch (err) {
    console.error('[SIGNUP] Error:', err.message);
    return res.status(500).json({ error: 'Server error during registration' });
  }
};