/**
 * rateLimit.js
 *
 * Server-side protection layers:
 *
 * 1. apiLimiter / authLimiter - in-memory sliding-window request throttles
 *    per IP. Protects against abuse and bot floods.
 *
 * 2. Login lockout - DB-backed (persistent across server restarts) with
 *    PROGRESSIVE backoff: 3 failures = 5 min, then 10 / 15 / 30 / 60 min.
 *    Keyed by LOWER(username) + IP so restarting the server cannot reset the
 *    counter and one IP cannot silently attack many accounts.
 */

const db = require('../config/db');
const { insertAudit } = require('./auditMiddleware');

// ---------------------------------------------------------------------------
// Generic in-memory sliding-window limiter
// ---------------------------------------------------------------------------
const buckets = new Map();

// Periodically purge stale buckets so the map cannot grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now - entry.windowStart > entry.windowMs * 4) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

function memoryLimiter({ windowMs, max, message }) {
  return (req, res, next) => {
    const ip = req.ipAddress || req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = buckets.get(`${ip}:${windowMs}`);
    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { windowStart: now, windowMs, count: 0 };
      buckets.set(`${ip}:${windowMs}`, entry);
    }

    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({
        error: message || 'Too many requests. Please slow down and try again shortly.',
        code: 'RATE_LIMITED',
      });
    }

    return next();
  };
}

// General API budget: generous for normal pharmacy use.
const apiLimiter = memoryLimiter({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_API_PER_MIN || 300),
});

// Login budget: much stricter.
const authLimiter = memoryLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_LOGIN_PER_15MIN || 30),
  message: 'Too many sign-in attempts from this network. Please wait a few minutes.',
});

// ---------------------------------------------------------------------------
// DB-backed progressive login lockout
// ---------------------------------------------------------------------------

const LOCKOUT_STEPS_MIN = [5, 10, 15, 30, 60];
const ATTEMPTS_BEFORE_LOCK = 3;

const ensureLockoutTable = (() => {
  let done = null;
  return function ensure() {
    if (!done) {
      done = db.query(`
        CREATE TABLE IF NOT EXISTS login_security (
          username_key VARCHAR(150) NOT NULL,
          ip_address VARCHAR(50),
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          lockout_level INTEGER NOT NULL DEFAULT 0,
          locked_until TIMESTAMP(0),
          last_failed_at TIMESTAMP(0),
          updated_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (username_key, ip_address)
        )
      `).catch((err) => {
        console.error('[LOGIN_SECURITY] table create failed:', err.message);
        done = null;
      });
    }
    return done;
  };
})();

async function getLockState(usernameKey, ip) {
  await ensureLockoutTable();
  const result = await db.query(
    `SELECT failed_attempts, lockout_level, locked_until
       FROM login_security
      WHERE username_key = $1 AND ip_address = $2`,
    [usernameKey, ip]
  );
  return result.rows[0] || null;
}

function minutesRemaining(lockedUntil) {
  if (!lockedUntil) return 0;
  const ms = new Date(lockedUntil).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

/**
 * Returns { locked, retryAfterMinutes } for this username+IP pair.
 */
async function checkLocked(username, ip) {
  const state = await getLockState(String(username).toLowerCase(), ip);
  if (!state || !state.locked_until) return { locked: false };
  const mins = minutesRemaining(state.locked_until);
  if (mins > 0) return { locked: true, retryAfterMinutes: mins };

  // Lock expired - clear it so counting restarts cleanly.
  await db.query(
    `UPDATE login_security
        SET locked_until = NULL, failed_attempts = 0, lockout_level = 0, updated_at = NOW()
      WHERE username_key = $1 AND ip_address = $2`,
    [String(username).toLowerCase(), ip]
  );
  return { locked: false };
}

/**
 * Records a FAILED attempt and escalates the lockout level when the
 * threshold is crossed. Returns the current state.
 */
async function recordFailure(username, ip) {
  const usernameKey = String(username).toLowerCase();
  await ensureLockoutTable();

  const current = await getLockState(usernameKey, ip);

  // If already serving a lock, keep extending from where we are.
  const activeLock = current && current.locked_until && minutesRemaining(current.locked_until) > 0;

  const attempts = activeLock ? current.failed_attempts : (current?.failed_attempts || 0) + 1;
  let level = current?.lockout_level || 0;
  let lockedUntil = current?.locked_until || null;

  if (attempts >= ATTEMPTS_BEFORE_LOCK) {
    const stepIndex = Math.min(level, LOCKOUT_STEPS_MIN.length - 1);
    const mins = LOCKOUT_STEPS_MIN[stepIndex];
    lockedUntil = new Date(Date.now() + mins * 60 * 1000);
    level += 1;

    await insertAudit(null, {
      action: 'ACCOUNT_LOCKED',
      module: 'SECURITY',
      description: `Account "${usernameKey}" locked for ${mins} minute(s) after ${attempts} failed sign-in attempts from ${ip}`,
      ipAddress: ip,
      status: 'FAILED',
      metadata: { username_key: usernameKey, failed_attempts: attempts, lockout_minutes: mins },
    }).catch(() => {});
  }

  await db.query(
    `INSERT INTO login_security (username_key, ip_address, failed_attempts, lockout_level, locked_until, last_failed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (username_key, ip_address)
     DO UPDATE SET failed_attempts = $3, lockout_level = $4, locked_until = $5,
                   last_failed_at = NOW(), updated_at = NOW()`,
    [usernameKey, ip, attempts, level, lockedUntil]
  );

  const mins = minutesRemaining(lockedUntil);
  return { attempts, locked: mins > 0, retryAfterMinutes: mins };
}

/**
 * Clears failure tracking for a successful sign-in.
 */
async function clearFailures(username, ip) {
  await ensureLockoutTable();
  await db.query(
    `DELETE FROM login_security WHERE username_key = $1 AND ip_address = $2`,
    [String(username).toLowerCase(), ip]
  ).catch(() => {});
}

module.exports = { apiLimiter, authLimiter, checkLocked, recordFailure, clearFailures };
