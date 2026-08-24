const db = require('../config/db');

// Get all medicines with their calculated total stock from batches
exports.getAllMedicines = async (req, res) => {
    try {
        const result = await db.query(`
            SELECT m.*, 
                   COALESCE(SUM(b.stock_quantity), 0) AS stock_on_hand,
                   c.name as category_name,
                   sc.name as sub_category_name
            FROM medicines m
            LEFT JOIN batches b ON m.medicine_id = b.medicine_id AND b.status != 'INACTIVE'
            LEFT JOIN categories c ON m.category_id = c.category_id
            LEFT JOIN sub_categories sc ON m.sub_category_id = sc.sub_category_id
            GROUP BY m.medicine_id, c.name, sc.name
            ORDER BY m.generic_name ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

// Get single medicine details
exports.getMedicineById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(`
            SELECT m.*, 
                   COALESCE(SUM(b.stock_quantity), 0) AS stock_on_hand,
                   c.name as category_name,
                   sc.name as sub_category_name
            FROM medicines m
            LEFT JOIN batches b ON m.medicine_id = b.medicine_id AND b.status != 'INACTIVE'
            LEFT JOIN categories c ON m.category_id = c.category_id
            LEFT JOIN sub_categories sc ON m.sub_category_id = sc.sub_category_id
            WHERE m.medicine_id = $1
            GROUP BY m.medicine_id, c.name, sc.name
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Medicine not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

// Add new medicine (with optional initial stock inside a transaction)
exports.addMedicine = async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const {
            category_id,
            sub_category_id,
            generic_name,
            brand_name,
            strength,
            dosage_form,
            manufacturer,
            country,
            route,
            prescription_type,
            description,
            indications,
            contraindications,
            side_effects,
            warnings,
            storage_conditions,
            reorder_level,
            max_level,
            initial_stock,
            user_id
        } = req.body;

        const current_user_id = user_id || (req.user && req.user.user_id) || (req.user && req.user.id) || 1;

        // Validations
        if (generic_name) {
            const existing = await client.query('SELECT medicine_id FROM medicines WHERE LOWER(generic_name) = LOWER($1)', [generic_name]);
            if (existing.rows.length > 0) {
                throw new Error('Generic Name must be unique in the database.');
            }
        }
        
        if (strength) {
            const normalized = String(strength).trim();
            if (!normalized) {
                throw new Error('Strength is required.');
            }
            const strRegex = /^\d+(?:\.\d+)?\s*(?:mg|g|mcg|μg|ug|ml|l|iu|units?|meq|mmol|%)?(?:\/\d+(?:\.\d+)?\s*(?:mg|g|mcg|μg|ug|ml|l|iu|units?|meq|mmol|%)?)?$/i;
            if (!strRegex.test(normalized.replace(/\s*\/\s*/g, '/'))) {
                throw new Error('Strength must match standard pharmaceutical formats (e.g., 500 mg, 250mg, 5 mL, 100 IU).');
            }
        }

        if (category_id && sub_category_id) {
            const validSub = await client.query('SELECT 1 FROM sub_categories WHERE category_id = $1 AND sub_category_id = $2', [category_id, sub_category_id]);
            if (validSub.rows.length === 0) {
                throw new Error('Subcategory does not match the selected Main Category.');
            }
        }

        const clinicalFields = { description, indications, contraindications, side_effects, warnings, storage_conditions };
        for (const [key, value] of Object.entries(clinicalFields)) {
            if (value && value.trim().length > 0 && value.trim().length < 10) {
                throw new Error(`Clinical Text (${key}) must be at least 10 characters long.`);
            }
        }

        // 1. Create Medicine
        const insertMed = `
            INSERT INTO medicines (
                category_id, sub_category_id, generic_name, brand_name,
                strength, dosage_form, manufacturer, country, route, prescription_type,
                description, indications, contraindications, side_effects,
                warnings, storage_conditions, reorder_level, max_level
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING medicine_id
        `;
        const medValues = [
            category_id || null, sub_category_id || null, generic_name, brand_name,
            strength, dosage_form, manufacturer || null, country || null, route, prescription_type,
            description, indications, contraindications, side_effects,
            warnings, storage_conditions, reorder_level || 50, max_level || 500
        ];

        const medResult = await client.query(insertMed, medValues);
        const medicine_id = medResult.rows[0].medicine_id;

        await client.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values) VALUES ($1,$2,$3,$4,$5)`, [current_user_id, 'CREATE', 'medicines', medicine_id, JSON.stringify({ generic_name, brand_name, description: `Registered ${generic_name} ${brand_name || ''}` })]);

        // 2. If Initial Stock is provided, create Batch and Stock Movement
        if (initial_stock) {
            const {
                supplier_id,
                batch_number,
                manufacture_date,
                expiry_date,
                buy_price,
                sell_price,
                quantity,
                barcode,
                qr_code,
                abc_category,
                ven_category
            } = initial_stock;

            const insertBatch = `
                INSERT INTO batches (
                    medicine_id, supplier_id, batch_number, manufacture_date,
                    expiry_date, buy_price, sell_price, stock_quantity, barcode, qr_code, abc_category, ven_category
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING batch_id
            `;
            const batchValues = [
                medicine_id, supplier_id, batch_number, manufacture_date || null,
                expiry_date, buy_price, sell_price, quantity, barcode || null, qr_code || null, abc_category || null, ven_category || null
            ];
            
            const batchResult = await client.query(insertBatch, batchValues);
            const batch_id = batchResult.rows[0].batch_id;

            // 3. Create Stock Movement for Initial Stock (RESUPPLY)
            const insertMovement = `
                INSERT INTO stock_movements (
                    batch_id, user_id, movement_type, quantity, 
                    previous_stock, new_stock, notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `;
            await client.query(insertMovement, [
                batch_id, current_user_id, 'RESUPPLY', quantity, 0, quantity, 'Initial stock entry'
            ]);
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Medicine registered successfully', medicine_id });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Failed to create medicine', details: err.message });
    } finally {
        client.release();
    }
};

// Update existing medicine master details
exports.updateMedicine = async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const {
            category_id, sub_category_id, generic_name, brand_name,
            strength, dosage_form, manufacturer, country, route, prescription_type,
            description, indications, contraindications, side_effects,
            warnings, storage_conditions, status, reorder_level, max_level, user_id
        } = req.body;

        const current_user_id = user_id || (req.user && req.user.user_id) || (req.user && req.user.id) || 1;

        // Validations for update
        if (generic_name) {
            const existing = await client.query('SELECT medicine_id FROM medicines WHERE LOWER(generic_name) = LOWER($1) AND medicine_id != $2', [generic_name, id]);
            if (existing.rows.length > 0) {
                throw new Error('Generic Name must be unique in the database.');
            }
        }

        if (strength) {
            const normalized = String(strength).trim();
            if (!normalized) {
                throw new Error('Strength is required.');
            }
            const strRegex = /^\d+(?:\.\d+)?\s*(?:mg|g|mcg|μg|ug|ml|l|iu|units?|meq|mmol|%)?(?:\/\d+(?:\.\d+)?\s*(?:mg|g|mcg|μg|ug|ml|l|iu|units?|meq|mmol|%)?)?$/i;
            if (!strRegex.test(normalized.replace(/\s*\/\s*/g, '/'))) {
                throw new Error('Strength must match standard pharmaceutical formats (e.g., 500 mg, 250mg, 5 mL, 100 IU).');
            }
        }

        if (category_id && sub_category_id) {
            const validSub = await client.query('SELECT 1 FROM sub_categories WHERE category_id = $1 AND sub_category_id = $2', [category_id, sub_category_id]);
            if (validSub.rows.length === 0) {
                throw new Error('Subcategory does not match the selected Main Category.');
            }
        }

        const clinicalFields = { description, indications, contraindications, side_effects, warnings, storage_conditions };
        for (const [key, value] of Object.entries(clinicalFields)) {
            if (value && value.trim().length > 0 && value.trim().length < 10) {
                throw new Error(`Clinical Text (${key}) must be at least 10 characters long.`);
            }
        }

        const updateMed = `
            UPDATE medicines
            SET category_id = $1, sub_category_id = $2, generic_name = $3,
                brand_name = $4, strength = $5, dosage_form = $6,
                manufacturer = $7, country = $8, route = $9, prescription_type = $10,
                description = $11, indications = $12, contraindications = $13, side_effects = $14,
                warnings = $15, storage_conditions = $16, status = COALESCE($17, status),
                reorder_level = $18, max_level = $19,
                updated_at = CURRENT_TIMESTAMP
            WHERE medicine_id = $20
            RETURNING *
        `;
        const values = [
            category_id || null, sub_category_id || null, generic_name, brand_name,
            strength, dosage_form, manufacturer || null, country || null, route, prescription_type,
            description, indications, contraindications, side_effects,
            warnings, storage_conditions, status, reorder_level || 50, max_level || 500, id
        ];

        const result = await client.query(updateMed, values);
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Medicine not found' });
        }
        
        await client.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values) VALUES ($1,$2,$3,$4,$5)`, [current_user_id, 'UPDATE', 'medicines', id, JSON.stringify({ generic_name, brand_name, description: `Updated ${generic_name} ${brand_name || ''}` })]);

        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    } finally {
        client.release();
    }
};

// Soft delete / deactivate medicine
exports.deleteMedicine = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query(`UPDATE medicines SET status = 'INACTIVE' WHERE medicine_id = $1`, [id]);
        res.json({ message: 'Medicine deactivated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

// Bulk Import Preview
exports.previewImport = async (req, res) => {
    try {
        const { medicines } = req.body;
        if (!medicines || !Array.isArray(medicines)) {
            return res.status(400).json({ error: 'Invalid payload' });
        }
        
        const previewResult = [];
        
        for (let i = 0; i < medicines.length; i++) {
            const row = medicines[i];
            const generic_name = (row.generic_name || '').trim().toLowerCase();
            const brand_name = (row.brand_name || '').trim().toLowerCase();
            const strength = (row.strength || '').trim().toLowerCase();
            const dosage_form = (row.dosage_form || '').trim().toLowerCase();
            const route = (row.route || '').trim().toLowerCase();
            const batch_number = (row.batch_number || '').trim().toLowerCase();
            
            const medCheck = await db.query(`SELECT medicine_id FROM medicines WHERE LOWER(TRIM(generic_name))=$1 AND LOWER(TRIM(brand_name))=$2 AND LOWER(TRIM(strength))=$3 AND LOWER(TRIM(dosage_form))=$4 AND LOWER(TRIM(route))=$5`, [generic_name, brand_name, strength, dosage_form, route]);
            
            let decision = 'new_medicine_new_batch';
            let medicine_id = null;
            let batch_id = null;
            
            if (medCheck.rows.length > 0) {
                medicine_id = medCheck.rows[0].medicine_id;
                
                const batchCheck = await db.query(`SELECT batch_id FROM batches WHERE medicine_id=$1 AND LOWER(TRIM(batch_number))=$2`, [medicine_id, batch_number]);
                if (batchCheck.rows.length > 0) {
                    batch_id = batchCheck.rows[0].batch_id;
                    decision = 'existing_medicine_existing_batch';
                } else {
                    decision = 'existing_medicine_new_batch';
                }
            }
            
            previewResult.push({
                row_index: i,
                medicine_name: `${row.generic_name} ${row.brand_name}`,
                batch_number: row.batch_number,
                quantity: row.quantity,
                decision,
                medicine_id,
                batch_id
            });
        }
        
        res.json(previewResult);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

// Bulk Import Confirm
exports.confirmImport = async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { medicines, user_id } = req.body;
        const current_user_id = user_id || (req.user && req.user.user_id) || (req.user && req.user.id) || 1;
        
        let imported = 0;
        let medicines_created = 0;
        let batches_created = 0;
        let stock_updated = 0;
        
        for (const row of medicines) {
            const generic_name = (row.generic_name || '').trim().toLowerCase();
            const brand_name = (row.brand_name || '').trim().toLowerCase();
            const strength = (row.strength || '').trim().toLowerCase();
            const dosage_form = (row.dosage_form || '').trim().toLowerCase();
            const route = (row.route || '').trim().toLowerCase();
            const batch_number = (row.batch_number || '').trim().toLowerCase();
            
            const medCheck = await client.query(`SELECT medicine_id FROM medicines WHERE LOWER(TRIM(generic_name))=$1 AND LOWER(TRIM(brand_name))=$2 AND LOWER(TRIM(strength))=$3 AND LOWER(TRIM(dosage_form))=$4 AND LOWER(TRIM(route))=$5`, [generic_name, brand_name, strength, dosage_form, route]);
            
            let medicine_id;
            
            if (medCheck.rows.length > 0) {
                medicine_id = medCheck.rows[0].medicine_id;
            } else {
                const insertMed = `INSERT INTO medicines (category_id, sub_category_id, generic_name, brand_name, strength, dosage_form, route) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING medicine_id`;
                const medRes = await client.query(insertMed, [row.category_id || null, row.sub_category_id || null, row.generic_name, row.brand_name, row.strength, row.dosage_form, row.route]);
                medicine_id = medRes.rows[0].medicine_id;
                medicines_created++;
                await client.query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values) VALUES ($1,$2,$3,$4,$5)`, [current_user_id, 'CREATE', 'medicines', medicine_id, JSON.stringify({ generic_name: row.generic_name, brand_name: row.brand_name, description: `Registered ${row.generic_name} ${row.brand_name || ''}` })]);
            }
            
            const batchCheck = await client.query(`SELECT batch_id, stock_quantity FROM batches WHERE medicine_id=$1 AND LOWER(TRIM(batch_number))=$2`, [medicine_id, batch_number]);
            
            let batch_id;
            let previous_stock = 0;
            
            if (batchCheck.rows.length > 0) {
                batch_id = batchCheck.rows[0].batch_id;
                previous_stock = batchCheck.rows[0].stock_quantity;
                await client.query(`UPDATE batches SET stock_quantity = stock_quantity + $1 WHERE batch_id = $2`, [row.quantity, batch_id]);
                stock_updated++;
            } else {
                const insertBatch = `INSERT INTO batches (medicine_id, supplier_id, batch_number, expiry_date, buy_price, sell_price, stock_quantity) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING batch_id`;
                const batchRes = await client.query(insertBatch, [medicine_id, row.supplier_id || null, row.batch_number, row.expiry_date, row.buy_price, row.sell_price, row.quantity]);
                batch_id = batchRes.rows[0].batch_id;
                batches_created++;
            }
            
            const insertMovement = `INSERT INTO stock_movements (batch_id, user_id, movement_type, quantity, previous_stock, new_stock, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
            await client.query(insertMovement, [batch_id, current_user_id, 'RESUPPLY', row.quantity, previous_stock, previous_stock + row.quantity, 'Bulk Import']);
            
            imported++;
        }
        
        await client.query('COMMIT');
        res.json({ imported, medicines_created, batches_created, stock_updated });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    } finally {
        client.release();
    }
};
