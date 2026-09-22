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
// Supports server-side pagination and sorting
exports.getStock = async (req, res) => {
    try {
        const { search, page, limit, sortBy, sortOrder } = req.query;

        /* Sorting configuration */
        const sortMap = {
            generic_name: 'm.generic_name',
            brand_name: 'm.brand_name',
            stock_on_hand: 'stock_on_hand',
            nearest_expiry: 'nearest_expiry',
            last_received: 'last_received',
            created_date: 'm.created_at',
        };
        const sortColumn = sortMap[sortBy] || 'm.generic_name';
        const order = sortOrder === 'desc' ? 'DESC' : 'ASC';

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
                    m.image_url,
                    m.dosage_form,
                    COALESCE(m.prescription_type, 'OTC') AS prescription_type,
                    m.status,
                    b.batch_number,
                    b.expiry_date,
                    b.barcode,
                    b.qr_code,
                    b.stock_quantity AS stock_on_hand,
                    b.sell_price AS current_price,
                    b.packaging_unit,
                    b.units_per_package AS strip_size,
                    (b.stock_quantity / GREATEST(b.units_per_package, 1)) AS units_available,
                    b.status AS batch_status
                FROM batches b
                JOIN medicines m ON m.medicine_id = b.medicine_id
                WHERE b.status != 'INACTIVE'
                  AND m.status = 'ACTIVE'
                  AND (
                    REPLACE(REPLACE(LOWER(CAST(b.barcode AS TEXT)), ' ', ''), '-', '') = REPLACE(REPLACE(LOWER($1), ' ', ''), '-', '')
                    OR REPLACE(REPLACE(LOWER(CAST(b.qr_code AS TEXT)), ' ', ''), '-', '') = REPLACE(REPLACE(LOWER($1), ' ', ''), '-', '')
                    OR REPLACE(REPLACE(LOWER(CAST(b.batch_number AS TEXT)), ' ', ''), '-', '') = REPLACE(REPLACE(LOWER($1), ' ', ''), '-', '')
                    OR LOWER(m.generic_name) LIKE LOWER($2)
                    OR LOWER(m.brand_name) LIKE LOWER($2)
                    OR LOWER(m.strength) LIKE LOWER($2)
                    OR REPLACE(REPLACE(LOWER(CAST(b.batch_number AS TEXT)), ' ', ''), '-', '') LIKE REPLACE(REPLACE(LOWER($2), ' ', ''), '-', '')
                  )
                ORDER BY ${sortColumn} ${order}
                LIMIT 50
            `, [normalized, likeValue]);

            return res.json(result.rows);
        }

        /* Pagination mode */
        if (page && limit) {
            const limitNum = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 100);
            const pageNum = Math.max(parseInt(page, 10) || 1, 1);
            const offset = (pageNum - 1) * limitNum;

            const countRes = await db.query(
                `SELECT COUNT(*)::int AS total FROM medicines m`,
                []
            );
            const total = countRes.rows[0]?.total || 0;

            const result = await db.query(`
                SELECT
                    m.medicine_id,
                    m.generic_name,
                    m.brand_name,
                    m.strength,
                    m.image_url,
                    m.dosage_form,
                    m.created_at,
                    COALESCE(m.prescription_type, 'OTC') AS prescription_type,
                    COALESCE(SUM(b.stock_quantity), 0) AS stock_on_hand,
                    MIN(b.expiry_date) FILTER (WHERE b.status = 'ACTIVE' AND b.expiry_date >= CURRENT_DATE) AS nearest_expiry,
                    MAX(b.created_at) AS last_received,
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
                GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.created_at, m.prescription_type, m.status, m.image_url, m.dosage_form
                ORDER BY ${sortColumn} ${order} NULLS LAST, m.generic_name ASC, m.medicine_id ASC
                LIMIT ${limitNum} OFFSET ${offset}
            `);

            return res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / limitNum)),
                },
            });
        }

        /* Legacy full-list mode */
        const result = await db.query(`
            SELECT
                m.medicine_id,
                m.generic_name,
                m.brand_name,
                m.strength,
                m.created_at,
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
            WHERE m.status = 'ACTIVE'
            GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.created_at, m.prescription_type, m.status
            ORDER BY ${sortColumn} ${order} NULLS LAST, m.generic_name ASC, m.medicine_id ASC
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
// Supports server-side pagination
exports.getMovements = async (req, res) => {
    try {
        const { page, limit } = req.query;

        /* Pagination mode */
        if (page && limit) {
            const limitNum = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 100);
            const pageNum = Math.max(parseInt(page, 10) || 1, 1);
            const offset = (pageNum - 1) * limitNum;

            const countRes = await db.query(
                `SELECT COUNT(*)::int AS total FROM stock_movements`,
                []
            );
            const total = countRes.rows[0]?.total || 0;

            const result = await db.query(`
                SELECT sm.movement_id, sm.movement_date, m.generic_name as drug_name, b.batch_number,
                       sm.movement_type, sm.quantity, sm.previous_stock, sm.new_stock,
                       u.full_name as user_name, sm.notes as reference
                FROM stock_movements sm
                JOIN batches b ON sm.batch_id = b.batch_id
                JOIN medicines m ON b.medicine_id = m.medicine_id
                JOIN users u ON sm.user_id = u.user_id
                ORDER BY sm.movement_date DESC
                LIMIT ${limitNum} OFFSET ${offset}
            `);

            return res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / limitNum)),
                },
            });
        }

        /* Legacy full-list mode */
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
        `, [searchParam]);
        
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
        const { batch_id, from_date, to_date, movement_type, user_id, order = 'ASC', page, limit } = req.query;
        const sortDir = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

        const medResult = await db.query(`
            SELECT m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.route,
                   m.prescription_type, m.image_url, m.reorder_level, m.max_level, m.status,
                   c.name as category_name,
                   COALESCE(SUM(b.stock_quantity),0) as total_stock,
                   COUNT(DISTINCT b.batch_id) as batch_count,
                   MIN(b.expiry_date) FILTER (WHERE b.status != 'INACTIVE' AND b.expiry_date >= CURRENT_DATE AND b.stock_quantity > 0) as nearest_expiry,
                   SUM(CASE WHEN b.expiry_date <= CURRENT_DATE + INTERVAL '90 days' THEN 1 ELSE 0 END) as expiring_soon_count,
                   COALESCE(AVG(b.buy_price), 0) as avg_purchase_price,
                   COALESCE(SUM(b.stock_quantity * b.buy_price), 0) as stock_value
            FROM medicines m
            LEFT JOIN batches b ON b.medicine_id = m.medicine_id AND b.status != 'INACTIVE'
            LEFT JOIN categories c ON m.category_id = c.category_id
            WHERE m.medicine_id = $1
            GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.route,
                     m.prescription_type, m.image_url, m.reorder_level, m.max_level, m.status, c.name
        `, [medicine_id]);

        if (medResult.rows.length === 0) {
            return res.status(404).json({ error: 'Medicine not found' });
        }

        /* Consumption analytics: AMC (Average Monthly Consumption) is derived
           from units sold over the last 90 days ÷ 3 — batch-level sales are
           aggregated up to the medicine, never mixed into medicine master data. */
        const usageRes = await db.query(`
            SELECT
                COALESCE(SUM(si.quantity), 0)::int AS units_90d,
                (SELECT COALESCE(SUM(si2.quantity), 0)::int
                   FROM sale_items si2
                   JOIN batches b2 ON si2.batch_id = b2.batch_id
                   JOIN sales s2 ON si2.sale_id = s2.sale_id
                  WHERE b2.medicine_id = $1 AND s2.status = 'COMPLETED'
                ) AS units_all_time,
                (SELECT MAX(s3.sale_date)
                   FROM sale_items si3
                   JOIN batches b3 ON si3.batch_id = b3.batch_id
                   JOIN sales s3 ON si3.sale_id = s3.sale_id
                  WHERE b3.medicine_id = $1 AND s3.status = 'COMPLETED'
                ) AS last_sold_at
            FROM sale_items si
            JOIN batches b ON si.batch_id = b.batch_id
            JOIN sales s ON si.sale_id = s.sale_id
            WHERE b.medicine_id = $1 AND s.status = 'COMPLETED'
              AND s.sale_date >= CURRENT_DATE - INTERVAL '90 days'
        `, [medicine_id]);
        const usage = usageRes.rows[0] || {};
        const amc = Math.round(((parseInt(usage.units_90d) || 0) / 3) * 10) / 10; // units/month
        const totalStock = parseInt(medResult.rows[0].total_stock) || 0;
        const reorderLevel = parseInt(medResult.rows[0].reorder_level) || 0;
        const monthsOfCover = amc > 0 ? Math.round((totalStock / amc) * 10) / 10 : null;
        
        // Build dynamic WHERE clauses for ledger filters
        const conditions = ['b.medicine_id = $1'];
        const params = [medicine_id];
        let i = 2;
        if (batch_id) { conditions.push(`sm.batch_id = $${i++}`); params.push(batch_id); }
        if (from_date) { conditions.push(`sm.movement_date >= $${i++}`); params.push(from_date); }
        if (to_date) { conditions.push(`sm.movement_date <= $${i++} + INTERVAL '1 day'`); params.push(to_date); }
        if (movement_type) { conditions.push(`sm.movement_type = $${i++}`); params.push(movement_type); }
        if (user_id) { conditions.push(`sm.user_id = $${i++}`); params.push(user_id); }

        /* Pagination for the ledger */
        const limitNum = page && limit
            ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500)
            : 500;
        const ledgerPageNum = page && limit
            ? Math.max(parseInt(page, 10) || 1, 1)
            : 1;
        const ledgerOffset = (ledgerPageNum - 1) * limitNum;

        /* Count total ledger rows when paginating */
        let ledgerTotal = null;
        if (page && limit) {
            const countRes = await db.query(
                `SELECT COUNT(*)::int AS total FROM stock_movements sm
                 JOIN batches b ON sm.batch_id = b.batch_id
                 WHERE ${conditions.join(' AND ')}`,
                params
            );
            ledgerTotal = countRes.rows[0]?.total || 0;
        }

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
            LIMIT ${limitNum} OFFSET ${ledgerOffset}
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
                    medicine: { ...medResult.rows[0], amc, months_of_cover: monthsOfCover, units_sold_all_time: parseInt(usage.units_all_time) || 0, last_sold_at: usage.last_sold_at || null },
                    ledger: ledgerResult.rows,
                    ledgerPagination: ledgerTotal !== null ? {
                        total: ledgerTotal,
                        totalPages: Math.max(1, Math.ceil(ledgerTotal / limitNum)),
                    } : null,
                    batches: batchesResult.rows
                });
    } catch (err) {
        console.error('BinCardDetail Error:', err);
        res.status(500).json({ error: 'Database error in getBinCardDetail' });
    }
};

exports.getWhatToBuy = async (req, res) => {
    try {
        const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 18, 1), 100);

        /*
         * Supply-chain parameters (Ethiopian private pharmacy defaults):
         *   lead_time_days — supplier delivery delay (local default 7 days)
         *   safety_days    — demand cover against delays/shortages
         *   coverage_days  — target stock horizon an order replenishes
         * All sanitized integers — safe to inline into the SQL text.
         */
        const leadTimeDays = Math.min(Math.max(Number.parseInt(req.query.lead_time_days, 10) || 7, 1), 60);
        const safetyDays = Math.min(Math.max(Number.parseInt(req.query.safety_days, 10) || 5, 1), 30);
        const coverageDays = Math.min(Math.max(Number.parseInt(req.query.coverage_days, 10) || 30, 7), 120);

        /* Demand window aliases (single-dose units from REAL dispensing history) */
        const ADS_90 = `COALESCE((SELECT SUM(si.quantity) / 90.0 FROM sale_items si JOIN sales s ON s.sale_id = si.sale_id JOIN batches sb ON sb.batch_id = si.batch_id WHERE sb.medicine_id = m.medicine_id AND s.status = 'COMPLETED' AND s.sale_date >= CURRENT_DATE - INTERVAL '90 days'), 0)`;
        const ADS_30 = `COALESCE((SELECT SUM(si.quantity) / 30.0 FROM sale_items si JOIN sales s ON s.sale_id = si.sale_id JOIN batches sb ON sb.batch_id = si.batch_id WHERE sb.medicine_id = m.medicine_id AND s.status = 'COMPLETED' AND s.sale_date >= CURRENT_DATE - INTERVAL '30 days'), 0)`;

        const result = await db.query(`
            SELECT
              m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form,
              COALESCE(m.reorder_level, 0) as reorder_level,
              COALESCE(m.reorder_level, 0) as min_level,
              COALESCE(m.max_level, COALESCE(m.reorder_level, 0) + 10) as max_level,
              MAX(b.abc_category) as abc_category, MAX(b.ven_category) as ven_category,
              COALESCE(SUM(b.stock_quantity), 0) as current_stock,
              COALESCE(SUM(CASE WHEN b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE THEN b.stock_quantity ELSE 0 END), 0) as usable_stock,
              MIN(CASE WHEN b.expiry_date >= CURRENT_DATE THEN b.expiry_date END) as earliest_valid_expiry,
              c.name as category_name,
              ${ADS_90} as ads_90,
              ${ADS_30} as ads_30,
              COALESCE((SELECT SUM(si.quantity) / 60.0 FROM sale_items si JOIN sales s ON s.sale_id = si.sale_id JOIN batches sb ON sb.batch_id = si.batch_id WHERE sb.medicine_id = m.medicine_id AND s.status = 'COMPLETED' AND s.sale_date >= CURRENT_DATE - INTERVAL '90 days' AND s.sale_date < CURRENT_DATE - INTERVAL '30 days'), 0) as ads_prev_60,
              COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.sale_id = si.sale_id JOIN batches sb ON sb.batch_id = si.batch_id WHERE sb.medicine_id = m.medicine_id AND s.sale_date >= CURRENT_DATE - INTERVAL '6 months' AND s.status = 'COMPLETED'), 0) as issued_last_6_months,
              (SELECT MIN(s.sale_date) FROM sale_items si JOIN sales s ON s.sale_id = si.sale_id JOIN batches sb ON sb.batch_id = si.batch_id WHERE sb.medicine_id = m.medicine_id AND s.status = 'COMPLETED' AND s.sale_date >= CURRENT_DATE - INTERVAL '1 year') as first_sale_date,
              COALESCE((SELECT b4.units_per_package FROM batches b4 WHERE b4.medicine_id = m.medicine_id ORDER BY b4.created_at DESC LIMIT 1), 1) as units_per_package,
              (SELECT s.name FROM suppliers s JOIN batches b2 ON b2.supplier_id = s.supplier_id WHERE b2.medicine_id = m.medicine_id ORDER BY b2.created_at DESC LIMIT 1) as last_supplier,
              (SELECT b3.buy_price FROM batches b3 WHERE b3.medicine_id = m.medicine_id ORDER BY b3.created_at DESC LIMIT 1) as last_buy_price
            FROM medicines m
            LEFT JOIN batches b ON b.medicine_id = m.medicine_id AND b.status != 'INACTIVE'
            LEFT JOIN categories c ON m.category_id = c.category_id
            WHERE m.status = 'ACTIVE'
            GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.reorder_level, m.max_level, c.name
            /* Actionable list: at/below the manual min level, OR usable stock at/below
               the calculated reorder point (ADS x lead time + safety stock) */
            HAVING
                COALESCE(SUM(b.stock_quantity), 0) <= COALESCE(m.reorder_level, 0)
                OR ${ADS_90} * ${leadTimeDays + safetyDays} >= COALESCE(SUM(CASE WHEN b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE THEN b.stock_quantity ELSE 0 END), 0)
        `);

        const today = new Date();
        const rows = result.rows.map(row => {
            const stock = Number(row.current_stock) || 0;
            const usable = Number(row.usable_stock) || 0;
            const minLevel = Number(row.min_level) || 0;
            const maxLevel = Number(row.max_level) || minLevel + 10;
            const ads = Math.max(0, Number(row.ads_90) || 0);
            const adsRecent = Math.max(0, Number(row.ads_30) || 0);
            const adsPrev = Math.max(0, Number(row.ads_prev_60) || 0);
            const total90 = Math.round(ads * 90);

            const firstSale = row.first_sale_date ? new Date(row.first_sale_date) : null;
            const historyDays = firstSale ? Math.max(1, Math.min(90, Math.ceil((today - firstSale) / 86400000))) : 0;
            const hasSales = total90 > 0;

            /* Confidence in the demand estimate = how much REAL history exists */
            const confidence = !hasSales ? 'NO_DATA' : historyDays >= 60 ? 'HIGH' : historyDays >= 14 ? 'MEDIUM' : 'LOW';

            /* Recent trend — prevents buying based on stale demand */
            let trend = 'NO_DATA';
            if (hasSales) {
                const ratio = adsPrev > 0 ? adsRecent / adsPrev : 1.5;
                trend = ratio >= 1.15 ? 'INCREASING' : ratio <= 0.85 ? 'DECREASING' : 'STABLE';
            }

            /* Stock coverage in days at current demand (never divide by zero) */
            const coverage = hasSales && ads > 0 ? Math.floor(usable / ads) : null;

            /* Movement speed from actual sales velocity */
            const movement = !hasSales ? 'NO DATA' : ads >= 5 ? 'FAST' : ads >= 1 ? 'MEDIUM' : 'SLOW';

            /* Safety stock = extra demand cover (ADS x safety days) */
            const safetyStock = Math.ceil(ads * safetyDays);

            /* Reorder point = demand during lead time + safety stock.
               No sales data → fall back to the manual reorder level. */
            const reorderPoint = hasSales ? Math.ceil(ads * leadTimeDays + safetyStock) : minLevel;

            /* Days until the reorder point is crossed at current demand */
            const daysToReorder = hasSales && ads > 0 ? Math.floor((usable - reorderPoint) / ads) : null;

            /* Order quantity = target stock − on-hand usable stock (never negative).
               Target = demand over the coverage horizon + safety stock. */
            const targetStock = hasSales ? Math.ceil(ads * coverageDays + safetyStock) : maxLevel;
            let orderQty = Math.max(0, targetStock - usable);
            /* Slow movers: low demand + low stock does NOT mean a big buy */
            if (movement === 'SLOW') orderQty = Math.min(orderQty, safetyStock);

            /* Expiry risk — a batch that will likely expire before it sells */
            let expiryRisk = false;
            if (row.earliest_valid_expiry) {
                const daysToExpiry = Math.ceil((new Date(row.earliest_valid_expiry) - today) / 86400000);
                expiryRisk = daysToExpiry <= 60 && (coverage === null || coverage > daysToExpiry);
            }
            const writeOffUnits = Math.max(0, stock - usable);

            /* Priority — urgency first, boosted (never overridden) by ABC/VEN */
            let urgency = 'MONITOR';
            if (coverage !== null && coverage <= leadTimeDays) urgency = 'URGENT';
            else if (stock <= 0) urgency = 'HIGH';
            else if (hasSales && usable <= reorderPoint) urgency = 'HIGH';
            else if (daysToReorder !== null && daysToReorder <= 14) urgency = 'PLAN';

            const venBoost = row.ven_category === 'V' ? 2 : row.ven_category === 'E' ? 1 : 0;
            const abcBoost = row.abc_category === 'A' ? 2 : row.abc_category === 'B' ? 1 : 0;
            const boostScore = venBoost + abcBoost;
            const boostRank = boostScore >= 3 ? 2 : boostScore >= 2 ? 1 : 0;
            const urgencyRank = { URGENT: 3, HIGH: 2, PLAN: 1, MONITOR: 0 }[urgency];
            const finalRank = Math.max(urgencyRank, boostRank);
            const priority = { 3: 'URGENT', 2: 'HIGH', 1: 'PLAN', 0: 'MONITOR' }[finalRank];

            /* When to buy */
            let whenToBuy = 'Monitor';
            if (priority === 'URGENT') whenToBuy = 'Order now';
            else if (priority === 'HIGH') whenToBuy = 'Order within 3 days';
            else if (priority === 'PLAN') whenToBuy = `Order within ${Math.max(1, daysToReorder ?? 7)} days`;

            /* Why — plain-language explanation for the pharmacist */
            const parts = [];
            if (hasSales) {
                parts.push(`sells about ${ads < 10 ? ads.toFixed(1) : Math.round(ads)} units/day (${trend.toLowerCase()} demand)`);
                parts.push(`current stock covers ${coverage} day${coverage === 1 ? '' : 's'}`);
            } else {
                parts.push('no recent sales recorded');
            }
            parts.push(`supplier lead time ${leadTimeDays} days, safety stock ${safetyStock} units, reorder point ${reorderPoint} units`);
            if (expiryRisk) parts.push('existing stock is at expiry risk — sell it down before receiving more');
            if (writeOffUnits > 0) parts.push(`${writeOffUnits} units in expired batches must be written off`);
            const why = `${row.generic_name} ${parts.join('; ')}.`;

            return {
                ...row,
                min_level: minLevel, max_level: maxLevel, reorder_level: minLevel,
                current_stock: stock, usable_stock: usable,
                ads, ads_recent: adsRecent, ads_prev: adsPrev,
                trend, confidence, movement,
                coverage_days: coverage, days_to_reorder: daysToReorder,
                lead_time_days: leadTimeDays, safety_stock: safetyStock, reorder_point: reorderPoint,
                target_stock: targetStock, suggested_qty: orderQty, order_qty: orderQty,
                expiry_risk: expiryRisk, write_off_units: writeOffUnits,
                history_days: historyDays, priority, when_to_buy: whenToBuy, why,
                estimated_cost: Math.round(orderQty * (Number(row.last_buy_price) || 0) * 100) / 100,
            };
        });

        /* Highest procurement urgency first, then lowest coverage, then fastest movers */
        const PRIORITY_ORDER = { URGENT: 0, HIGH: 1, PLAN: 2, MONITOR: 3 };
        rows.sort((a, b) =>
            (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) ||
            ((a.coverage_days ?? 9999) - (b.coverage_days ?? 9999)) ||
            (b.ads - a.ads)
        );

        const priorityCounts = rows.reduce((counts, row) => {
            counts[row.priority] = (counts[row.priority] || 0) + 1;
            return counts;
        }, {});
        const start = (page - 1) * limit;
        res.json({
            data: rows.slice(start, start + limit),
            pagination: { page, limit, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / limit)) },
            priorityCounts,
        });
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
