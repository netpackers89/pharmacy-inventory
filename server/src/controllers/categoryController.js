const db = require('../config/db');

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

exports.getAll = async (req, res) => {
  try {
    const cats = await db.query(`
      SELECT c.*, COUNT(sc.sub_category_id)::int AS sub_count
      FROM categories c
      LEFT JOIN sub_categories sc ON sc.category_id = c.category_id
      GROUP BY c.category_id
      ORDER BY c.name ASC
    `);
    const subs = await db.query(`SELECT * FROM sub_categories ORDER BY name ASC`);
    // Attach subcategories to each category
    const result = cats.rows.map(cat => ({
      ...cat,
      sub_categories: subs.rows.filter(s => s.category_id === cat.category_id)
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

exports.addCategory = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const result = await db.query(
      `INSERT INTO categories (name) VALUES ($1) RETURNING *`,
      [name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Category already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;
    const result = await db.query(
      `UPDATE categories SET name = COALESCE($1, name), status = COALESCE($2, status) WHERE category_id = $3 RETURNING *`,
      [name, status, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Category not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// ─── SUBCATEGORIES ───────────────────────────────────────────────────────────

exports.addSubCategory = async (req, res) => {
  try {
    const { category_id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const result = await db.query(
      `INSERT INTO sub_categories (category_id, name) VALUES ($1, $2) RETURNING *`,
      [category_id, name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Subcategory already exists in this category' });
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

exports.updateSubCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;
    const result = await db.query(
      `UPDATE sub_categories SET name = COALESCE($1, name), status = COALESCE($2, status) WHERE sub_category_id = $3 RETURNING *`,
      [name, status, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Subcategory not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};
