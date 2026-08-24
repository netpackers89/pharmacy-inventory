require('dotenv').config({ path: './.env' });
const { getClient } = require('./src/config/db');

async function run() {
  const client = await getClient();
  try {
    const saleId = 1;
    const current_user_id = 1;
    const calculatedTotal = 100;
    const items = [1];
    await client.query(`
      INSERT INTO audit_logs (user_id, action, table_name, record_id, description)
      VALUES ($1, 'SALE', 'sales', $2, $3)
    `, [current_user_id, saleId, `Sale of ${items.length} items, total ${calculatedTotal}`]);
    console.log('Insert succeeded!');
  } catch (e) {
    console.error('Insert failed:', e.message);
  } finally {
    client.release();
    process.exit();
  }
}
run();
