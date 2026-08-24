const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function test() {
  try {
    const res = await pool.query('SELECT medicine_id FROM medicines LIMIT 1');
    if (res.rows.length === 0) { console.log('No medicines'); return; }
    const medId = res.rows[0].medicine_id;
    console.log('Testing medicine ID:', medId);
    const q1 = await pool.query(`
            SELECT m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.reorder_level, m.max_level, m.status, c.name as category_name, 
                   COALESCE(SUM(b.stock_quantity),0) as total_stock,
                   COUNT(DISTINCT b.batch_id) as batch_count,
                   SUM(CASE WHEN b.expiry_date <= CURRENT_DATE + INTERVAL '90 days' THEN 1 ELSE 0 END) as expiring_soon_count,
                   COALESCE(AVG(b.buy_price), 0) as avg_purchase_price,
                   COALESCE(SUM(b.stock_quantity * b.buy_price), 0) as stock_value
            FROM medicines m
            LEFT JOIN batches b ON b.medicine_id = m.medicine_id AND b.status != 'INACTIVE'
            LEFT JOIN categories c ON m.category_id = c.category_id
            WHERE m.medicine_id = $1
            GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.reorder_level, m.max_level, m.status, c.name
    `, [medId]);
    console.log('Med Query Success:', q1.rows[0]);
    const q2 = await pool.query(`
            SELECT b.batch_id, b.batch_number, b.stock_quantity, b.expiry_date, s.name as supplier_name,
                   b.barcode, b.qr_code, b.abc_category, b.ven_category
            FROM batches b
            LEFT JOIN suppliers s ON b.supplier_id = s.supplier_id
            WHERE b.medicine_id = $1 AND b.status != 'INACTIVE'
            ORDER BY b.expiry_date ASC
    `, [medId]);
    console.log('Batch Query Success:', q2.rows.length);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    pool.end();
  }
}
test();
