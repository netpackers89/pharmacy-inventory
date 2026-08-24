require('dotenv').config({ path: './.env' });
const { getClient } = require('./src/config/db');

async function run() {
  const client = await getClient();
  try {
    const saleId = 4; // fake
    const current_user_id = 1;
    const calculatedTotal = 100;
    const items = [1];
    
    // Simulate transaction
    await client.query('BEGIN');
    
    await client.query(`
      INSERT INTO sales (user_id, total_amount, subtotal, payment_method, override_reason)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING sale_id
    `, [current_user_id, calculatedTotal, calculatedTotal, 'CASH', null]);

    await client.query(`UPDATE batches SET stock_quantity = $1, status = $2 WHERE batch_id = $3`, [9, 'ACTIVE', 4]);

    await client.query(`
        INSERT INTO sale_items (sale_id, batch_id, quantity, sell_price, total_price, dose_per_admin, frequency_code, duration_days, route_of_admin, required_qty, dispensing_unit, counseling_note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [saleId, 4, 1, 100, 100, 1, 'BID', 7, 'PO', 14, 'pills', 'Test note']);
    
    await client.query(`
        INSERT INTO stock_movements (batch_id, user_id, movement_type, quantity, previous_stock, new_stock, reference_id, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [4, current_user_id, 'SALE', 1, 10, 9, saleId, 'POS Sale']);
        
    await client.query(`
      INSERT INTO audit_logs (user_id, action, table_name, record_id, description)
      VALUES ($1, 'SALE', 'sales', $2, $3)
    `, [current_user_id, saleId, `Sale of ${items.length} items, total ${calculatedTotal}`]);
    
    await client.query('ROLLBACK');
    console.log('Transaction succeeded (rolled back)!');
  } catch (e) {
    console.error('Transaction failed:', e.message);
  } finally {
    client.release();
    process.exit();
  }
}
run();
