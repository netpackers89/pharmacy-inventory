const db = require('../config/db');

/*
 * SUPPLIERS — soft deactivation architecture.
 *
 * Deactivating a supplier NEVER deletes it: batches, resupplies and bin-card
 * history keep their real supplier names (historical truth). Inactive
 * suppliers simply disappear from transaction dropdowns. Status changes are
 * ADMIN-ONLY at the route level and audited with old/new values.
 */

const STATUSES = ['ACTIVE', 'INACTIVE'];

const clean = (v) => (typeof v === 'string' ? v.trim() : undefined);

async function audit(req, action, description, recordId, oldValues, newValues) {
  try {
    await req.auditLog(null, action, 'SUPPLIERS', {
      recordId,
      tableName: 'suppliers',
      entityType: 'supplier',
      entityId: recordId,
      description,
      oldValues,
      newValues,
    });
  } catch (_) { /* audit never throws */ }
}

/**
 * GET /api/suppliers[?status=ACTIVE|INACTIVE]
 * Management listing. Default returns ALL records (admins filter client-side);
 * `?status=ACTIVE` serves operational dropdowns server-side.
 */
exports.getAllSuppliers = async (req, res) => {
  try {
    const { status } = req.query;
    const params = [];
    let where = '';
    if (status && STATUSES.includes(String(status).toUpperCase())) {
      where = 'WHERE s.status = $1';
      params.push(String(status).toUpperCase());
    }

    const result = await db.query(`
      SELECT s.*,
        COUNT(DISTINCT b.batch_id)::int AS total_batches,
        COALESCE(SUM(b.stock_quantity * b.buy_price), 0) AS total_value,
        (SELECT COUNT(*)::int FROM resupplies r WHERE r.supplier_id = s.supplier_id) AS resupply_count
      FROM suppliers s
      LEFT JOIN batches b ON b.supplier_id = s.supplier_id AND b.status != 'INACTIVE'
      ${where}
      GROUP BY s.supplier_id
      ORDER BY s.name ASC
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('[SUPPLIERS]', err.message);
    res.status(500).json({ error: 'Failed to retrieve suppliers' });
  }
};

exports.getSupplierById = async (req, res) => {
  try {
    const { id } = req.params;
    const sup = await db.query(`SELECT * FROM suppliers WHERE supplier_id = $1`, [id]);
    if (!sup.rows.length) return res.status(404).json({ error: 'Supplier not found' });

    // Purchase history via batches (historical truth preserved even if inactive)
    const history = await db.query(`
      SELECT b.batch_id, m.generic_name, b.batch_number, b.expiry_date,
             b.buy_price, b.stock_quantity, b.created_at
      FROM batches b
      JOIN medicines m ON b.medicine_id = m.medicine_id
      WHERE b.supplier_id = $1
      ORDER BY b.created_at DESC
    `, [id]);

    res.json({ ...sup.rows[0], purchase_history: history.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

/** POST /api/suppliers */
exports.addSupplier = async (req, res) => {
  try {
    const name = clean(req.body?.name);
    const contact_person = clean(req.body?.contact_person) || null;
    const phone = clean(req.body?.phone) || null;
    const email = clean(req.body?.email) || null;
    const address = clean(req.body?.address) || null;

    if (!name || name.length < 2 || name.length > 150) {
      return res.status(400).json({ error: 'Supplier name must be 2–150 characters.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    // Case-insensitive duplicate prevention ("ABC Pharma" vs "abc pharma")
    const dup = await db.query(
      'SELECT supplier_id, name FROM suppliers WHERE LOWER(name) = LOWER($1)',
      [name]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: `"${dup.rows[0].name}" already exists.` });
    }

    const result = await db.query(`
      INSERT INTO suppliers (name, contact_person, phone, email, address)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, contact_person, phone, email, address]);

    await audit(req, 'CREATE_SUPPLIER', `Administrator/staff added supplier "${name}"`,
      result.rows[0].supplier_id, null,
      { name, contact_person, phone, email });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This supplier already exists.' });
    console.error('[ADD SUPPLIER]', err.message);
    res.status(500).json({ error: 'Failed to add supplier' });
  }
};

/** PUT /api/suppliers/:id — detail edits (status goes through /status) */
exports.updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const name = clean(req.body?.name);
    const contact_person = clean(req.body?.contact_person);
    const phone = clean(req.body?.phone);
    const email = clean(req.body?.email);
    const address = clean(req.body?.address);

    if (name !== undefined && (name.length < 2 || name.length > 150)) {
      return res.status(400).json({ error: 'Supplier name must be 2–150 characters.' });
    }
    if (email !== undefined && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const old = await db.query('SELECT * FROM suppliers WHERE supplier_id = $1', [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Supplier not found' });

    if (name !== undefined) {
      const dup = await db.query(
        'SELECT supplier_id FROM suppliers WHERE LOWER(name) = LOWER($1) AND supplier_id != $2',
        [name, id]
      );
      if (dup.rows.length > 0) return res.status(409).json({ error: 'Another supplier already uses this name.' });
    }

    const result = await db.query(`
      UPDATE suppliers
      SET name = COALESCE($1, name),
          contact_person = COALESCE($2, contact_person),
          phone = COALESCE($3, phone),
          email = COALESCE($4, email),
          address = COALESCE($5, address),
          updated_at = CURRENT_TIMESTAMP
      WHERE supplier_id = $6
      RETURNING *
    `, [name ?? null, contact_person ?? null, phone ?? null, email ?? null, address ?? null, id]);

    const before = { name: old.rows[0].name, contact_person: old.rows[0].contact_person, phone: old.rows[0].phone, email: old.rows[0].email };
    const after = { name: result.rows[0].name, contact_person: result.rows[0].contact_person, phone: result.rows[0].phone, email: result.rows[0].email };

    await audit(req, 'UPDATE_SUPPLIER', `Supplier "${result.rows[0].name}" was edited`, id, before, after);

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This supplier already exists.' });
    console.error('[UPDATE SUPPLIER]', err.message);
    res.status(500).json({ error: 'Failed to update supplier' });
  }
};

/**
 * PUT /api/suppliers/:id/status { status } — ADMIN ONLY (route-enforced).
 * Soft deactivation: historical batches/resupplies keep this supplier linked.
 */
exports.changeSupplierStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.status || '').toUpperCase();
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be ACTIVE or INACTIVE.' });
    }

    const old = await db.query('SELECT supplier_id, name, status FROM suppliers WHERE supplier_id = $1', [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Supplier not found' });

    if (old.rows[0].status === status) return res.json(old.rows[0]); // idempotent

    const result = await db.query(
      `UPDATE suppliers SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE supplier_id = $2 RETURNING *`,
      [status, id]
    );

    const verb = status === 'ACTIVE' ? 'activated' : 'deactivated';
    await audit(
      req,
      status === 'ACTIVE' ? 'ACTIVATE_SUPPLIER' : 'DEACTIVATE_SUPPLIER',
      `Administrator ${verb} supplier "${old.rows[0].name}"`,
      id,
      { status: old.rows[0].status },
      { status }
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[SUPPLIER STATUS]', err.message);
    res.status(500).json({ error: 'Failed to update supplier status' });
  }
};
