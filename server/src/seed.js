/**
 * seed.js
 *
 * Seeds the SYSTEM ADMINISTRATOR account.
 *
 * Two entry points:
 *
 *   1. seedData() — called on startup (app.js) and by the admin-only
 *      POST /api/data/seed endpoint. Creates the initial administrator ONLY
 *      when the users table is completely empty, so a live installation
 *      never gains a surprise account.
 *
 *   2. `npm run seed` — operator helper (this file executed directly).
 *      Makes sure an administrator account with the configured username
 *      exists and prints its users.user_id. Idempotent and non-destructive:
 *      an existing account is reported, NEVER modified — passwords are
 *      never overwritten.
 *
 * Optional environment variables:
 *   ADMIN_USERNAME   login name            (default: 'admin')
 *   ADMIN_PASSWORD   initial password      (default: 'admin123')
 *   ADMIN_FULL_NAME  display name          (default: 'System Administrator')
 *   ADMIN_USER_ID    force a specific users.user_id (default: auto)
 *
 * Examples:
 *   npm run seed
 *   ADMIN_USER_ID=1 npm run seed
 *   ADMIN_USERNAME=manager ADMIN_PASSWORD='Str0ngPass1' npm run seed
 */

'use strict';

const bcrypt = require('bcryptjs');
const db = require('./config/db');

const DEFAULTS = {
  username: 'admin',
  password: 'admin123',
  fullName: 'System Administrator',
};

// Same password policy as userController: 8+ chars, letters AND numbers.
const isStrongEnough = (password) =>
  typeof password === 'string' &&
  password.length >= 8 &&
  /[A-Za-z]/.test(password) &&
  /\d/.test(password);

/** Resolve the administrator configuration from the environment. */
const adminConfig = () => {
  const username = String(process.env.ADMIN_USERNAME || DEFAULTS.username).trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || DEFAULTS.password;
  const fullName = String(process.env.ADMIN_FULL_NAME || DEFAULTS.fullName).replace(/\s+/g, ' ').trim();

  if (!/^[a-z0-9._@+-]{3,100}$/.test(username)) {
    throw new Error('ADMIN_USERNAME must be 3-100 characters (letters, digits, . _ @ + -).');
  }
  if (!fullName || fullName.length < 2) {
    throw new Error('ADMIN_FULL_NAME must contain at least 2 characters.');
  }

  let userId = null;
  if (process.env.ADMIN_USER_ID) {
    userId = Number(process.env.ADMIN_USER_ID);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error('ADMIN_USER_ID must be a positive integer.');
    }
  }

  return { username, password, fullName, userId };
};

/**
 * Create (or locate) the administrator account.
 * Returns { user_id, username, full_name, role, status, created }.
 */
const ensureAdminUser = async () => {
  const cfg = adminConfig();
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Never touch an account that already owns this username.
    const existing = await client.query(
      `SELECT user_id, username, full_name, role, status
         FROM users
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1`,
      [cfg.username]
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return { ...existing.rows[0], created: false };
    }

    // A requested user_id must be free — silently picking another one
    // would make the printed id a lie.
    if (cfg.userId !== null) {
      const taken = await client.query('SELECT username FROM users WHERE user_id = $1', [cfg.userId]);
      if (taken.rows.length > 0) {
        throw new Error(
          `ADMIN_USER_ID=${cfg.userId} is already used by "${taken.rows[0].username}" — choose a free id.`
        );
      }
    }

    const passwordHash = await bcrypt.hash(cfg.password, 10);

    const inserted = cfg.userId !== null
      ? await client.query(
          `INSERT INTO users (user_id, role, full_name, username, password_hash, status)
           VALUES ($1, 'ADMIN', $2, $3, $4, 'ACTIVE')
           RETURNING user_id, username, full_name, role, status`,
          [cfg.userId, cfg.fullName, cfg.username, passwordHash]
        )
      : await client.query(
          `INSERT INTO users (role, full_name, username, password_hash, status)
           VALUES ('ADMIN', $1, $2, $3, 'ACTIVE')
           RETURNING user_id, username, full_name, role, status`,
          [cfg.fullName, cfg.username, passwordHash]
        );

    // An explicit id does NOT advance the bigserial sequence — realign it so
    // the next account created from the UI cannot collide (same pattern as
    // initializeDB uses for the other tables).
    if (cfg.userId !== null) {
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence('users', 'user_id'),
          COALESCE((SELECT MAX(user_id) FROM users), 0) + 1,
          false
        )
      `);
    }

    await client.query('COMMIT');
    return { ...inserted.rows[0], created: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Lost a race — another process created the same username first.
    if (err.code === '23505') {
      const row = await db.query(
        `SELECT user_id, username, full_name, role, status
           FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
        [cfg.username]
      );
      if (row.rows.length > 0) return { ...row.rows[0], created: false };
    }
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Startup seeding: creates the initial administrator ONLY when there is no
 * user at all. Safe to call on every boot / from POST /api/data/seed.
 */
const seedData = async () => {
  try {
    const res = await db.query('SELECT COUNT(*) FROM users');
    if (parseInt(res.rows[0].count, 10) > 0) return;

    console.log('Seeding initial admin user...');
    const admin = await ensureAdminUser();
    console.log(`Initial admin user ready — user_id=${admin.user_id}, username=${admin.username}`);
  } catch (err) {
    console.error('Seeding error:', err.message);
  }
};

/* ─────────────────────────────────────────────────────────────────────────── *
 *  Operator runner — `npm run seed` executes this file directly.
 *  Reports the administrator account and its users.user_id.
 * ─────────────────────────────────────────────────────────────────────────── */
const runSeeder = async () => {
  try {
    const cfg = adminConfig();
    const admin = await ensureAdminUser();

    console.log('==================================================');
    console.log(' Administrator account ready');
    console.log('==================================================');
    console.log(`  user_id   : ${admin.user_id}`);
    console.log(`  username  : ${admin.username}`);
    console.log(`  full_name : ${admin.full_name}`);
    console.log(`  role      : ${admin.role}`);
    console.log(`  status    : ${admin.status}`);
    if (admin.created) {
      const shown = cfg.password === DEFAULTS.password
        ? `${DEFAULTS.password} (default — change it after the first sign-in)`
        : 'as configured in ADMIN_PASSWORD';
      console.log(`  password  : ${shown}`);
    }
    console.log(admin.created
      ? '  Result    : CREATED a new administrator account.'
      : '  Result    : account already existed — nothing was modified.');

    if (!admin.created && cfg.userId !== null && Number(admin.user_id) !== cfg.userId) {
      console.log(`  NOTE      : ADMIN_USER_ID=${cfg.userId} was requested, but the existing`);
      console.log(`              account already has user_id=${admin.user_id} — existing`);
      console.log('              user ids are never changed.');
    }
    if (!admin.created && admin.role !== 'ADMIN') {
      console.log('  WARNING   : this account is not an administrator — promote it');
      console.log('              from Settings > Users, or use another ADMIN_USERNAME.');
    }
    if (!admin.created && admin.status !== 'ACTIVE') {
      console.log('  WARNING   : this account is not ACTIVE — reactivate it from');
      console.log('              Settings > Users before signing in.');
    }
    if (admin.created && !isStrongEnough(cfg.password)) {
      console.log('  WARNING   : ADMIN_PASSWORD is weak — use 8+ characters with');
      console.log('              letters and numbers.');
    }
  } catch (err) {
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  } finally {
    try { await db.getPgPool().end(); } catch (_) { /* pool already closed */ }
  }
};

if (require.main === module) {
  runSeeder();
}

module.exports = { seedData, ensureAdminUser };
