'use strict';

/**
 * physicalCountController.js
 *
 * Handles all physical (cyclic) stock-count operations:
 *   - createPhysicalCount  – locks batches, computes variances, adjusts stock,
 *                            records stock_movements, and writes audit_logs inside
 *                            a single transaction.
 *   - getPhysicalCounts    – returns a summary list of all past counts.
 *   - getPhysicalCountDetails – returns the header + line-items for one count.
 *
 * DB pattern: db.getClient() → BEGIN … COMMIT / ROLLBACK → client.release() in finally.
 */

const db = require('../config/db');

// ---------------------------------------------------------------------------
// Helper: safely write one audit_log row inside an open transaction client.
// Never throws – audit failures must not abort the main operation.
// ---------------------------------------------------------------------------
async function _writeAuditLog(client, { user_id, action, module, table_name, record_id, description, new_values }) {
    try {
        await client.query(
            `INSERT INTO audit_logs
                (user_id, action, module, table_name, record_id, description, new_values)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                user_id,
                action,
                module,
                table_name,
                record_id,
                description,
                JSON.stringify(new_values),
            ]
        );
    } catch (auditErr) {
        // Log to server console but do NOT re-throw – the caller must not fail because of audit.
        console.error('[physicalCountController] Audit log write failed (non-fatal):', auditErr.message);
    }
}

// ---------------------------------------------------------------------------
// POST /api/physical-counts
// Body: { user_id, notes, items: [{ batch_id, physical_quantity, reason, notes }] }
// ---------------------------------------------------------------------------
exports.createPhysicalCount = async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const { user_id, notes, items } = req.body;

        // Resolve user_id from body or JWT token
        const current_user_id = user_id || (req.user && req.user.user_id);

        if (!items || !Array.isArray(items) || items.length === 0) {
            // Roll back the empty transaction and respond with a validation error
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'At least one item is required for a physical count.' });
        }

        // -----------------------------------------------------------------------
        // Step 1 – Build a unique reference number for this count session.
        // -----------------------------------------------------------------------
        const reference_number = `PC-${Date.now()}`;

        // -----------------------------------------------------------------------
        // Step 2 – Process every submitted item.
        //   a. Lock the batch row (FOR UPDATE) to prevent concurrent stock edits.
        //   b. Compute variance = physical_quantity − system_quantity.
        //   c. Overwrite batch stock with the counted quantity.
        //   d. Insert one stock_movement row per batch.
        // -----------------------------------------------------------------------
        let total_variance = 0;

        for (const item of items) {
            const { batch_id, physical_quantity, reason, notes: item_notes } = item;

            // a. Lock & read current system stock
            const batchRes = await client.query(
                `SELECT b.batch_id, b.stock_quantity, b.medicine_id
                 FROM   batches b
                 WHERE  b.batch_id = $1
                 FOR UPDATE`,
                [batch_id]
            );

            if (batchRes.rows.length === 0) {
                throw new Error(`Batch with id ${batch_id} not found.`);
            }

            const { stock_quantity: system_quantity, medicine_id } = batchRes.rows[0];

            // b. Compute variance (positive = surplus, negative = shortage)
            const variance = physical_quantity - system_quantity;
            total_variance += variance;

            // c. Update the batch to the physically counted quantity
            await client.query(
                `UPDATE batches
                 SET    stock_quantity = $1,
                        updated_at     = NOW()
                 WHERE  batch_id = $2`,
                [physical_quantity, batch_id]
            );

            // d. Record the stock movement
            await client.query(
                `INSERT INTO stock_movements
                    (medicine_id, batch_id, user_id, movement_type, quantity,
                     previous_stock, new_stock, reference_type, reason, notes)
                 VALUES ($1, $2, $3, 'PHYSICAL_COUNT', $4, $5, $6, 'PHYSICAL_COUNT', $7, $8)`,
                [
                    medicine_id,
                    batch_id,
                    current_user_id,
                    variance,                        // signed variance quantity
                    system_quantity,                  // stock before count
                    physical_quantity,                // stock after count
                    reason || null,
                    item_notes || 'Physical count adjustment',
                ]
            );

            // Attach resolved values back onto item so we can use them in Step 4
            item._system_quantity = system_quantity;
            item._variance        = variance;
        }

        // -----------------------------------------------------------------------
        // Step 3 – Insert the physical_counts header row.
        // -----------------------------------------------------------------------
        const pcRes = await client.query(
            `INSERT INTO physical_counts (user_id, notes, status, reference_number)
             VALUES ($1, $2, 'APPROVED', $3)
             RETURNING physical_count_id`,
            [current_user_id, notes || null, reference_number]
        );

        const physical_count_id = pcRes.rows[0].physical_count_id;

        // -----------------------------------------------------------------------
        // Step 4 – Insert one physical_count_items row per processed batch.
        // -----------------------------------------------------------------------
        for (const item of items) {
            await client.query(
                `INSERT INTO physical_count_items
                    (physical_count_id, batch_id, system_quantity, physical_quantity, variance, reason, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    physical_count_id,
                    item.batch_id,
                    item._system_quantity,
                    item.physical_quantity,
                    item._variance,
                    item.reason || null,
                    item.notes  || null,
                ]
            );
        }

        // -----------------------------------------------------------------------
        // Step 5 – Write a single audit_log entry summarising the entire count.
        // -----------------------------------------------------------------------
        await _writeAuditLog(client, {
            user_id:     current_user_id,
            action:      'PHYSICAL_COUNT',
            module:      'INVENTORY',
            table_name:  'physical_counts',
            record_id:   physical_count_id,
            description: `Physical count performed on ${items.length} batch${items.length !== 1 ? 'es' : ''}`,
            new_values:  {
                items_count:    items.length,
                total_variance, // sum of all signed variances
            },
        });

        // -----------------------------------------------------------------------
        // Commit
        // -----------------------------------------------------------------------
        await client.query('COMMIT');

        return res.status(201).json({
            message:           'Physical count recorded successfully',
            physical_count_id,
            reference_number,
        });

    } catch (err) {
        // Attempt rollback; if it also fails, just log it
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {
            console.error('[physicalCountController] ROLLBACK failed:', rollbackErr.message);
        }
        console.error('[physicalCountController] createPhysicalCount error:', err.message);
        return res.status(500).json({ error: 'Failed to record physical count', details: err.message });
    } finally {
        client.release();
    }
};

// ---------------------------------------------------------------------------
// GET /api/physical-counts
// Returns a summary list of all physical count sessions, newest first.
// ---------------------------------------------------------------------------
exports.getPhysicalCounts = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT
                pc.physical_count_id,
                pc.reference_number,
                pc.notes,
                pc.status,
                pc.created_at,
                u.full_name  AS counted_by_name,
                u.username,
                COUNT(pci.item_id)      AS items_count,
                SUM(ABS(pci.variance))  AS total_variance
             FROM   physical_counts pc
             JOIN   users u
               ON   pc.user_id = u.user_id
             LEFT JOIN physical_count_items pci
               ON   pc.physical_count_id = pci.physical_count_id
             GROUP BY
                pc.physical_count_id,
                u.full_name,
                u.username
             ORDER BY pc.created_at DESC`
        );

        return res.status(200).json(result.rows);

    } catch (err) {
        console.error('[physicalCountController] getPhysicalCounts error:', err.message);
        return res.status(500).json({ error: 'Failed to retrieve physical counts', details: err.message });
    }
};

// ---------------------------------------------------------------------------
// GET /api/physical-counts/:id
// Returns the header row plus all line-items (with batch & medicine details).
// ---------------------------------------------------------------------------
exports.getPhysicalCountDetails = async (req, res) => {
    try {
        const { id } = req.params;

        // -- Header --
        const headerRes = await db.query(
            `SELECT
                pc.*,
                u.full_name AS counted_by_name,
                u.username
             FROM   physical_counts pc
             JOIN   users u ON pc.user_id = u.user_id
             WHERE  pc.physical_count_id = $1`,
            [id]
        );

        if (headerRes.rows.length === 0) {
            return res.status(404).json({ error: 'Physical count not found' });
        }

        // -- Line items --
        const itemsRes = await db.query(
            `SELECT
                pci.item_id,
                pci.physical_count_id,
                pci.batch_id,
                pci.system_quantity,
                pci.physical_quantity,
                pci.variance,
                pci.reason,
                pci.notes,
                b.batch_number,
                b.expiry_date,
                m.medicine_id,
                m.generic_name,
                m.brand_name,
                m.strength
             FROM   physical_count_items pci
             JOIN   batches   b ON pci.batch_id   = b.batch_id
             JOIN   medicines m ON b.medicine_id  = m.medicine_id
             WHERE  pci.physical_count_id = $1
             ORDER BY m.generic_name ASC, b.batch_number ASC`,
            [id]
        );

        return res.status(200).json({
            header: headerRes.rows[0],
            items:  itemsRes.rows,
        });

    } catch (err) {
        console.error('[physicalCountController] getPhysicalCountDetails error:', err.message);
        return res.status(500).json({ error: 'Failed to retrieve physical count details', details: err.message });
    }
};
