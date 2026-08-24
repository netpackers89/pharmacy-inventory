const db = require('../config/db');

// Get all settings
exports.getAll = async (req, res) => {
  try {
    const result = await db.query(`SELECT setting_key, setting_value, description FROM settings ORDER BY setting_key ASC`);
    // Convert rows to object map for convenience
    const settings = {};
    result.rows.forEach(r => { settings[r.setting_key] = { value: r.setting_value, description: r.description }; });
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// Update a setting
exports.updateSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    await db.query(
      `INSERT INTO settings (setting_key, setting_value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_at = NOW()`,
      [key, String(value)]
    );
    res.json({ message: 'Setting updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// Batch update multiple settings at once
exports.updateBatch = async (req, res) => {
  try {
    const { settings } = req.body; // { key: value, ... }
    const client = await db.getClient();
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(settings)) {
      await client.query(
        `INSERT INTO settings (setting_key, setting_value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_at = NOW()`,
        [key, String(value)]
      );
    }
    await client.query('COMMIT');
    client.release();
    res.json({ message: 'Settings saved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};
