const db = require('../config/db');
const { getIO } = require('../socket');

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

/*
 * FREQUENCY table mirrors the POS frontend so the backend can re-validate
 * prescription math independently of React.
 */
const FREQUENCY_PER_DAY = {
  QD: 1, BID: 2, TID: 3, QID: 4, QOD: 0.5, Q4H: 6, Q6H: 4,
  Q8H: 3, Q12H: 2, QW: 1 / 7, BIW: 2 / 7,
};

exports.createSale = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    /*
     * IDENTITY: the selling user ALWAYS comes from the authenticated token.
     * A user_id in the request body is ignored — the frontend is never
     * trusted to declare who performed a transaction.
     */
    const current_user_id = req.user && req.user.user_id;
    if (!current_user_id) {
      throw new Error('Authenticated staff account required for sales');
    }

    const { items, payment_method, override_reason, operation_id } = req.body;

    // ── Idempotency: retrying the same checkout can never double-sell ──────
    let existingSale = null;
    if (operation_id) {
      const dup = await client.query(
        `SELECT sale_id, total_amount FROM sales WHERE operation_id = $1 LIMIT 1`,
        [String(operation_id)]
      );
      if (dup.rows.length > 0) {
        existingSale = dup.rows[0];
      }
    }

    if (existingSale) {
      // Roll back nothing — we have not written anything yet.
      await client.query('ROLLBACK');
      return res.status(200).json({
        message: 'Sale already processed (idempotent replay)',
        sale_id: existingSale.sale_id,
        total_amount: parseFloat(existingSale.total_amount),
        duplicate: true,
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('Cart must contain at least one medicine');
    }

    let calculatedTotal = 0.0;
    const saleItemsRecords = [];
    const stockMovementsRecords = [];
    const batchUpdates = [];
    const controlledMedicines = [];
    const auditItemDetails = [];

    for (const item of items) {
      const medId = item.medicine_id;
      if (!medId || !Number.isInteger(Number(medId))) {
        throw new Error('Each cart item needs a valid medicine_id');
      }

      /*
       * QUANTITY: single doses to dispense. Validated as a positive integer —
       * negative or zero quantities can never create stock.
       */
      let qtyNeeded = parseInt(item.quantity, 10);
      if (!Number.isFinite(qtyNeeded) || qtyNeeded <= 0) {
        throw new Error(`Invalid quantity for medicine ID ${medId}`);
      }

      /*
       * PRESCRIPTION TYPE comes from the DATABASE, never from React.
       * The medicine record is authoritative for OTC/PRESCRIPTION/CONTROLLED.
       */
      const medRes = await client.query(
        `SELECT medicine_id, generic_name, brand_name, strength, prescription_type
           FROM medicines WHERE medicine_id = $1`,
        [medId]
      );
      if (medRes.rows.length === 0) {
        throw new Error(`Medicine ID ${medId} does not exist`);
      }
      const medicine = medRes.rows[0];
      const rxType = (medicine.prescription_type || 'OTC').toUpperCase();

      if (rxType === 'CONTROLLED') {
        // Controlled substances require documented authorization at checkout.
        if (!override_reason || !String(override_reason).trim()) {
          throw new Error(
            `Controlled medicine "${medicine.generic_name}" requires an authorization/prescription reference before dispensing`
          );
        }
        controlledMedicines.push(medicine);
      }

      if (rxType === 'PRESCRIPTION' || rxType === 'CONTROLLED') {
        // Prescription workflow must carry clinical dosing information.
        const hasDoseInfo =
          item.dose_per_admin != null &&
          item.frequency_code &&
          item.duration_days != null;
        if (!hasDoseInfo) {
          throw new Error(
            `${medicine.prescription_type === 'CONTROLLED' ? 'Controlled' : 'Prescription'} medicine "${medicine.generic_name}" needs dose, frequency and duration`
          );
        }
        // Backend re-validates the required-dose calculation (read-only rule).
        const perDay = FREQUENCY_PER_DAY[String(item.frequency_code).toUpperCase()];
        if (perDay !== undefined) {
          const expectedMin = Math.ceil(
            Number(item.dose_per_admin) * perDay * Number(item.duration_days)
          );
          if (
            Number.isFinite(expectedMin) &&
            Number(item.required_qty) > expectedMin * 1000
          ) {
            throw new Error(`Required dose for "${medicine.generic_name}" failed server-side validation`);
          }
        }
      }

      // Find eligible batches for this medicine (FEFO order — first-expired-
      // first-out). Stock can NEVER go below zero: allocation stops at what
      // exists and any shortfall aborts the whole transaction.
      const batchesRes = await client.query(`
        SELECT batch_id, stock_quantity, sell_price, units_per_package
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

        /*
         * PRICE: batches store the price PER PACKAGING UNIT (e.g. per strip)
         * while stock is counted in SINGLE DOSES — so the per-dose price is
         * derived here on the server. React never sends a price.
         */
        const unitPrice = parseFloat(batch.sell_price);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new Error(`Batch ${batch.batch_id} has an invalid price`);
        }
        const dosesPerUnit = Math.max(1, parseInt(batch.units_per_package, 10) || 1);
        const perDosePrice = unitPrice / dosesPerUnit;
        const itemTotal = perDosePrice * qtyToTake;
        calculatedTotal += itemTotal;

        batchUpdates.push({
          batch_id: batch.batch_id,
          new_stock: new_stock,
          status: new_stock === 0 ? 'DEPLETED' : 'ACTIVE'
        });

        saleItemsRecords.push({
          batch_id: batch.batch_id,
          quantity: qtyToTake,
          sell_price: perDosePrice,   // per SINGLE DOSE so qty × price = total
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

        auditItemDetails.push({
          medicine_id: medId,
          name: `${medicine.generic_name}${medicine.strength ? ` ${medicine.strength}` : ''}`,
          prescription_type: rxType,
          quantity: qtyToTake,
          price: itemTotal.toFixed(2),
        });
      }

      if (remaining > 0) {
        throw new Error(`Insufficient stock for ${medicine.generic_name} — requested ${qtyNeeded}, available ${qtyNeeded - remaining}. Stock cannot go negative.`);
      }
    }

    // Insert sale header — timestamp is generated by PostgreSQL itself.
    const saleResult = await client.query(`
      INSERT INTO sales (user_id, total_amount, subtotal, payment_method, override_reason, operation_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING sale_id, sale_date
    `, [
      current_user_id,
      calculatedTotal,
      calculatedTotal,
      ['CASH', 'CARD', 'TRANSFER', 'OTHER'].includes(payment_method) ? payment_method : 'CASH',
      override_reason || null,
      operation_id ? String(operation_id) : null
    ]);

    const saleId = saleResult.rows[0].sale_id;

    // Apply batch updates and insert sale_items and stock_movements
    for (const bu of batchUpdates) {
        await client.query(
          `UPDATE batches SET stock_quantity = $1, status = $2, updated_at=NOW() WHERE batch_id = $3`,
          [bu.new_stock, bu.status, bu.batch_id]
        );
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

    /*
     * AUDIT: real user, real database timestamp, full transaction detail.
     * Controlled medicines additionally raise a SECURITY event each.
     */
    await client.query(`
      INSERT INTO audit_logs (user_id, action, module, table_name, record_id, entity_type, entity_id, description, new_values, ip_address, user_agent, session_id, status)
      VALUES ($1, 'SALE_CREATED', 'SALES', 'sales', $2, 'sale', $2, $3, $4, $5, $6, $7, 'SUCCESS')
    `, [
      current_user_id,
      saleId,
      `Sale #${saleId} completed by ${req.user.full_name || req.user.username} — ${saleItemsRecords.length} item(s), total ETB ${calculatedTotal.toFixed(2)}${controlledMedicines.length ? ` (includes ${controlledMedicines.length} controlled medicine(s))` : ''}`,
      JSON.stringify({
        operation_id: operation_id || null,
        total_amount: calculatedTotal.toFixed(2),
        payment_method: payment_method || 'CASH',
        items: auditItemDetails,
        override_reason: override_reason || null,
      }),
      req.ipAddress || null,
      req.userAgent || null,
      req.sessionId || null
    ]);

    for (const cm of controlledMedicines) {
      await client.query(`
        INSERT INTO audit_logs (user_id, action, module, table_name, record_id, entity_type, entity_id, description, metadata, ip_address, user_agent, session_id, status)
        VALUES ($1, 'CONTROLLED_SALE', 'SECURITY', 'sales', $2, 'medicine', $3, $4, $5, $6, $7, $8, 'SUCCESS')
      `, [
        current_user_id,
        saleId,
        cm.medicine_id,
        `Controlled medicine dispensed: ${cm.generic_name}${cm.strength ? ` ${cm.strength}` : ''} (authorization documented)`,
        JSON.stringify({ medicine: cm.generic_name, sale_id: saleId }),
        req.ipAddress || null,
        req.userAgent || null,
        req.sessionId || null
      ]);
    }

    await client.query('COMMIT');

    // Real-time: every other connected client refreshes stock/reports.
    try { getIO().emit('data_updated', { topic: 'sale', sale_id: saleId }); } catch (_) {}

    res.status(201).json({
      message: 'Sale completed successfully',
      sale_id: saleId,
      total_amount: calculatedTotal,
      sale_date: saleResult.rows[0].sale_date,
      operation_id: operation_id || null
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error creating sale:', err.message);
    const isClientError = /^(Insufficient stock|Cart must|Invalid |Controlled medicine|Prescription medicine|Each cart|Authenticated staff)/.test(err.message || '');
    try {
      await db.query(`
        INSERT INTO audit_logs (user_id, action, module, table_name, description, ip_address, user_agent, session_id, status)
        VALUES ($1, 'SALE_FAILED', 'SALES', 'sales', $2, $3, $4, $5, 'FAILED')
      `, [
        (req.user && req.user.user_id) || null,
        `Sale failed: ${err.message}`,
        req.ipAddress || null,
        req.userAgent || null,
        req.sessionId || null
      ]);
    } catch (_) {}
    res.status(isClientError ? 400 : 500).json({ error: err.message || 'Failed to process sale' });
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
