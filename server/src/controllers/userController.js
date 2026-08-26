const db = require('../config/db');
const bcrypt = require('bcryptjs');

/*
 * USER MANAGEMENT — ADMINISTRATOR-ONLY.
 * Route-level requireAdmin guarantees authorization; this controller adds
 * input validation, password hygiene and audit logging for every action.
 */

const VALID_ROLES = ['ADMIN', 'PHARMACY'];

// Basic password policy: 8+ chars, at least one letter and one number.
const isStrongEnough = (password) =>
  typeof password === 'string' &&
  password.length >= 8 &&
  /[A-Za-z]/.test(password) &&
  /\d/.test(password);

const audit = async (req, action, description, recordId, metadata) => {
  try {
    await req.auditLog(null, action, 'USERS', {
      recordId,
      tableName: 'users',
      entityType: 'user',
      entityId: recordId,
      description,
      metadata,
    });
  } catch (_) { /* never throw from audit */ }
};

// Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT user_id, full_name, username, role, status, created_at
      FROM users ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
};

// Active staff account count — safe for any authenticated staff member.
exports.getUserCount = async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT COUNT(*) AS count FROM users WHERE status = 'ACTIVE'`
    );
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error('[USER_COUNT]', err.message);
    res.status(500).json({ error: 'Failed to retrieve user count' });
  }
};

// Add user (administrator creating a staff/pharmacy account)
exports.addUser = async (req, res) => {
  try {
    const rawName = typeof req.body.full_name === 'string' ? req.body.full_name.replace(/\s+/g, ' ').trim() : '';
    const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = req.body.password;
    const role = VALID_ROLES.includes(req.body.role) ? req.body.role : 'PHARMACY';

    if (!rawName || rawName.length < 2 || rawName.length > 100) {
      return res.status(400).json({ error: 'A full name between 2 and 100 characters is required.' });
    }
    if (!/^[a-z0-9._@+-]{3,100}$/i.test(username)) {
      return res.status(400).json({ error: 'Enter a valid email address or username (3–100 characters).' });
    }
    if (!isStrongEnough(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include letters and numbers.' });
    }

    // Prevent duplicate accounts
    const existing = await db.query('SELECT user_id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email/username already exists.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(`
      INSERT INTO users (full_name, username, password_hash, role, status)
      VALUES ($1, $2, $3, $4, 'ACTIVE')
      RETURNING user_id, full_name, username, role, status, created_at
    `, [rawName, username, hash, role]);

    await audit(req, 'CREATE', `Administrator created ${role} account for "${rawName}" (${username})`, result.rows[0].user_id, { role });

    // Never return the password or its hash.
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this email/username already exists.' });
    console.error('[ADD_USER]', err.message);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

// Update user details
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const rawName = typeof req.body.full_name === 'string' ? req.body.full_name.replace(/\s+/g, ' ').trim() : undefined;
    const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : undefined;
    let role = req.body.role;

    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    if (username !== undefined && !/^[a-z0-9._@+-]{3,100}$/i.test(username)) {
      return res.status(400).json({ error: 'Enter a valid email address or username.' });
    }

    // Prevent an administrator from demoting/deactivating themselves into a locked-out state.
    if (Number(id) === Number(req.user.user_id) && role === 'PHARMACY') {
      const adminCount = await db.query(`SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'`);
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return res.status(400).json({ error: 'Cannot change your own role — at least one active administrator must remain.' });
      }
    }

    const oldRow = await db.query(`SELECT full_name, username, role FROM users WHERE user_id = $1`, [id]);
    if (!oldRow.rows.length) return res.status(404).json({ error: 'User not found' });

    const result = await db.query(`
      UPDATE users
      SET full_name = COALESCE($1, full_name),
          username = COALESCE($2, username),
          role = COALESCE($3, role)
      WHERE user_id = $4
      RETURNING user_id, full_name, username, role, status
    `, [rawName || null, username || null, role || null, id]);

    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    await audit(req, 'UPDATE', `Administrator updated account "${result.rows[0].username}"`, id, {
      before: oldRow.rows[0],
      after: { full_name: result.rows[0].full_name, username: result.rows[0].username, role: result.rows[0].role },
    });

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this email/username already exists.' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
};

// Change user status (activate/deactivate)
exports.changeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['ACTIVE', 'INACTIVE'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (Number(id) === Number(req.user.user_id) && status === 'INACTIVE') {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }

    const result = await db.query(`
      UPDATE users SET status = $1 WHERE user_id = $2
      RETURNING user_id, full_name, username, status
    `, [status, id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    await audit(req, 'UPDATE', `Administrator set account "${result.rows[0].username}" to ${status}`, id);

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
};

// Reset password (administrator-authorized)
exports.resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;
    if (!isStrongEnough(new_password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include letters and numbers.' });
    }
    const hash = await bcrypt.hash(new_password, 10);
    const result = await db.query(
      `UPDATE users SET password_hash = $1 WHERE user_id = $2 RETURNING user_id, username`,
      [hash, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    // Audit records WHO reset WHOM — never the password itself.
    await audit(req, 'PASSWORD_RESET', `Administrator reset the password for "${result.rows[0].username}"`, id);

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};
