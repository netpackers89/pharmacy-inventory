const db = require('../config/db');

exports.getAllSales = async (req, res) => {
  try {
    const salesRes = await db.query(`
      SELECT s.*, u.username as pharmacist_name,
        COUNT(si.sale_item_id) as item_count
      FROM sales s
      LEFT JOIN users u ON s.user_id = u.user_id
      LEFT JOIN sale_items si ON s.sale_id = si.sale_id
      GROUP BY s.sale_id, u.username
      ORDER BY s.sale_date DESC
    `);

    const revenueRes = await db.query('SELECT SUM(total_amount) as total_revenue FROM sales');
    const totalRevenue = revenueRes.rows[0].total_revenue || 0.0;

    res.json({
      total_revenue: parseFloat(totalRevenue).toFixed(2),
      sales: salesRes.rows
    });
  } catch (err) {
    console.error('Error fetching sales:', err);
    res.status(500).json({ error: 'Failed to retrieve sales records' });
  }
};

exports.getSaleDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const saleRes = await db.query(`
      SELECT s.*, u.username as pharmacist_name
      FROM sales s
      LEFT JOIN users u ON s.user_id = u.user_id
      WHERE s.sale_id = $1
    `, [id]);

    if (saleRes.rows.length === 0) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const itemsRes = await db.query(`
      SELECT si.*, b.batch_number, m.brand_name, m.generic_name, m.strength
      FROM sale_items si
      JOIN batches b ON si.batch_id = b.batch_id
      JOIN medicines m ON b.medicine_id = m.medicine_id
      WHERE si.sale_id = $1
    `, [id]);

    res.json({
      sale: saleRes.rows[0],
      items: itemsRes.rows
    });
  } catch (err) {
    console.error('Error fetching sale details:', err);
    res.status(500).json({ error: 'Failed to retrieve sale details' });
  }
};

exports.createSale = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    // items is an array of { medicine_id, quantity, dose_per_admin, frequency_code, duration_days, route_of_admin, required_qty, dispensing_unit, counseling_note }
    const { user_id, items, payment_method, override_reason } = req.body;
    const current_user_id = user_id || (req.user && req.user.user_id) || 1;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('Cart must contain at least one medicine');
    }

    let calculatedTotal = 0.0;
    const saleItemsRecords = [];
    const stockMovementsRecords = [];
    const batchUpdates = [];

    for (const item of items) {
      const medId = item.medicine_id;
      let qtyNeeded = parseInt(item.quantity || 1, 10);

      // Find eligible batches for this medicine (FEFO order)
      const batchesRes = await client.query(`
        SELECT batch_id, stock_quantity, sell_price 
        FROM batches
        WHERE medicine_id = $1 AND stock_quantity > 0 AND status = 'ACTIVE'
        ORDER BY expiry_date ASC
      `, [medId]);

      let remaining = qtyNeeded;
      for (const batch of batchesRes.rows) {
        if (remaining <= 0) break;

        let qtyToTake = 0;
        let previous_stock = batch.stock_quantity;
        let new_stock = 0;

        if (batch.stock_quantity >= remaining) {
          qtyToTake = remaining;
          new_stock = batch.stock_quantity - remaining;
          remaining = 0;
        } else {
          qtyToTake = batch.stock_quantity;
          new_stock = 0;
          remaining -= batch.stock_quantity;
        }

        const itemTotal = parseFloat(batch.sell_price) * qtyToTake;
        calculatedTotal += itemTotal;

        batchUpdates.push({
          batch_id: batch.batch_id,
          new_stock: new_stock,
          status: new_stock === 0 ? 'DEPLETED' : 'ACTIVE'
        });

        saleItemsRecords.push({
          batch_id: batch.batch_id,
          quantity: qtyToTake,
          sell_price: batch.sell_price,
          total_price: itemTotal,
          dose_per_admin: item.dose_per_admin || null,
          frequency_code: item.frequency_code || null,
          duration_days: item.duration_days || null,
          route_of_admin: item.route_of_admin || null,
          required_qty: item.required_qty || null,
          dispensing_unit: item.dispensing_unit || null,
          counseling_note: item.counseling_note || null
        });

        stockMovementsRecords.push({
          batch_id: batch.batch_id,
          quantity: -qtyToTake,
          previous_stock: previous_stock,
          new_stock: new_stock
        });
      }

      if (remaining > 0) {
        throw new Error('Insufficient stock for medicine ID ' + medId);
      }
    }

    // Insert sale header
    console.log("Executing sales insert...");
    const saleResult = await client.query(`
      INSERT INTO sales (user_id, total_amount, subtotal, payment_method, override_reason)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING sale_id
    `, [current_user_id, calculatedTotal, calculatedTotal, payment_method || 'CASH', override_reason || null]);

    const saleId = saleResult.rows[0].sale_id;

    // Apply batch updates and insert sale_items and stock_movements
    for (const bu of batchUpdates) {
        await client.query(`UPDATE batches SET stock_quantity = $1, status = $2, updated_at=NOW() WHERE batch_id = $3`, [bu.new_stock, bu.status, bu.batch_id]);
    }

    for (const si of saleItemsRecords) {
        await client.query(`
            INSERT INTO sale_items (sale_id, batch_id, quantity, sell_price, total_price, dose_per_admin, frequency_code, duration_days, route_of_admin, required_qty, dispensing_unit, counseling_note)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
            saleId, si.batch_id, si.quantity, si.sell_price, si.total_price,
            si.dose_per_admin, si.frequency_code, si.duration_days, si.route_of_admin,
            si.required_qty, si.dispensing_unit, si.counseling_note
        ]);
    }

    for (const sm of stockMovementsRecords) {
        // Fetch medicine_id for this batch to enrich stock_movements
        const medRow = await client.query(`SELECT medicine_id FROM batches WHERE batch_id=$1`, [sm.batch_id]);
        const medicine_id = medRow.rows[0]?.medicine_id || null;
        await client.query(`
            INSERT INTO stock_movements (medicine_id, batch_id, user_id, movement_type, quantity, previous_stock, new_stock, reference_type, reference_id, notes)
            VALUES ($1, $2, $3, 'SALE', $4, $5, $6, 'SALE', $7, 'POS Sale')
        `, [medicine_id, sm.batch_id, current_user_id, sm.quantity, sm.previous_stock, sm.new_stock, saleId]);
    }

    // Audit log — inside the same transaction for atomicity
    await client.query(`
      INSERT INTO audit_logs (user_id, action, module, table_name, record_id, entity_type, entity_id, description, new_values, ip_address, user_agent, status)
      VALUES ($1, 'SALE', 'POS', 'sales', $2, 'sale', $2, $3, $4, $5, $6, 'SUCCESS')
    `, [
      current_user_id,
      saleId,
      `Sale completed — ${saleItemsRecords.length} item(s), total ${calculatedTotal} ETB`,
      JSON.stringify({ total_amount: calculatedTotal, item_count: saleItemsRecords.length, payment_method }),
      req.ipAddress || null,
      req.userAgent || null
    ]);

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Sale completed successfully',
      sale_id: saleId,
      total_amount: calculatedTotal
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating sale:', err);
    // Log failed sale attempt (outside transaction since it was rolled back)
    try {
      await db.query(`
        INSERT INTO audit_logs (user_id, action, module, table_name, description, status)
        VALUES ($1, 'SALE', 'POS', 'sales', $2, 'FAILED')
      `, [
        req.body?.user_id || null,
        `Sale failed: ${err.message}`
      ]);
    } catch (_) {}
    res.status(500).json({ error: err.message || 'Failed to process sale' });
  } finally {
    client.release();
  }
};

exports.getDashboardStats = async (req, res) => {
  try {
    const salesRes = await db.query(`SELECT s.*, u.username as pharmacist_name FROM sales s LEFT JOIN users u ON s.user_id = u.user_id ORDER BY s.sale_date DESC`);
    const sales = salesRes.rows || [];

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const chartData = days.map(day => ({ day, sales: 0 }));

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    sales.forEach(sale => {
      const saleDate = new Date(sale.sale_date);
      if (saleDate >= oneWeekAgo) {
        const dayName = days[saleDate.getDay()];
        const dayData = chartData.find(d => d.day === dayName);
        if (dayData) {
          dayData.sales += parseFloat(sale.total_amount || 0);
        }
      }
    });
    
    // Quick summary stats
    const totalMedsRes = await db.query('SELECT COUNT(*) as count FROM medicines');
    const outOfStockRes = await db.query("SELECT COUNT(*) as count FROM (SELECT medicine_id FROM batches GROUP BY medicine_id HAVING SUM(stock_quantity) = 0) as sub");
    const expiringSoonRes = await db.query("SELECT COUNT(*) as count FROM batches WHERE expiry_date <= CURRENT_DATE + INTERVAL '30 days' AND expiry_date >= CURRENT_DATE AND stock_quantity > 0");
    
    res.json({
      chartData,
      totalMeds: totalMedsRes.rows[0].count,
      outOfStock: outOfStockRes.rows[0].count,
      expiringSoon: expiringSoonRes.rows[0].count
    });
  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
};
