const db = require('../config/db');
const { getIO } = require('../socket');

/* Packaging units supported by NET-PHARMA (configurable conversions — never hard-coded assumptions). */
const PACKAGING_UNITS = {
  SINGLE_DOSE: 'Single Dose',
  STRIP:       'Strip',
  INNER_BOX:   'Inner Box',
  OUTER_BOX:   'Outer Box',
};

// Add stock to an existing drug
// Workflow: Find Medicine -> Find Batch -> Update/Create Batch -> Create Movement
exports.addStock = async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const {
            medicine_id,
            supplier_id,
            batch_number,
            manufacture_date,
            expiry_date,
            quantity,
            user_id,
            barcode,
            qr_code,
            abc_category,
            ven_category,
            // Packaging system:
            packaging_unit = 'SINGLE_DOSE',
            units_per_package,      // single doses contained in ONE selected unit
            buy_price,              // purchase price PER SELECTED UNIT
            sell_price              // selling price PER SELECTED UNIT
        } = req.body;

        const current_user_id = req.user && req.user.user_id;

        if (!current_user_id) {
            return res.status(401).json({ error: 'Authenticated staff account required' });
        }

        /* ── Validation: never save ambiguous stock ── */
        const unitKey = String(packaging_unit || '').toUpperCase();
        if (!PACKAGING_UNITS[unitKey]) {
            throw Object.assign(new Error('Packaging unit is missing or not supported.'), { status: 400 });
        }
        const unitsReceived = parseInt(quantity, 10);
        if (!Number.isFinite(unitsReceived) || unitsReceived <= 0) {
            throw Object.assign(new Error('Units received must be a positive whole number.'), { status: 400 });
        }
        const dosesPerUnit = Math.floor(Number(units_per_package));
        if (!Number.isFinite(dosesPerUnit) || dosesPerUnit < 1) {
            throw Object.assign(new Error('Single doses per selected unit must be at least 1.'), { status: 400 });
        }
        const buyPerUnit = parseFloat(buy_price);
        const sellPerUnit = parseFloat(sell_price);
        if (!Number.isFinite(buyPerUnit) || buyPerUnit <= 0) {
            throw Object.assign(new Error('Purchase price per selected unit is required.'), { status: 400 });
        }
        if (!Number.isFinite(sellPerUnit) || sellPerUnit <= 0) {
            throw Object.assign(new Error('Selling price per selected unit is required.'), { status: 400 });
        }
        if (sellPerUnit < buyPerUnit * 0.2) {
            // soft sanity guard against obvious data entry errors
            throw Object.assign(new Error('Selling price looks unrealistically low compared to the purchase price. Please review.'), { status: 400 });
        }

        const totalSingleDoses = unitsReceived * dosesPerUnit;
        // Stock is tracked in SINGLE DOSES so existing FEFO deduction logic stays correct.
        const stockDelta = totalSingleDoses;
        // Per-single-dose prices are derived on read: price / units_per_package.
        const buyPriceStored = buyPerUnit / dosesPerUnit;
        const sellPriceStored = sellPerUnit / dosesPerUnit;

        // Verify Medicine exists
        const medResult = await client.query(`SELECT medicine_id, generic_name, brand_name FROM medicines WHERE medicine_id = $1`, [medicine_id]);
        if (medResult.rows.length === 0) {
            throw new Error('Medicine not found');
        }

        // Check if Batch exists for this medicine
        const batchResult = await client.query(`
            SELECT batch_id, stock_quantity, packaging_unit, units_per_package
            FROM batches
            WHERE medicine_id = $1 AND batch_number = $2
        `, [medicine_id, batch_number]);

        let batch_id;
        let previous_stock = 0;
        let new_stock = stockDelta;

        if (batchResult.rows.length > 0) {
            // Batch exists: Update
            const existing = batchResult.rows[0];
            if (existing.packaging_unit && existing.packaging_unit !== unitKey) {
                throw Object.assign(
                    new Error(`This batch was received as ${PACKAGING_UNITS[existing.packaging_unit] || existing.packaging_unit}. Use the same packaging unit or a different batch number.`),
                    { status: 400 }
                );
            }
            batch_id = existing.batch_id;
            previous_stock = existing.stock_quantity;
            new_stock = previous_stock + stockDelta;

            await client.query(`
                UPDATE batches
                SET stock_quantity = $1, buy_price = $2, sell_price = $3,
                    single_doses_received = COALESCE(single_doses_received, 0) + $4,
                    updated_at = CURRENT_TIMESTAMP
                WHERE batch_id = $5
            `, [new_stock, buyPriceStored, sellPriceStored, stockDelta, batch_id]);
        } else {
            // Batch does not exist: Create
            const insertBatch = `
                INSERT INTO batches (
                    medicine_id, supplier_id, batch_number, manufacture_date,
                    expiry_date, buy_price, sell_price, stock_quantity, barcode, qr_code, abc_category, ven_category,
                    packaging_unit, units_per_package, single_doses_received
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                RETURNING batch_id
            `;
            const newBatch = await client.query(insertBatch, [
                medicine_id, supplier_id, batch_number, manufacture_date || null,
                expiry_date, buyPriceStored, sellPriceStored, stockDelta, barcode, qr_code, abc_category, ven_category,
                unitKey, dosesPerUnit, stockDelta
            ]);
            batch_id = newBatch.rows[0].batch_id;
        }

        // Create Stock Movement with enriched columns
        await client.query(`
            INSERT INTO stock_movements (
                medicine_id, batch_id, user_id, movement_type, quantity,
                previous_stock, new_stock, reference_type, notes
            ) VALUES ($1, $2, $3, 'RESUPPLY', $4, $5, $6, 'RESUPPLY', $7)
        `, [
            medicine_id, batch_id, current_user_id, stockDelta, previous_stock, new_stock,
            `Resupply: ${unitsReceived} ${PACKAGING_UNITS[unitKey]}${unitsReceived > 1 ? 's' : ''} × ${dosesPerUnit} dose(s) = ${totalSingleDoses} single doses added`
        ]);

        // Audit log inside the transaction
        await client.query(`
          INSERT INTO audit_logs (user_id, action, module, table_name, record_id, entity_type, entity_id, description, new_values, ip_address, user_agent, status)
          VALUES ($1, 'STOCK_RECEIVED', 'INVENTORY', 'batches', $2, 'batch', $2, $3, $4, $5, $6, 'SUCCESS')
        `, [
          current_user_id,
          batch_id,
          `Resupply: Added ${unitsReceived} ${PACKAGING_UNITS[unitKey]}(s) of ${medResult.rows[0].generic_name} (${totalSingleDoses} single doses, Batch: ${batch_number})`,
          JSON.stringify({
            medicine_id, batch_id, packaging_unit: unitKey,
            units_received: unitsReceived, doses_per_unit: dosesPerUnit,
            single_doses_added: totalSingleDoses,
            purchase_price_per_unit: buyPerUnit, selling_price_per_unit: sellPerUnit,
            purchase_price_per_dose: parseFloat(buyPriceStored.toFixed(4)),
            selling_price_per_dose: parseFloat(sellPriceStored.toFixed(4)),
            previous_stock, new_stock
          }),
          req.ipAddress || null,
          req.userAgent || null
        ]);

        await client.query('COMMIT');
        // Real-time: refresh stock everywhere (POS, dashboard, reports).
        try { getIO().emit('data_updated', { topic: 'stock' }); } catch (_) {}
        res.status(200).json({
            message: 'Stock added successfully',
            batch_id,
            packaging: {
                unit: unitKey,
                units_received: unitsReceived,
                doses_per_unit: dosesPerUnit,
                total_single_doses: totalSingleDoses,
                purchase_price_per_unit: buyPerUnit,
                selling_price_per_unit: sellPerUnit,
                purchase_price_per_dose: parseFloat(buyPriceStored.toFixed(4)),
                selling_price_per_dose: parseFloat(sellPriceStored.toFixed(4)),
            },
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[ADD_STOCK]', err.message);
        res.status(err.status || 500).json({ error: err.message || 'Failed to add stock' });
    } finally {
        client.release();
    }
};

// Get medicine-level total stock
exports.getStock = async (req, res) => {
    try {
        const { search } = req.query;

        if (search) {
            const normalized = String(search).trim();
            const likeValue = `%${normalized}%`;

            const result = await db.query(`
                SELECT
                    b.batch_id,
                    m.medicine_id,
                    m.generic_name,
                    m.brand_name,
                    m.strength,
                    COALESCE(m.prescription_type, 'OTC') AS prescription_type,
                    b.batch_number,
                    b.expiry_date,
                    b.barcode,
                    b.qr_code,
                    b.stock_quantity AS stock_on_hand,
                    b.sell_price AS current_price,
                    b.packaging_unit,
                    b.units_per_package AS strip_size,
                    (b.stock_quantity / GREATEST(b.units_per_package, 1)) AS units_available,
                    b.status
                FROM batches b
                JOIN medicines m ON m.medicine_id = b.medicine_id
                WHERE b.status != 'INACTIVE'
                  AND (
                    REPLACE(REPLACE(LOWER(CAST(b.barcode AS TEXT)), ' ', ''), '-', '') = REPLACE(REPLACE(LOWER($1), ' ', ''), '-', '')
                    OR REPLACE(REPLACE(LOWER(CAST(b.qr_code AS TEXT)), ' ', ''), '-', '') = REPLACE(REPLACE(LOWER($1), ' ', ''), '-', '')
                    OR REPLACE(REPLACE(LOWER(CAST(b.batch_number AS TEXT)), ' ', ''), '-', '') = REPLACE(REPLACE(LOWER($1), ' ', ''), '-', '')
                    OR LOWER(m.generic_name) LIKE LOWER($2)
                    OR LOWER(m.brand_name) LIKE LOWER($2)
                    OR LOWER(m.strength) LIKE LOWER($2)
                    OR REPLACE(REPLACE(LOWER(CAST(b.batch_number AS TEXT)), ' ', ''), '-', '') LIKE REPLACE(REPLACE(LOWER($2), ' ', ''), '-', '')
                  )
                ORDER BY b.expiry_date ASC, m.generic_name ASC
                LIMIT 50
            `, [normalized, likeValue]);

            return res.json(result.rows);
        }

        const result = await db.query(`
            SELECT
                m.medicine_id,
                m.generic_name,
                m.brand_name,
                m.strength,
                COALESCE(m.prescription_type, 'OTC') AS prescription_type,
                COALESCE(SUM(b.stock_quantity), 0) AS stock_on_hand,
                (
                    SELECT b2.sell_price
                    FROM batches b2
                    WHERE b2.medicine_id = m.medicine_id
                      AND b2.stock_quantity > 0
                      AND b2.status = 'ACTIVE'
                    ORDER BY b2.expiry_date ASC
                    LIMIT 1
                ) AS current_price,
                (
                    SELECT b3.packaging_unit
                    FROM batches b3
                    WHERE b3.medicine_id = m.medicine_id
                      AND b3.stock_quantity > 0
                      AND b3.status = 'ACTIVE'
                    ORDER BY b3.expiry_date ASC
                    LIMIT 1
                ) AS packaging_unit,
                (
                    SELECT GREATEST(b4.units_per_package, 1)
                    FROM batches b4
                    WHERE b4.medicine_id = m.medicine_id
                      AND b4.stock_quantity > 0
                      AND b4.status = 'ACTIVE'
                    ORDER BY b4.expiry_date ASC
                    LIMIT 1
                ) AS strip_size,
                m.status
            FROM medicines m
            LEFT JOIN batches b ON m.medicine_id = b.medicine_id AND b.status != 'INACTIVE'
            GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.prescription_type, m.status
            ORDER BY m.generic_name ASC
        `);

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

// Get batch-level physical stock (Bin Card)
exports.getBinCard = async (req, res) => {
    try {
        const result = await db.query(`
            SELECT b.batch_id, m.generic_name as drug_name, b.batch_number,
                   s.name as supplier, b.expiry_date, b.stock_quantity,
                   b.buy_price, b.sell_price,
                   (b.stock_quantity * b.sell_price) as valuation,
                   b.packaging_unit, b.units_per_package,
                   (b.stock_quantity / GREATEST(b.units_per_package, 1)) as units_available
            FROM batches b
            JOIN medicines m ON b.medicine_id = m.medicine_id
            JOIN suppliers s ON b.supplier_id = s.supplier_id
            WHERE b.status != 'INACTIVE'
            ORDER BY b.expiry_date ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

// Get complete stock movement history
exports.getMovements = async (req, res) => {
    try {
        const result = await db.query(`
            SELECT sm.movement_id, sm.movement_date, m.generic_name as drug_name, b.batch_number,
                   sm.movement_type, sm.quantity, sm.previous_stock, sm.new_stock,
                   u.full_name as user_name, sm.notes as reference
            FROM stock_movements sm
            JOIN batches b ON sm.batch_id = b.batch_id
            JOIN medicines m ON b.medicine_id = m.medicine_id
            JOIN users u ON sm.user_id = u.user_id
            ORDER BY sm.movement_date DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

// Adjust physical stock count (legacy single-batch endpoint)
exports.adjustStock = async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { batch_id, physical_count, user_id, reason, notes } = req.body;
        const current_user_id = req.user && req.user.user_id;

        if (!current_user_id) {
            return res.status(401).json({ error: 'Authenticated staff account required' });
        }

        // Lock the row
        const batchResult = await client.query(`SELECT b.stock_quantity, b.medicine_id FROM batches b WHERE b.batch_id = $1 FOR UPDATE`, [batch_id]);
        if (batchResult.rows.length === 0) throw new Error('Batch not found');
        
        const previous_stock = batchResult.rows[0].stock_quantity;
        const medicine_id = batchResult.rows[0].medicine_id;
        const variance = physical_count - previous_stock;

        await client.query(`UPDATE batches SET stock_quantity = $1, updated_at=NOW() WHERE batch_id = $2`, [physical_count, batch_id]);
            
        await client.query(`
            INSERT INTO stock_movements (medicine_id, batch_id, user_id, movement_type, quantity, previous_stock, new_stock, reference_type, reason, notes)
            VALUES ($1, $2, $3, 'PHYSICAL_COUNT', $4, $5, $6, 'PHYSICAL_COUNT', $7, $8)
        `, [medicine_id, batch_id, current_user_id, variance, previous_stock, physical_count,
            reason || 'Physical count adjustment', notes || null]);

        await client.query(`
          INSERT INTO audit_logs (user_id, action, module, table_name, record_id, entity_type, entity_id, description, old_values, new_values, ip_address, user_agent, status)
          VALUES ($1, 'PHYSICAL_COUNT', 'INVENTORY', 'batches', $2, 'batch', $2, $3, $4, $5, $6, $7, 'SUCCESS')
        `, [
          current_user_id, batch_id,
          `Physical count: system=${previous_stock}, physical=${physical_count}, variance=${variance}`,
          JSON.stringify({ stock_quantity: previous_stock }),
          JSON.stringify({ stock_quantity: physical_count, reason, variance }),
          req.ipAddress || null, req.userAgent || null
        ]);
        
        await client.query('COMMIT');
        try { getIO().emit('data_updated', { topic: 'stock' }); } catch (_) {}
        res.status(200).json({ message: 'Stock adjusted successfully', variance, previous_stock, new_stock: physical_count });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Failed to adjust stock' });
    } finally {
        client.release();
    }
};


// Get inventory alerts (near expiry, out of stock) and fast moving items
exports.getAlerts = async (req, res) => {
    try {
        // 1. Near Expiry (within 90 days)
        const nearExpiryResult = await db.query(`
            SELECT b.batch_id, m.generic_name, m.brand_name, b.batch_number, b.expiry_date, b.stock_quantity
            FROM batches b
            JOIN medicines m ON b.medicine_id = m.medicine_id
            WHERE b.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
            AND b.expiry_date > CURRENT_DATE
            AND b.status = 'ACTIVE'
            ORDER BY b.expiry_date ASC
        `);

        // 2. Out of Stock / Low Stock
        const outOfStockResult = await db.query(`
            SELECT m.medicine_id, m.generic_name, m.brand_name, 
                   SUM(b.stock_quantity) as total_stock,
                   MIN(b.minimum_stock) as min_stock
            FROM medicines m
            LEFT JOIN batches b ON m.medicine_id = b.medicine_id AND b.status = 'ACTIVE'
            GROUP BY m.medicine_id, m.generic_name, m.brand_name
            HAVING SUM(COALESCE(b.stock_quantity, 0)) <= 10 -- Default threshold if minimum_stock not set or used
            OR SUM(COALESCE(b.stock_quantity, 0)) <= MIN(COALESCE(b.minimum_stock, 0))
        `);

        // 3. Fast Moving Items (Top 5)
        const fastMovingResult = await db.query(`
            SELECT m.brand_name, c.name as category, SUM(si.quantity) as total_sold
            FROM sale_items si
            JOIN batches b ON si.batch_id = b.batch_id
            JOIN medicines m ON b.medicine_id = m.medicine_id
            LEFT JOIN categories c ON m.category_id = c.category_id
            GROUP BY m.medicine_id, m.brand_name, c.name
            ORDER BY total_sold DESC
            LIMIT 5
        `);

        res.json({
            nearExpiryItems: nearExpiryResult.rows,
            nearExpiryCount: nearExpiryResult.rows.length,
            outOfStockItems: outOfStockResult.rows,
            outOfStockCount: outOfStockResult.rows.length,
            fastMoving: fastMovingResult.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

exports.getBinCardIndex = async (req, res) => {
    try {
        const { search, status } = req.query;
        let searchParam = search ? `%${search.toLowerCase()}%` : null;
        const result = await db.query(`
            SELECT 
              m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form,
              COALESCE(m.reorder_level, 0) as reorder_level, m.status,
              COUNT(DISTINCT b.batch_id) as batch_count,
              COALESCE(SUM(b.stock_quantity), 0) as total_stock,
              MIN(b.expiry_date) as earliest_expiry,
              c.name as category_name,
              CASE 
                WHEN COUNT(DISTINCT b.batch_id) = 0 THEN 'NO STOCK YET'
                WHEN COALESCE(SUM(b.stock_quantity), 0) = 0 THEN 'OUT'
                WHEN COALESCE(SUM(b.stock_quantity), 0) <= COALESCE(m.reorder_level, 0) THEN 'LOW'
                ELSE 'OK'
              END as stock_status
            FROM medicines m
            LEFT JOIN batches b ON m.medicine_id = b.medicine_id AND b.status != 'INACTIVE'
            LEFT JOIN categories c ON m.category_id = c.category_id
            WHERE ($1::text IS NULL OR LOWER(m.generic_name) LIKE $1 OR LOWER(m.brand_name) LIKE $1)
            GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.reorder_level, m.status, c.name
            ORDER BY m.generic_name ASC
        `, [searchParam, search]);
        
        let filtered = result.rows;
        if (status && status !== 'ALL') {
            filtered = filtered.filter(row => row.stock_status === status);
        }
        res.json(filtered);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

exports.getBinCardDetail = async (req, res) => {
    try {
        const { medicine_id } = req.params;
        // Filters from query string
        const { batch_id, from_date, to_date, movement_type, user_id, order = 'ASC' } = req.query;
        const sortDir = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

        const medResult = await db.query(`
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
        `, [medicine_id]);

        if (medResult.rows.length === 0) {
            return res.status(404).json({ error: 'Medicine not found' });
        }
        
        // Build dynamic WHERE clauses for ledger filters
        const conditions = ['b.medicine_id = $1'];
        const params = [medicine_id];
        let i = 2;
        if (batch_id) { conditions.push(`sm.batch_id = $${i++}`); params.push(batch_id); }
        if (from_date) { conditions.push(`sm.movement_date >= $${i++}`); params.push(from_date); }
        if (to_date) { conditions.push(`sm.movement_date <= $${i++} + INTERVAL '1 day'`); params.push(to_date); }
        if (movement_type) { conditions.push(`sm.movement_type = $${i++}`); params.push(movement_type); }
        if (user_id) { conditions.push(`sm.user_id = $${i++}`); params.push(user_id); }

        const ledgerResult = await db.query(`
            SELECT 
              sm.movement_id,
              sm.movement_date,
              sm.movement_type,
              sm.reference_type,
              sm.reference_id,
              sm.reason,
              b.batch_number,
              b.expiry_date as batch_expiry,
              CASE WHEN sm.quantity > 0 AND sm.movement_type NOT IN ('ADJUSTMENT','PHYSICAL_COUNT') THEN sm.quantity ELSE 0 END as stock_in,
              CASE WHEN sm.quantity < 0 AND sm.movement_type NOT IN ('ADJUSTMENT','PHYSICAL_COUNT') THEN ABS(sm.quantity) ELSE 0 END as stock_out,
              CASE WHEN sm.movement_type IN ('ADJUSTMENT','PHYSICAL_COUNT') THEN sm.quantity ELSE 0 END as adjustment,
              sm.previous_stock as balance_before,
              sm.new_stock as balance,
              s.name as source,
              u.full_name as user_name,
              u.username,
              sm.notes
            FROM stock_movements sm
            JOIN batches b ON sm.batch_id = b.batch_id
            LEFT JOIN suppliers s ON b.supplier_id = s.supplier_id
            LEFT JOIN users u ON sm.user_id = u.user_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY sm.movement_date ${sortDir}, sm.movement_id ${sortDir}
            LIMIT 500
        `, params);


        const batchesResult = await db.query(`
            SELECT b.batch_id, b.batch_number, b.stock_quantity, b.expiry_date, s.name as supplier_name,
                   b.barcode, b.qr_code, b.abc_category, b.ven_category,
                   b.packaging_unit, b.units_per_package,
                   (b.stock_quantity / GREATEST(b.units_per_package, 1)) as units_available
            FROM batches b
            LEFT JOIN suppliers s ON b.supplier_id = s.supplier_id
            WHERE b.medicine_id = $1 AND b.status != 'INACTIVE'
            ORDER BY b.expiry_date ASC
        `, [medicine_id]);

        res.json({
            medicine: medResult.rows[0],
            ledger: ledgerResult.rows,
            batches: batchesResult.rows
        });
    } catch (err) {
        console.error('BinCardDetail Error:', err);
        res.status(500).json({ error: 'Database error in getBinCardDetail' });
    }
};

exports.getWhatToBuy = async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
              m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form,
              COALESCE(m.reorder_level, 0) as reorder_level, COALESCE(m.max_level, COALESCE(m.reorder_level, 0) + 10) as max_level,
              MAX(b.abc_category) as abc_category, MAX(b.ven_category) as ven_category,
              COALESCE(SUM(b.stock_quantity), 0) as current_stock,
              GREATEST(0, COALESCE(m.max_level, COALESCE(m.reorder_level, 0) + 10) - COALESCE(SUM(b.stock_quantity), 0)) as suggested_qty,
              MIN(b.expiry_date) as earliest_expiry,
              c.name as category_name,
              (SELECT s.name FROM suppliers s JOIN batches b2 ON b2.supplier_id = s.supplier_id WHERE b2.medicine_id = m.medicine_id ORDER BY b2.created_at DESC LIMIT 1) as last_supplier,
              (SELECT b3.buy_price FROM batches b3 WHERE b3.medicine_id = m.medicine_id ORDER BY b3.created_at DESC LIMIT 1) as last_buy_price
            FROM medicines m
            LEFT JOIN batches b ON b.medicine_id = m.medicine_id AND b.status != 'INACTIVE'
            LEFT JOIN categories c ON m.category_id = c.category_id
            WHERE m.status = 'ACTIVE'
            GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.reorder_level, m.max_level, c.name
            HAVING COALESCE(SUM(b.stock_quantity), 0) <= COALESCE(m.reorder_level, 0)
            ORDER BY 
              CASE MAX(b.ven_category) WHEN 'V' THEN 1 WHEN 'E' THEN 2 WHEN 'N' THEN 3 ELSE 4 END,
              CASE MAX(b.abc_category) WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
              current_stock ASC
        `);

        const rows = result.rows.map(row => {
            const v = row.ven_category;
            const a = row.abc_category;
            let priority = 'NORMAL';
            
            if (v === 'V' && (a === 'A' || a === 'B' || a === 'C')) priority = 'CRITICAL';
            else if (v === 'E' && a === 'A') priority = 'HIGH';
            else if (v === 'E' && (a === 'B' || a === 'C')) priority = 'MEDIUM';
            else if (v === 'N' && a === 'A') priority = 'HIGH';
            else if (v === 'N' && (a === 'B' || a === 'C')) priority = 'LOW';

            return { ...row, priority };
        });

        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

exports.adjustStockBulk = async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { adjustments, user_id } = req.body;
        const current_user_id = req.user && req.user.user_id;

        if (!current_user_id) {
            return res.status(401).json({ error: 'Authenticated staff account required' });
        }

        for (const adj of adjustments) {
            const { batch_id, physical_count } = adj;
            
            const batchResult = await client.query(`SELECT stock_quantity FROM batches WHERE batch_id = $1`, [batch_id]);
            if (batchResult.rows.length === 0) continue;
            
            const previous_stock = batchResult.rows[0].stock_quantity;
            const difference = physical_count - previous_stock;

            if (difference !== 0) {
                await client.query(`UPDATE batches SET stock_quantity = $1 WHERE batch_id = $2`, [physical_count, batch_id]);
                
                const timestamp = Date.now().toString().slice(-4);
                const countRef = `COUNT-${new Date().getFullYear()}-${timestamp}`;

                await client.query(`
                    INSERT INTO stock_movements (batch_id, user_id, movement_type, quantity, previous_stock, new_stock, notes)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [batch_id, current_user_id, 'ADJUSTMENT', difference, previous_stock, physical_count, `Full Stock Count: ${countRef}`]);
            }
        }
        
        await client.query('COMMIT');
        try { getIO().emit('data_updated', { topic: 'stock' }); } catch (_) {}
        res.status(200).json({ message: 'Stock adjustments processed successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk adjustment error:', err);
        res.status(500).json({ error: 'Failed to process stock adjustments' });
    } finally {
        client.release();
    }
};
