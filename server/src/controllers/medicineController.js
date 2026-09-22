const db = require('../config/db');
const importService = require('../services/importService');
const { validatePackagingInput } = require('../utils/packaging');

// Get all medicines with their calculated total stock from batches.
// Supports OPTIONAL server-side pagination + filters (used by the Medicines
// page card/table views). Without `page`, the full array is returned so
// existing consumers (POS, reports, barcode lookup) keep working unchanged.
exports.getAllMedicines = async (req, res) => {
    try {
        const { search, category_id, sub_category_id, dosage_form, route, prescription_type, status, page, sortBy, sortOrder } = req.query;
        const params = [];
        const where = [];

        if (search) {
            params.push(`%${String(search).trim()}%`);
            const p = params.length;
            where.push(`(m.generic_name ILIKE $${p} OR m.brand_name ILIKE $${p} OR m.strength ILIKE $${p})`);
        }
        if (category_id) { params.push(Number(category_id)); where.push(`m.category_id = $${params.length}`); }
        if (sub_category_id) { params.push(Number(sub_category_id)); where.push(`m.sub_category_id = $${params.length}`); }
        if (dosage_form) {
            const form = String(dosage_form).toLowerCase();
            const formPatterns = {
                solid: ['%tablet%', '%capsule%', '%powder%', '%patch%', '%lozenge%'],
                liquid: ['%syrup%', '%solution%', '%suspension%', '%drops%', '%spray%'],
                'semi-solid': ['%cream%', '%ointment%', '%gel%', '%lotion%'],
            };
            if (formPatterns[form]) {
                params.push(formPatterns[form]);
                where.push(`LOWER(m.dosage_form) LIKE ANY($${params.length}::text[])`);
            } else if (form === 'other') {
                params.push(['%tablet%', '%capsule%', '%powder%', '%patch%', '%lozenge%', '%syrup%', '%solution%', '%suspension%', '%drops%', '%spray%', '%cream%', '%ointment%', '%gel%', '%lotion%']);
                where.push(`NOT (LOWER(m.dosage_form) LIKE ANY($${params.length}::text[]))`);
            } else {
                params.push(String(dosage_form));
                where.push(`LOWER(m.dosage_form) = LOWER($${params.length})`);
            }
        }
        if (route) { params.push(String(route)); where.push(`m.route = $${params.length}`); }
        if (prescription_type) { params.push(String(prescription_type)); where.push(`m.prescription_type = $${params.length}`); }
        if (status) { params.push(String(status).toUpperCase()); where.push(`m.status = $${params.length}`); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        /* Sorting configuration */
        const sortMap = {
            generic_name: 'm.generic_name',
            brand_name: 'm.brand_name',
            created_date: 'm.created_at',
            stock_on_hand: 'stock_on_hand',
            nearest_expiry: 'nearest_expiry',
        };
        const sortColumn = sortMap[sortBy] || 'm.generic_name';
        const order = sortOrder === 'desc' ? 'DESC' : 'ASC';

        /* Server-side pagination mode (Medicines page card/table view). */
        if (page) {
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 100);
            const pageNum = Math.max(parseInt(page, 10) || 1, 1);

            const countRes = await db.query(
                `SELECT COUNT(*)::int AS total FROM medicines m ${whereSql}`, params
            );
            const total = countRes.rows[0].total;

            const rows = await db.query(`
                SELECT m.*,
                       COALESCE(SUM(b.stock_quantity), 0) AS stock_on_hand,
                       COUNT(DISTINCT b.batch_id) FILTER (WHERE b.status = 'ACTIVE') AS active_batches,
                       MIN(b.expiry_date) FILTER (WHERE b.status = 'ACTIVE' AND b.expiry_date >= CURRENT_DATE AND b.stock_quantity > 0) AS nearest_expiry,
                       COUNT(DISTINCT b.batch_id) FILTER (
                           WHERE b.status = 'ACTIVE' AND b.stock_quantity > 0
                             AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'
                       ) AS expiring_soon,
                       COUNT(DISTINCT b.batch_id) FILTER (
                           WHERE b.status = 'ACTIVE' AND b.stock_quantity > 0 AND b.expiry_date < CURRENT_DATE
                       ) AS expired_batches,
                       c.name as category_name,
                       sc.name as sub_category_name
                FROM medicines m
                LEFT JOIN batches b ON m.medicine_id = b.medicine_id AND b.status != 'INACTIVE'
                LEFT JOIN categories c ON m.category_id = c.category_id
                LEFT JOIN sub_categories sc ON m.sub_category_id = sc.sub_category_id
                ${whereSql}
                GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.created_at,
                         m.image_url, m.manufacturer, m.country, m.route, m.prescription_type,
                         m.reorder_level, m.max_level, m.status, m.category_id, m.sub_category_id,
                         m.description, m.indications, m.contraindications, m.side_effects, m.warnings,
                         m.storage_conditions, m.updated_at, c.name, sc.name
                ORDER BY ${sortColumn} ${order} NULLS LAST, m.generic_name ASC, m.medicine_id ASC
                LIMIT ${limit} OFFSET ${(pageNum - 1) * limit}
            `, params);

            return res.json({
                medicines: rows.rows,
                total,
                page: pageNum,
                limit,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            });
        }

        /* Legacy full-list mode (unchanged response shape). */
        const result = await db.query(`
            SELECT m.*, 
                   COALESCE(SUM(b.stock_quantity), 0) AS stock_on_hand,
                   COUNT(DISTINCT b.batch_id) FILTER (WHERE b.status = 'ACTIVE') AS active_batches,
                   c.name as category_name,
                   sc.name as sub_category_name
            FROM medicines m
            LEFT JOIN batches b ON m.medicine_id = b.medicine_id AND b.status != 'INACTIVE'
            LEFT JOIN categories c ON m.category_id = c.category_id
            LEFT JOIN sub_categories sc ON m.sub_category_id = sc.sub_category_id
            ${whereSql}
            GROUP BY m.medicine_id, c.name, sc.name
            ORDER BY m.generic_name ASC
        `, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not validate import', details: err?.message || 'Unknown server error' });
    }
};

// Get single medicine details (master info + batches + suppliers + valuation).
// Used by the Medicine Details view, so it returns everything the detail
// screen needs in one round-trip.
exports.getMedicineById = async (req, res) => {
    try {
        const { id } = req.params;
        const medRes = await db.query(`
            SELECT m.*,
                   COALESCE(SUM(b.stock_quantity), 0) AS stock_on_hand,
                   COUNT(DISTINCT b.batch_id) FILTER (WHERE b.status != 'INACTIVE') AS batch_count,
                   COUNT(DISTINCT b.batch_id) FILTER (WHERE b.status = 'ACTIVE') AS active_batches,
                   MIN(b.expiry_date) FILTER (WHERE b.status = 'ACTIVE' AND b.expiry_date >= CURRENT_DATE AND b.stock_quantity > 0) AS nearest_expiry,
                   COUNT(DISTINCT b.batch_id) FILTER (
                       WHERE b.status = 'ACTIVE'
                         AND b.stock_quantity > 0
                         AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'
                   ) AS expiring_soon,
                   COALESCE(SUM(b.stock_quantity * b.buy_price), 0) AS stock_value_cost,
                   COALESCE(SUM(b.stock_quantity * b.sell_price), 0) AS stock_value_retail,
                   COALESCE(AVG(b.buy_price) FILTER (WHERE b.status != 'INACTIVE' AND b.stock_quantity > 0), 0) AS avg_buy_price,
                   COALESCE(MIN(b.sell_price) FILTER (WHERE b.status != 'INACTIVE' AND b.stock_quantity > 0), 0) AS min_sell_price,
                   COALESCE(MAX(b.sell_price) FILTER (WHERE b.status != 'INACTIVE' AND b.stock_quantity > 0), 0) AS max_sell_price,
                   c.name as category_name,
                   sc.name as sub_category_name
            FROM medicines m
            LEFT JOIN batches b ON m.medicine_id = b.medicine_id AND b.status != 'INACTIVE'
            LEFT JOIN categories c ON m.category_id = c.category_id
            LEFT JOIN sub_categories sc ON m.sub_category_id = sc.sub_category_id
            WHERE m.medicine_id = $1
            GROUP BY m.medicine_id, c.name, sc.name
        `, [id]);

        if (medRes.rows.length === 0) {
            return res.status(404).json({ error: 'Medicine not found' });
        }
        const med = medRes.rows[0];

        // Batch-level detail for the inventory section of the detail view.
        const batches = await db.query(`
            SELECT b.batch_id,
                   b.batch_number,
                   b.expiry_date,
                   b.manufacture_date,
                   b.stock_quantity,
                   b.buy_price,
                   b.sell_price,
                   b.packaging_unit,
                   b.units_per_package,
                   b.status AS batch_status,
                   b.barcode,
                   b.qr_code,
                   b.abc_category,
                   b.ven_category,
                   s.supplier_id,
                   s.name AS supplier_name,
                   s.contact_person AS supplier_contact,
                   s.phone AS supplier_phone
            FROM batches b
            LEFT JOIN suppliers s ON b.supplier_id = s.supplier_id
            WHERE b.medicine_id = $1 AND b.status != 'INACTIVE'
            ORDER BY b.expiry_date ASC NULLS LAST, b.batch_id DESC
        `, [id]);

        const suppliersRaw = await db.query(`
            SELECT DISTINCT s.supplier_id, s.name, s.contact_person, s.phone, s.email
            FROM batches b
            JOIN suppliers s ON b.supplier_id = s.supplier_id
            WHERE b.medicine_id = $1 AND b.status != 'INACTIVE'
            ORDER BY s.name ASC
        `, [id]);

        med.batches = batches.rows;
        med.suppliers = suppliersRaw.rows.map((s) => ({
            supplier_id: s.supplier_id,
            name: s.name,
            contact_person: s.contact_person,
            phone: s.phone,
            email: s.email,
        }));

        res.json(med);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Could not load medicine details', details: err?.message || 'Unknown import error' });
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
            mass,
            mass_unit,
            initial_stock,
            user_id,
            // Packaging / dispensing master data (all optional, validated below)
            base_unit,
            units_per_strip,
            strips_per_inner_box,
            inner_boxes_per_outer_box,
            allow_open_package,
            sell_price_unit,
            sell_price_strip,
            sell_price_inner_box,
            sell_price_outer_box,
            dispense_dose,
            dispense_frequency,
            dispense_frequency_interval,
            dispense_duration_days,
            dispense_route
        } = req.body;

        const current_user_id = req.user && req.user.user_id;

        if (!current_user_id) {
            return res.status(401).json({ error: 'Authenticated staff account required' });
        }

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
            // Accept formats like: 500 mg, 250mg, 5 mL, 100 IU, 10%, 250mg/5mL, 1:1000, etc.
            const strRegex = /^\d+(?:\.\d+)?\s*(?:%|mg|g|mcg|μ|ug|ml|l|iu|units?|meq|mmol)?(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:%|mg|g|mcg|μ|ug|ml|l|iu|units?|meq|mmol)?)?$/i;
            if (!strRegex.test(normalized)) {
                throw new Error('Strength must match standard pharmaceutical formats (e.g., 500 mg, 250mg, 5 mL, 100 IU, 10%).');
            }
        }

        if (category_id && sub_category_id) {
            const validSub = await client.query('SELECT 1 FROM sub_categories WHERE category_id = $1 AND sub_category_id = $2', [category_id, sub_category_id]);
            if (validSub.rows.length === 0) {
                throw new Error('Subcategory does not match the selected Main Category.');
            }
        }
// Category/subcategory integrity: on CREATE the record is brand new, so
        // every assigned master record must exist AND be ACTIVE — inactive
        // categories/subcategories cannot be selected for new medicines.
        if (category_id) {
            const cat = await client.query('SELECT status FROM categories WHERE category_id = $1', [category_id]);
            if (cat.rows.length === 0) {
                throw new Error('Selected Category does not exist.');
            }
            if (cat.rows[0].status !== 'ACTIVE') {
                throw new Error('This category is inactive. Reactivate it before assigning new medicines to it.');
            }
        }
        if (sub_category_id) {
            const sub = await client.query('SELECT status FROM sub_categories WHERE sub_category_id = $1', [sub_category_id]);
            if (sub.rows.length === 0) {
                throw new Error('Selected Subcategory does not exist.');
            }
            if (sub.rows[0].status !== 'ACTIVE') {
                throw new Error('This subcategory is inactive. Reactivate it before assigning new medicines to it.');
            }
        }

        const clinicalFields = { description, indications, contraindications, side_effects, warnings, storage_conditions };
        for (const [key, value] of Object.entries(clinicalFields)) {
            if (value && value.trim().length > 0 && value.trim().length < 10) {
                throw new Error(`Clinical Text (${key}) must be at least 10 characters long.`);
            }
        }

        const MASS_UNITS = ['mg', 'g', 'kg', 'mcg', 'μg', 'ug'];
        let massValue = null;
        let massUnitValue = null;
        if (mass !== undefined && mass !== null && mass !== '') {
            massValue = Number(mass);
            if (!Number.isFinite(massValue) || massValue <= 0) {
                throw new Error('Mass must be a positive number.');
            }
            massUnitValue = (mass_unit || 'mg').toLowerCase();
            if (!MASS_UNITS.includes(massUnitValue)) {
                throw new Error('Mass unit must be one of: mg, g, kg, mcg, ug.');
            }
        }

                // 1. Validate packaging / dispensing master data via the shared utility.
        //    Throws a client-safe message on invalid input.
        const packaging = validatePackagingInput({
            base_unit, units_per_strip, strips_per_inner_box,
            inner_boxes_per_outer_box, allow_open_package,
            sell_price_unit, sell_price_strip, sell_price_inner_box,
            sell_price_outer_box, dispense_dose, dispense_frequency,
            dispense_frequency_interval, dispense_duration_days, dispense_route,
        });

        // 1. Create Medicine
        const insertMed = `
            INSERT INTO medicines (
                category_id, sub_category_id, generic_name, brand_name,
                strength, dosage_form, manufacturer, country, route, prescription_type,
                description, indications, contraindications, side_effects,
                warnings, storage_conditions, reorder_level, max_level,
                mass, mass_unit, image_url,
                pronunciation_english, pronunciation_amharic,
                base_unit, units_per_strip, strips_per_inner_box,
                inner_boxes_per_outer_box, allow_open_package,
                sell_price_unit, sell_price_strip, sell_price_inner_box,
                sell_price_outer_box,
                dispense_dose, dispense_frequency, dispense_frequency_interval,
                dispense_duration_days, dispense_route
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)
            RETURNING medicine_id
        `;
        const medValues = [
            category_id || null, sub_category_id || null, generic_name, brand_name,
            strength, dosage_form, manufacturer || null, country || null, route, prescription_type,
            description, indications, contraindications, side_effects,
            warnings, storage_conditions, reorder_level || 50, max_level || 500,
            massValue, massUnitValue, req.body.image_url || null,
            // Optional pronunciation guides (empty string → NULL, keeps DB clean)
            (req.body.pronunciation_english || '').trim() || null,
            (req.body.pronunciation_amharic || '').trim() || null,
            // Packaging / dispensing master data (validated above)
                        packaging.base_unit || null,
            packaging.units_per_strip || null,
            packaging.strips_per_inner_box || null,
            packaging.inner_boxes_per_outer_box || null,
            packaging.allow_open_package !== undefined ? packaging.allow_open_package : true,
            packaging.sell_price_unit || null,
            packaging.sell_price_strip || null,
            packaging.sell_price_inner_box || null,
            packaging.sell_price_outer_box || null,
            packaging.dispense_dose || null,
            packaging.dispense_frequency || null,
            packaging.dispense_frequency_interval || null,
            packaging.dispense_duration_days || null,
            packaging.dispense_route || null,
        ];

        const medResult = await client.query(insertMed, medValues);
        const medicine_id = medResult.rows[0].medicine_id;

        await client.query(`INSERT INTO audit_logs (user_id, action, module, table_name, record_id, new_values, ip_address, user_agent, session_id) VALUES ($1,$2,'MEDICINES',$3,$4,$5,$6,$7,$8)`, [current_user_id, 'MEDICINE_CREATED', 'medicines', medicine_id, JSON.stringify({ generic_name, brand_name, description: `Registered ${generic_name} ${brand_name || ''}` }), req.ipAddress || null, req.userAgent || null, req.sessionId || null]);

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
        const msg = err?.message || '';
        if (msg.includes('must be unique') || msg.includes('Strength must match') || msg.includes('must be atleast') || msg.includes('does not match') || msg.includes('Mass must be') || msg.includes('Mass unit must be') || msg.includes('Clinical Text') || msg === 'Strength is required') {
            res.status(400).json({ error: msg, details: msg });
        } else {
            res.status(500).json({ error: 'Failed to create medicine', details: msg });
        }
    } finally {
        client.release();
    }
};

// Update existing medicine master details
exports.updateMedicine = async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const medicineId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(medicineId) || medicineId <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid medicine ID.' });
        }
                const {
            category_id, sub_category_id, generic_name, brand_name,
            strength, dosage_form, manufacturer, country, route, prescription_type,
            description, indications, contraindications, side_effects,
            warnings, storage_conditions, status, reorder_level, max_level, mass, mass_unit, user_id
            , image_url,
            // Packaging / dispensing master data
            base_unit,
            units_per_strip,
            strips_per_inner_box,
            inner_boxes_per_outer_box,
            allow_open_package,
            sell_price_unit,
            sell_price_strip,
            sell_price_inner_box,
            sell_price_outer_box,
            dispense_dose,
            dispense_frequency,
            dispense_frequency_interval,
            dispense_duration_days,
            dispense_route
        } = req.body;

        const current_user_id = req.user && req.user.user_id;

        if (!current_user_id) {
            return res.status(401).json({ error: 'Authenticated staff account required' });
        }

        const target = await client.query(
            'SELECT medicine_id, generic_name, category_id, sub_category_id FROM medicines WHERE medicine_id = $1 FOR UPDATE',
            [medicineId]
        );
        if (target.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Medicine not found' });
        }

        // Create rejects any matching generic name; update ignores only the
        // row being edited. Existing databases may already contain duplicate
        // legacy records, so unchanged names must remain editable.
        const normalizedCurrentName = String(target.rows[0].generic_name || '').trim();
        const normalizedName = generic_name === undefined || generic_name === null
            ? normalizedCurrentName
            : String(generic_name).trim();
        const genericNameChanged = normalizedName.toLowerCase() !== normalizedCurrentName.toLowerCase();
        if (genericNameChanged && normalizedName) {
            const existing = await client.query(
                `SELECT medicine_id
                 FROM medicines
                 WHERE LOWER(TRIM(generic_name)) = LOWER(TRIM($1::text))
                   AND medicine_id <> $2::bigint`,
                [normalizedName, medicineId]
            );
            if (existing.rows.length > 0) {
                throw new Error('Generic Name must be unique in the database.');
            }
        }

        if (strength) {
            const normalized = String(strength).trim();
            if (!normalized) {
                throw new Error('Strength is required.');
            }
            // Accept formats like: 500 mg, 250mg, 5 mL, 100 IU, 10%, 250mg/5mL, 1:1000, etc.
            const strRegex = /^\d+(?:\.\d+)?\s*(?:%|mg|g|mcg|μ|ug|ml|l|iu|units?|meq|mmol)?(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:%|mg|g|mcg|μ|ug|ml|l|iu|units?|meq|mmol)?)?$/i;
            if (!strRegex.test(normalized)) {
                throw new Error('Strength must match standard pharmaceutical formats (e.g., 500 mg, 250mg, 5 mL, 100 IU, 10%).');
            }
        }

        if (category_id && sub_category_id) {
            const validSub = await client.query('SELECT 1 FROM sub_categories WHERE category_id = $1 AND sub_category_id = $2', [category_id, sub_category_id]);
            if (validSub.rows.length === 0) {
                throw new Error('Subcategory does not match the selected Main Category.');
            }
        }
// Inactive master records cannot be newly ASSIGNED on update. A medicine
        // that already keeps a historical (now-inactive) category/subcategory
        // may be re-saved unchanged — only genuinely new assignments must be ACTIVE.
        const currentCategory = target.rows[0].category_id !== null ? Number(target.rows[0].category_id) : null;
        const currentSubcategory = target.rows[0].sub_category_id !== null ? Number(target.rows[0].sub_category_id) : null;
        const nextCategory = category_id === undefined || category_id === null || category_id === ''
            ? currentCategory
            : Number(category_id);
        const nextSubcategory = sub_category_id === undefined || sub_category_id === null || sub_category_id === ''
            ? currentSubcategory
            : Number(sub_category_id);

        if (nextCategory !== currentCategory && nextCategory) {
            const cat = await client.query('SELECT status FROM categories WHERE category_id = $1', [nextCategory]);
            if (cat.rows.length === 0) {
                throw new Error('Selected Category does not exist.');
            }
            if (cat.rows[0].status !== 'ACTIVE') {
                throw new Error('This category is inactive. Reactivate it before assigning new medicines to it.');
            }
        }
        if (nextSubcategory !== currentSubcategory && nextSubcategory) {
            const sub = await client.query('SELECT status FROM sub_categories WHERE sub_category_id = $1', [nextSubcategory]);
            if (sub.rows.length === 0) {
                throw new Error('Selected Subcategory does not exist.');
            }
            if (sub.rows[0].status !== 'ACTIVE') {
                throw new Error('This subcategory is inactive. Reactivate it before assigning new medicines to it.');
            }
            const validSub = await client.query('SELECT 1 FROM sub_categories WHERE category_id = $1 AND sub_category_id = $2', [nextCategory, nextSubcategory]);
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

        const MASS_UNITS = ['mg', 'g', 'kg', 'mcg', 'μg', 'ug'];
        let massValue = null;
        let massUnitValue = null;
        if (mass !== undefined && mass !== null && mass !== '') {
            massValue = Number(mass);
            if (!Number.isFinite(massValue) || massValue <= 0) {
                throw new Error('Mass must be a positive number.');
            }
            massUnitValue = (mass_unit || 'mg').toLowerCase();
            if (!MASS_UNITS.includes(massUnitValue)) {
                throw new Error('Mass unit must be one of: mg, g, kg, mcg, ug.');
            }
                }

        // 2. Validate packaging / dispensing master data via the shared utility.
        //    Only processes fields that are actually present in the request.
        const packaging = validatePackagingInput(req.body);

        // Build UPDATE dynamically — only send the fields actually provided.
        // This avoids NOT NULL conflicts on columns the client didn't touch, and
        // keeps parameter indices in sync with the SET clause.
        const setClauses = [];
        const values = [];
        let idx = 1;

        const push = (sql, val) => { setClauses.push(`${sql} = $${idx}`); values.push(val); idx++; };

        if (category_id !== undefined && category_id !== null && category_id !== '') push('category_id', Number(category_id));
        if (sub_category_id !== undefined && sub_category_id !== null && sub_category_id !== '') push('sub_category_id', Number(sub_category_id));
        if (generic_name !== undefined && generic_name !== null && generic_name !== '') push('generic_name', generic_name);
        if (brand_name !== undefined && brand_name !== null && brand_name !== '') push('brand_name', brand_name);
        if (strength !== undefined && strength !== null && strength !== '') push('strength', strength);
        if (dosage_form !== undefined && dosage_form !== null && dosage_form !== '') push('dosage_form', dosage_form);
        if (manufacturer !== undefined && manufacturer !== null && manufacturer !== '') push('manufacturer', manufacturer);
        if (country !== undefined && country !== null && country !== '') push('country', country);
        if (route !== undefined && route !== null && route !== '') push('route', route);
        if (prescription_type !== undefined && prescription_type !== null && prescription_type !== '') push('prescription_type', prescription_type);
        if (description !== undefined) push('description', description || null);
        if (indications !== undefined) push('indications', indications || null);
        if (contraindications !== undefined) push('contraindications', contraindications || null);
        if (side_effects !== undefined) push('side_effects', side_effects || null);
        if (warnings !== undefined) push('warnings', warnings || null);
        if (storage_conditions !== undefined) push('storage_conditions', storage_conditions || null);
        if (status !== undefined && status !== null && status !== '') push('status', String(status).toUpperCase());
        if (reorder_level !== undefined && reorder_level !== null && reorder_level !== '') push('reorder_level', Number(reorder_level));
        if (max_level !== undefined && max_level !== null && max_level !== '') push('max_level', Number(max_level));
        if (massValue !== null) push('mass', massValue);
        if (massUnitValue !== null) push('mass_unit', massUnitValue);
        if (image_url !== undefined) push('image_url', image_url || null);
                if (req.body.pronunciation_english !== undefined) push('pronunciation_english', (req.body.pronunciation_english || '').trim() || null);
        if (req.body.pronunciation_amharic !== undefined) push('pronunciation_amharic', (req.body.pronunciation_amharic || '').trim() || null);

        // Packaging / dispensing master data (validated above — only present fields)
        if (packaging.base_unit !== undefined) push('base_unit', packaging.base_unit || null);
        if (packaging.units_per_strip !== undefined) push('units_per_strip', packaging.units_per_strip || null);
        if (packaging.strips_per_inner_box !== undefined) push('strips_per_inner_box', packaging.strips_per_inner_box || null);
        if (packaging.inner_boxes_per_outer_box !== undefined) push('inner_boxes_per_outer_box', packaging.inner_boxes_per_outer_box || null);
        if (packaging.allow_open_package !== undefined) push('allow_open_package', packaging.allow_open_package);
        if (packaging.sell_price_unit !== undefined) push('sell_price_unit', packaging.sell_price_unit || null);
        if (packaging.sell_price_strip !== undefined) push('sell_price_strip', packaging.sell_price_strip || null);
        if (packaging.sell_price_inner_box !== undefined) push('sell_price_inner_box', packaging.sell_price_inner_box || null);
        if (packaging.sell_price_outer_box !== undefined) push('sell_price_outer_box', packaging.sell_price_outer_box || null);
        if (packaging.dispense_dose !== undefined) push('dispense_dose', packaging.dispense_dose || null);
        if (packaging.dispense_frequency !== undefined) push('dispense_frequency', packaging.dispense_frequency || null);
        if (packaging.dispense_frequency_interval !== undefined) push('dispense_frequency_interval', packaging.dispense_frequency_interval || null);
        if (packaging.dispense_duration_days !== undefined) push('dispense_duration_days', packaging.dispense_duration_days || null);
        if (packaging.dispense_route !== undefined) push('dispense_route', packaging.dispense_route || null);

        if (setClauses.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No fields to update. Provide at least one field to change.' });
        }

        setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
        const updateMed = `
            UPDATE medicines
            SET ${setClauses.join(', ')}
            WHERE medicine_id = $${idx}
            RETURNING *
        `;
        values.push(medicineId);

        const result = await client.query(updateMed, values);
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Medicine not found' });
        }
        
        await client.query(`INSERT INTO audit_logs (user_id, action, module, table_name, record_id, new_values, ip_address, user_agent, session_id) VALUES ($1,$2,'MEDICINES',$3,$4,$5,$6,$7,$8)`, [current_user_id, 'MEDICINE_UPDATED', 'medicines', medicineId, JSON.stringify({ generic_name, brand_name, description: `Updated ${generic_name || 'unknown'} ${brand_name || ''}` }), req.ipAddress || null, req.userAgent || null, req.sessionId || null]);

        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);

        // Validation errors (thrown intentionally) → 400 with details.
        // Database / unexpected errors → 500.
        const msg = err?.message || '';
        if (msg.includes('must be unique') || msg.includes('Strength must match') || msg.includes('must be atleast') || msg.includes('does not match') || msg.includes('Mass must be') || msg.includes('Mass unit must be') || msg.includes('Clinical Text') || msg === 'Strength is required' || msg === 'No fields to update.') {
            res.status(400).json({ error: msg, details: msg });
        } else {
            res.status(500).json({ error: 'Server Error', details: msg });
        }
    } finally {
        client.release();
    }
};

/*
 * Set medicine status — PATCH /api/medicines/:id/status  { status }
 *
 * ADMIN-ONLY (route-level requireAdmin). Flips ACTIVE ↔ INACTIVE and keeps
 * the row, batches, sales, movements and audit history fully intact. An
 * INACTIVE medicine stays visible everywhere for management/reporting but is
 * excluded from every sellable surface (POS list, scan/QR lookups and sale
 * validation).
 */
exports.setMedicineStatus = async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const requested = String(req.body?.status || '').toUpperCase();
        if (!['ACTIVE', 'INACTIVE'].includes(requested)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Status must be ACTIVE or INACTIVE.' });
        }

        const current = await client.query(
            `SELECT medicine_id, generic_name, brand_name, strength, status
             FROM medicines WHERE medicine_id = $1 FOR UPDATE`,
            [id]
        );
        if (current.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Medicine not found' });
        }

        if (current.rows[0].status === requested) {
            await client.query('ROLLBACK');
            return res.json({ medicine_id: id, status: requested, message: `Medicine is already ${requested}` });
        }

        const result = await client.query(
            `UPDATE medicines SET status = $1, updated_at = CURRENT_TIMESTAMP
             WHERE medicine_id = $2
             RETURNING medicine_id, generic_name, status`,
            [requested, id]
        );

        const current_user_id = req.user && req.user.user_id;
        const medicineName = `${current.rows[0].generic_name || 'Unknown'}${current.rows[0].strength ? ` ${current.rows[0].strength}` : ''}`.trim();
        if (current_user_id) {
            await client.query(
                `INSERT INTO audit_logs (user_id, action, module, table_name, record_id, entity_type, entity_id, description, old_values, new_values, ip_address, user_agent, session_id, status)
                 VALUES ($1, $2, 'MEDICINES', 'medicines', $3, 'medicine', $3, $4, $5, $6, $7, $8, $9, 'SUCCESS')`,
                [
                    current_user_id,
                    requested === 'ACTIVE' ? 'MEDICINE_ACTIVATED' : 'MEDICINE_DEACTIVATED',
                    id,
                    `Medicine "${medicineName}" ${requested === 'ACTIVE' ? 'activated' : 'deactivated'}`,
                    JSON.stringify({ status: current.rows[0].status }),
                    JSON.stringify({ status: requested, medicine_name: medicineName }),
                    req.ipAddress || null,
                    req.userAgent || null,
                    req.sessionId || null,
                ]
            );
        }

        await client.query('COMMIT');
        try { require('../socket').getIO().emit('data_updated', { topic: 'medicine', medicine_id: id }); } catch (_) {}
        res.json(result.rows[0]);
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error(err);
        res.status(500).json({ error: 'Failed to update medicine status', details: err?.message || '' });
    } finally {
        client.release();
    }
};
/*
 * Permanent delete — DELETE /api/medicines/:id  (ADMIN-ONLY)
 *
 * REAL delete, never a UI hide:
 *   1. BEGIN
 *   2. Lock the medicine row
 *   3. Check every historical record that must survive for pharmacy
 *      accountability (sales, resupplies, stock movements, physical counts).
 *   4. If any exist → ROLLBACK + 409 explaining the medicine must be
 *      deactivated instead of deleted.
 *   5. Safety allows deletion → remove the medicine's batches (which carries
 *      current inventory away with it — no orphan stock) then the medicine.
 *   6. Audit log records the performer, the medicine name and the action.
 *   7. COMMIT / ROLLBACK on failure — never a half-deleted inventory.
 */
exports.hardDeleteMedicine = async (req, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const { id } = req.params;

        const med = await client.query(
            `SELECT medicine_id, generic_name, brand_name, strength, status
             FROM medicines WHERE medicine_id = $1 FOR UPDATE`,
            [id]
        );
        if (med.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Medicine not found' });
        }

        const medicineName = `${med.rows[0].generic_name || 'Unknown'}${med.rows[0].strength ? ` ${med.rows[0].strength}` : ''}`.trim();

        /*
         * DEPENDENCY CHECK — historical business records that MUST survive:
         * completed sales, sale items, resupply history, stock movement
         * history, physical count records. Any reference through a batch of
         * this medicine blocks the permanent delete.
         */
        const depResult = await client.query(`
            SELECT
              (SELECT COUNT(*)::int FROM sale_items si JOIN batches b ON si.batch_id = b.batch_id WHERE b.medicine_id = $1) AS sales,
              (SELECT COUNT(*)::int FROM resupply_items ri JOIN batches b ON ri.batch_id = b.batch_id WHERE b.medicine_id = $1) AS resupplies,
              (SELECT COUNT(*)::int FROM stock_movements sm JOIN batches b ON sm.batch_id = b.batch_id WHERE b.medicine_id = $1) AS stock_movements,
              (SELECT COUNT(*)::int FROM physical_count_items pci JOIN batches b ON pci.batch_id = b.batch_id WHERE b.medicine_id = $1) AS physical_counts
        `, [id]);
        const deps = depResult.rows[0] || {};
        const protectedDeps = [
            { key: 'sales', label: 'sales records' },
            { key: 'resupplies', label: 'resupply history' },
            { key: 'stock_movements', label: 'stock movement history' },
            { key: 'physical_counts', label: 'physical count records' },
        ].filter((d) => Number(deps[d.key] || 0) > 0);

        if (protectedDeps.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: `Cannot permanently delete this medicine. This medicine has historical ${protectedDeps.map((d) => d.label).join(', ')}. Deactivate it instead to preserve pharmacy history.`,
                code: 'HISTORICAL_RECORDS_EXIST',
                protected: protectedDeps.map((d) => d.key),
            });
        }

        // Delete current inventory/batches first (explicit — any unexpected FK
        // reference fails the transaction here, before the medicine is gone).
        await client.query('DELETE FROM batches WHERE medicine_id = $1', [id]);
        const result = await client.query('DELETE FROM medicines WHERE medicine_id = $1 RETURNING medicine_id', [id]);

        const current_user_id = req.user && req.user.user_id;
        if (current_user_id) {
            await client.query(
                `INSERT INTO audit_logs (user_id, action, module, table_name, record_id, entity_type, entity_id, description, new_values, ip_address, user_agent, session_id, status)
                 VALUES ($1, $2, 'MEDICINES', 'medicines', $3, 'medicine', $3, $4, $5, $6, $7, $8, 'SUCCESS')`,
                [
                    current_user_id,
                    'MEDICINE_DELETED_PERMANENT',
                    id,
                    `Medicine "${medicineName}" permanently deleted by ${req.user?.full_name || req.user?.username || `user #${current_user_id}`}`,
                    JSON.stringify({
                        medicine_name: medicineName,
                        generic_name: med.rows[0].generic_name,
                        brand_name: med.rows[0].brand_name,
                        strength: med.rows[0].strength,
                        status_before: med.rows[0].status,
                        performed_by: current_user_id,
                    }),
                    req.ipAddress || null,
                    req.userAgent || null,
                    req.sessionId || null,
                ]
            );
        }

        await client.query('COMMIT');
        try { require('../socket').getIO().emit('data_updated', { topic: 'medicine_deleted', medicine_id: id }); } catch (_) {}
        res.json({ message: `Medicine "${medicineName}" permanently deleted.`, medicine_id: id });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error(err);
        // FK violation could mean a relation we did not check still blocks the
        // deletion — report it as an unsafe delete rather than a 500.
        if (err.code === '23503') {
            return res.status(409).json({
                error: 'Cannot permanently delete this medicine. It is still referenced by historical pharmacy records. Deactivate it instead to preserve pharmacy history.',
                code: 'HISTORICAL_RECORDS_EXIST',
            });
        }
        res.status(500).json({ error: 'Failed to permanently delete medicine', details: err?.message || '' });
    } finally {
        client.release();
    }
};

// Bulk Import Preview — delegated to the shared import service
// (normalized duplicate detection, batch-field validation, supplier matching).
exports.previewImport = async (req, res) => {
    try {
        const { medicines, rows } = req.body;
        const payload = Array.isArray(rows) ? rows : medicines;
        if (!payload || !Array.isArray(payload)) {
            return res.status(400).json({ error: 'Invalid payload' });
        }
        const preview = await importService.previewImport(payload, req.body.mode || 'batch');
        res.json(preview);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

// Bulk Import Confirm — single bulk database transaction + realtime broadcast.
exports.confirmImport = async (req, res) => {
    try {
        const { medicines, rows } = req.body;
        const payload = Array.isArray(rows) ? rows : medicines;
        if (!payload || !Array.isArray(payload)) {
            return res.status(400).json({ error: 'Invalid payload' });
        }
        const current_user_id = req.user && req.user.user_id;
        if (!current_user_id) {
            return res.status(401).json({ error: 'Authenticated staff account required' });
        }
        const stats = await importService.confirmImport(payload, current_user_id, req.body.mode || 'batch');
        res.json(stats);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Could not confirm import', details: err?.message || 'Unknown import error' });
    }
};

// Downloadable import template row set (CSV/JSON template generation).
// `type` selects the template: medicine | batch (default batch).
exports.importTemplate = async (req, res) => {
    const type = String(req.query.type || 'batch').toLowerCase();
    res.json(importService.templateRows[type] || importService.templateRows.batch);
};

