const db = require('../config/db');

exports.getAllSuppliers = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT s.*,
        COUNT(DISTINCT b.batch_id) AS total_batches,
        COALESCE(SUM(b.stock_quantity * b.buy_price), 0) AS total_value
      FROM suppliers s
      LEFT JOIN batches b ON b.supplier_id = s.supplier_id AND b.status != 'INACTIVE'
      GROUP BY s.supplier_id
      ORDER BY s.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve suppliers' });
  }
};

exports.getSupplierById = async (req, res) => {
  try {
    const { id } = req.params;
    const sup = await db.query(`SELECT * FROM suppliers WHERE supplier_id = $1`, [id]);
    if (!sup.rows.length) return res.status(404).json({ error: 'Supplier not found' });
    // Purchase history via batches
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

exports.addSupplier = async (req, res) => {
  try {
    const { name, contact_person, phone, email, address } = req.body;
    if (!name) return res.status(400).json({ error: 'Supplier name is required' });
    const result = await db.query(`
      INSERT INTO suppliers (name, contact_person, phone, email, address)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, contact_person || null, phone || null, email || null, address || null]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Supplier already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to add supplier' });
  }
};

exports.updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, contact_person, phone, email, address, status } = req.body;
    const result = await db.query(`
      UPDATE suppliers
      SET name = COALESCE($1, name),
          contact_person = COALESCE($2, contact_person),
          phone = COALESCE($3, phone),
          email = COALESCE($4, email),
          address = COALESCE($5, address),
          status = COALESCE($6, status)
      WHERE supplier_id = $7
      RETURNING *
    `, [name, contact_person, phone, email, address, status, id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Supplier not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update supplier' });
  }
};
