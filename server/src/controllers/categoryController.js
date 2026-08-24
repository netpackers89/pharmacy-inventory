const db = require('../config/db');

/*
 * CATEGORIES & SUBCATEGORIES — soft deactivation architecture.
 *
 * Deactivation NEVER deletes: IDs, relationships and historical references
 * (medicines, batches, reports) remain intact. Only `status` flips between
 * ACTIVE and INACTIVE. Operational dropdowns consume /active which applies
 * the composite rule: a subcategory is available only when BOTH it and its
 * parent category are ACTIVE. Every mutation is audit-logged with old/new values.
 */

const STATUSES = ['ACTIVE', 'INACTIVE'];

const cleanName = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

async function audit(req, action, description, recordId, entityType, oldValues, newValues) {
  try {
    await req.auditLog(null, action, 'CATEGORIES', {
      recordId,
      tableName: entityType === 'subcategory' ? 'sub_categories' : 'categories',
      entityType,
      entityId: recordId,
      description,
      oldValues,
      newValues,
    });
  } catch (_) { /* audit never throws */ }
}

/* ── CATEGORIES ───────────────────────────────────────────────────────────── */

/**
 * GET /api/categories[?status=ACTIVE|INACTIVE]
 * Management listing — includes inactive records so admins can see them.
 */
exports.getAll = async (req, res) => {
  try {
    const { status } = req.query;
    const params = [];
    let where = '';
    if (status && STATUSES.includes(String(status).toUpperCase())) {
      where = 'WHERE c.status = $1';
      params.push(String(status).toUpperCase());
    }

    const cats = await db.query(`
      SELECT c.category_id, c.name, c.status, c.created_at, c.updated_at,
             COUNT(sc.sub_category_id)::int AS sub_count,
             (SELECT COUNT(*)::int FROM medicines m WHERE m.category_id = c.category_id) AS medicine_count
      FROM categories c
      LEFT JOIN sub_categories sc ON sc.category_id = c.category_id
      ${where}
      GROUP BY c.category_id
      ORDER BY c.name ASC
    `, params);

    const subs = await db.query(`
      SELECT s.sub_category_id, s.category_id, s.name, s.status, s.created_at, s.updated_at,
             (SELECT COUNT(*)::int FROM medicines m WHERE m.sub_category_id = s.sub_category_id) AS medicine_count
      FROM sub_categories s
      ORDER BY s.name ASC
    `);

    const result = cats.rows.map((cat) => ({
      ...cat,
      sub_categories: subs.rows.filter((s) => s.category_id === cat.category_id),
    }));
    res.json(result);
  } catch (err) {
    console.error('[CATEGORIES]', err.message);
    res.status(500).json({ error: 'Failed to retrieve categories' });
  }
};

/**
 * GET /api/categories/active
 * OPERATIONAL payload for dropdowns: ACTIVE categories containing ONLY their
 * ACTIVE subcategories. (Composite rule enforced server-side.)
 */
exports.getActive = async (req, res) => {
  try {
    const cats = await db.query(`
      SELECT category_id, name, status
      FROM categories
      WHERE status = 'ACTIVE'
      ORDER BY name ASC
    `);
    const subs = await db.query(`
      SELECT sub_category_id, category_id, name, status
      FROM sub_categories
      WHERE status = 'ACTIVE'
      ORDER BY name ASC
    `);

    const result = cats.rows.map((cat) => ({
      ...cat,
      sub_categories: subs.rows.filter((s) => s.category_id === cat.category_id),
    }));
    res.json(result);
  } catch (err) {
    console.error('[CATEGORIES ACTIVE]', err.message);
    res.status(500).json({ error: 'Failed to retrieve active categories' });
  }
};

/** POST /api/categories — ADMIN ONLY (route-enforced) */
exports.addCategory = async (req, res) => {
  try {
    const name = cleanName(req.body?.name);

    if (!name || name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Category name must be 2–100 characters.' });
    }

    // Case-insensitive duplicate prevention ("Antibiotics" vs "antibiotics")
    const dup = await db.query(
      'SELECT category_id, name FROM categories WHERE LOWER(name) = LOWER($1)',
      [name]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: `"${dup.rows[0].name}" already exists.` });
    }

    const result = await db.query(
      `INSERT INTO categories (name, status) VALUES ($1, 'ACTIVE') RETURNING *`,
      [name]
    );

    await audit(req, 'CREATE', `Administrator created category "${name}"`, result.rows[0].category_id, 'category', null, { name, status: 'ACTIVE' });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This category already exists.' });
    console.error('[ADD CATEGORY]', err.message);
    res.status(500).json({ error: 'Failed to create category' });
  }
};

/** PUT /api/categories/:id — rename only (status goes through /status) — ADMIN ONLY */
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const name = cleanName(req.body?.name);
    if (!name || name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Category name must be 2–100 characters.' });
    }

    const old = await db.query('SELECT category_id, name, status FROM categories WHERE category_id = $1', [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Category not found' });

    const dup = await db.query(
      'SELECT category_id FROM categories WHERE LOWER(name) = LOWER($1) AND category_id != $2',
      [name, id]
    );
    if (dup.rows.length > 0) return res.status(409).json({ error: 'Another category already uses this name.' });

    const result = await db.query(
      `UPDATE categories SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE category_id = $2 RETURNING *`,
      [name, id]
    );

    await audit(req, 'UPDATE', `Administrator renamed category "${old.rows[0].name}" to "${name}"`,
      id, 'category', { name: old.rows[0].name }, { name });

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This category already exists.' });
    console.error('[UPDATE CATEGORY]', err.message);
    res.status(500).json({ error: 'Failed to update category' });
  }
};

/** PUT /api/categories/:id/status { status } — ADMIN ONLY, audited with old/new values */
exports.setCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.status || '').toUpperCase();
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be ACTIVE or INACTIVE.' });
    }

    const old = await db.query('SELECT category_id, name, status FROM categories WHERE category_id = $1', [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Category not found' });

    if (old.rows[0].status === status) {
      return res.json(old.rows[0]); // idempotent no-op
    }

    const result = await db.query(
      `UPDATE categories SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE category_id = $2 RETURNING *`,
      [status, id]
    );

    const verb = status === 'ACTIVE' ? 'activated' : 'deactivated';
    await audit(
      req,
      status === 'ACTIVE' ? 'ACTIVATE_CATEGORY' : 'DEACTIVATE_CATEGORY',
      `Administrator ${verb} category "${old.rows[0].name}"`,
      id, 'category',
      { status: old.rows[0].status },
      { status }
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CATEGORY STATUS]', err.message);
    res.status(500).json({ error: 'Failed to update category status' });
  }
};

/* ── SUBCATEGORIES ────────────────────────────────────────────────────────── */

/** POST /api/categories/:categoryId/subcategories — ADMIN ONLY */
exports.addSubCategory = async (req, res) => {
  try {
    const categoryId = parseInt(req.params.category_id, 10);
    const name = cleanName(req.body?.name);

    if (!Number.isFinite(categoryId)) {
      return res.status(400).json({ error: 'A valid parent category is required.' });
    }
    if (!name || name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Subcategory name must be 2–100 characters.' });
    }

    // New active subcategories may only live under an ACTIVE parent.
    const parent = await db.query('SELECT category_id, name, status FROM categories WHERE category_id = $1', [categoryId]);
    if (!parent.rows.length) return res.status(404).json({ error: 'Parent category not found' });
    if (parent.rows[0].status !== 'ACTIVE') {
      return res.status(400).json({ error: `Cannot add a subcategory under the inactive category "${parent.rows[0].name}". Activate it first.` });
    }

    const dup = await db.query(
      'SELECT sub_category_id FROM sub_categories WHERE category_id = $1 AND LOWER(name) = LOWER($2)',
      [categoryId, name]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: `"${parent.rows[0].name}" already has a subcategory named "${name}".` });
    }

    const result = await db.query(
      `INSERT INTO sub_categories (category_id, name, status) VALUES ($1, $2, 'ACTIVE') RETURNING *`,
      [categoryId, name]
    );

    await audit(req, 'CREATE_SUBCATEGORY', `Administrator created subcategory "${name}" under "${parent.rows[0].name}"`,
      result.rows[0].sub_category_id, 'subcategory', null, { name, category_id: categoryId, status: 'ACTIVE' });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This subcategory already exists in this category.' });
    console.error('[ADD SUBCATEGORY]', err.message);
    res.status(500).json({ error: 'Failed to create subcategory' });
  }
};

/** PUT /api/categories/subcategories/:id — rename only — ADMIN ONLY */
exports.updateSubCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const name = cleanName(req.body?.name);
    if (!name || name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Subcategory name must be 2–100 characters.' });
    }

    const old = await db.query(`
      SELECT s.sub_category_id, s.name AS sub_name, s.category_id, c.name AS category_name
      FROM sub_categories s JOIN categories c ON c.category_id = s.category_id
      WHERE s.sub_category_id = $1
    `, [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Subcategory not found' });

    const dup = await db.query(
      'SELECT sub_category_id FROM sub_categories WHERE category_id = $1 AND LOWER(name) = LOWER($2) AND sub_category_id != $3',
      [old.rows[0].category_id, name, id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: `"${old.rows[0].category_name}" already has a subcategory named "${name}".` });
    }

    const result = await db.query(
      `UPDATE sub_categories SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE sub_category_id = $2 RETURNING *`,
      [name, id]
    );

    await audit(req, 'UPDATE_SUBCATEGORY',
      `Administrator renamed subcategory "${old.rows[0].sub_name}" to "${name}" (${old.rows[0].category_name})`,
      id, 'subcategory', { name: old.rows[0].sub_name }, { name });

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This subcategory already exists in this category.' });
    console.error('[UPDATE SUBCATEGORY]', err.message);
    res.status(500).json({ error: 'Failed to update subcategory' });
  }
};

/** PUT /api/categories/subcategories/:id/status { status } — ADMIN ONLY, audited */
exports.setSubCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.status || '').toUpperCase();
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be ACTIVE or INACTIVE.' });
    }

    const old = await db.query(`
      SELECT s.sub_category_id, s.name, s.status, c.name AS category_name
      FROM sub_categories s JOIN categories c ON c.category_id = s.category_id
      WHERE s.sub_category_id = $1
    `, [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Subcategory not found' });

    if (old.rows[0].status === status) return res.json(old.rows[0]);

    const result = await db.query(
      `UPDATE sub_categories SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE sub_category_id = $2 RETURNING *`,
      [status, id]
    );

    const verb = status === 'ACTIVE' ? 'activated' : 'deactivated';
    await audit(
      req,
      status === 'ACTIVE' ? 'ACTIVATE_SUBCATEGORY' : 'DEACTIVATE_SUBCATEGORY',
      `Administrator ${verb} subcategory "${old.rows[0].name}" (${old.rows[0].category_name})`,
      id, 'subcategory',
      { status: old.rows[0].status },
      { status }
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[SUBCATEGORY STATUS]', err.message);
    res.status(500).json({ error: 'Failed to update subcategory status' });
  }
};
