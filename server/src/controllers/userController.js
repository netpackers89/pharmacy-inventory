const db = require('../config/db');
const bcrypt = require('bcryptjs');

// Get all users — fixed for normalized schema
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

// Add user
exports.addUser = async (req, res) => {
  try {
    const { full_name, username, password, role } = req.body;
    if (!full_name || !username || !password) {
      return res.status(400).json({ error: 'Full name, username and password are required' });
    }
    const validRole = (role === 'ADMIN' || role === 'PHARMACY') ? role : 'PHARMACY';
    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(`
      INSERT INTO users (full_name, username, password_hash, role, status)
      VALUES ($1, $2, $3, $4, 'ACTIVE')
      RETURNING user_id, full_name, username, role, status, created_at
    `, [full_name, username, hash, validRole]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

// Update user details
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, username, role } = req.body;
    const result = await db.query(`
      UPDATE users
      SET full_name = COALESCE($1, full_name),
          username = COALESCE($2, username),
          role = COALESCE($3, role)
      WHERE user_id = $4
      RETURNING user_id, full_name, username, role, status
    `, [full_name, username, role, id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
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
    const result = await db.query(`
      UPDATE users SET status = $1 WHERE user_id = $2
      RETURNING user_id, full_name, status
    `, [status, id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
};

// Reset password
exports.resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const hash = await bcrypt.hash(new_password, 10);
    const result = await db.query(`UPDATE users SET password_hash = $1 WHERE user_id = $2 RETURNING user_id`, [hash, id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};
