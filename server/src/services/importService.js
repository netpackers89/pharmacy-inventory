const db = require('../config/db');
const { emitDataUpdated } = require('../socket');

/*
 * INVENTORY IMPORT SERVICE
 *
 * One unified workflow for Batch + Resupply importing (CSV / JSON rows).
 * The row itself decides what it does:
 *
 *   New medicine identity        -> medicine is created
 *   Existing medicine identity   -> resupply: new batch / stock increase
 *   Existing batch number        -> duplicate (stock increase on same batch)
 *
 * Medicine identity rule (duplicate protection):
 *   normalize(Generic Name) + normalize(Brand Name) + normalize(Strength)
 *   Normalization removes case, extra spaces and "500mg" vs "500 mg" drift.
 */

/* ── Normalization helpers ──────────────────────────────────────────────── */

const clean = (v) => (typeof v === 'string' ? v.trim() : (v ?? ''));

/** Collapse whitespace and lowercase. */
const normText = (v) => clean(v).replace(/\s+/g, ' ').toLowerCase();

/**
 * Normalize a strength string: "  500MG " -> "500 mg", "250  mcg" -> "250 mcg".
 * Inserts a single space between number and unit when missing.
 */
const normStrength = (v) =>
  normText(String(clean(v)).replace(/(\d)\s*(mg|g|mcg|μg|ug|ml|l|iu|units?|meq|mmol|%)\b/gi, '$1 $2'))
    .replace(/\s*\/\s*/g, '/');

const normalizePrescriptionType = (value) => {
  const normalized = normText(value).replace(/[\s_-]+/g, '');
  if (normalized === 'rx' || normalized === 'prescription' || normalized === 'prescriptiononly') return 'PRESCRIPTION';
  if (normalized === 'controlled' || normalized === 'controlleddrug') return 'CONTROLLED';
  return 'OTC';
};

const normalizeMassUnit = (value) => {
  const normalized = normText(value).replace('μ', 'u');
  return ['mg', 'g', 'kg', 'mcg', 'ug'].includes(normalized) ? normalized : null;
};

/** Identity key used for duplicate detection. */
const identityKey = (row) =>
  [normText(row.generic_name), normText(row.brand_name), normStrength(row.strength)].join('||');

/** Alias map so real-world CSV headers map to canonical fields. */
const FIELD_ALIASES = {
  generic_name: ['generic_name', 'generic', 'genericname', 'generic name', 'molecule'],
  brand_name: ['brand_name', 'brand', 'brandname', 'brand name', 'trade name'],
  strength: ['strength', 'dose', 'dosage', 'strength/dose'],
  mass: ['mass', 'weight', 'mass/weight', 'mass_value', 'mass value'],
  mass_unit: ['mass_unit', 'mass unit', 'weight unit', 'unit'],
  dosage_form: ['dosage_form', 'form', 'dosage form', 'dosageform'],
  route: ['route', 'route of administration', 'route_of_admin'],
  category: ['category', 'main category', 'therapeutic category'],
  subcategory: ['subcategory', 'sub category', 'sub_category', 'sub-category'],
  prescription_type: ['prescription_type', 'prescription', 'rx type', 'prescription type'],
  manufacturer: ['manufacturer', 'maker', 'company'],
  country: ['country', 'origin', 'country/origin'],
  image_url: ['image_url', 'image', 'image url', 'picture', 'photo', 'medicine image url'],
  description: ['description', 'what is it'],
  indications: ['indications', 'uses'],
  contraindications: ['contraindications', 'do not use', 'contraindication'],
  side_effects: ['side_effects', 'side effects'],
  warnings: ['warnings', 'serious warnings'],
  storage_conditions: ['storage_conditions', 'storage'],
  counseling_points: ['counseling_points', 'counseling', 'counseling points'],
  batch_number: ['batch_number', 'batch', 'batch number', 'batchno', 'lot'],
  expiry_date: ['expiry_date', 'expiry', 'expiry date', 'expiration', 'exp'],
  quantity: ['quantity', 'stock', 'qty', 'units received', 'stock_quantity'],
  buy_price: ['buy_price', 'buying_price', 'buy price', 'purchase price', 'cost'],
  sell_price: ['sell_price', 'selling_price', 'sell price', 'selling price', 'price'],
  supplier: ['supplier', 'supplier_name', 'supplier name'],
  packaging_unit: ['packaging_unit', 'packaging unit', 'packaging', 'pack unit', 'pack_unit', 'unit type', 'unit_type'],
  units_per_package: ['units_per_package', 'units per package', 'single doses per selected unit', 'doses_per_unit', 'doses per unit', 'unit size', 'unit_size', 'strip size', 'strip_size'],
  barcode: ['barcode', 'bar code'],
  qr_code: ['qr_code', 'qr code', 'qr'],
  abc_category: ['abc_category', 'abc category', 'abc'],
  ven_category: ['ven_category', 'ven category', 'ven'],
};

const normalizeHeader = (value) => String(value ?? '')
  .replace(/^\uFEFF/, '')
  .toLowerCase()
  .replace(/&amp;/g, '&')
  .replace(/\([^)]*\)/g, '')
  .replace(/[*:]/g, '')
  .replace(/[\\/\-_]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Map a raw CSV/JSON object (arbitrary header spellings) to canonical fields. */
exports.canonicalizeRow = (raw) => {
  const out = {};
  const lowered = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const key = normalizeHeader(k);
    lowered[key] = v;
  }
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const a of aliases) {
      const alias = normalizeHeader(a);
      if (lowered[alias] !== undefined && lowered[alias] !== '') { out[field] = clean(lowered[alias]); break; }
    }
  }
  return out;
};

/* ── Batch field completeness check ─────────────────────────────────────── */

const BATCH_FIELD_LABELS = {
  batch_number: 'Batch Number',
  expiry_date: 'Expiry Date',
  quantity: 'Units Received',
  buy_price: 'Buy Price',
  sell_price: 'Sell Price',
  supplier: 'Supplier',
  packaging_unit: 'Packaging Unit',
  units_per_package: 'Single doses per selected unit',
  barcode: 'Barcode',
  qr_code: 'QR Code',
  abc_category: 'ABC Category',
  ven_category: 'VEN Category',
};

const PACKAGING_UNITS = ['SINGLE_DOSE', 'STRIP', 'INNER_BOX', 'OUTER_BOX'];
const ABC_CATEGORIES = ['A', 'B', 'C'];
const VEN_CATEGORIES = ['V', 'E', 'N'];

const isValidDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const normalizePackagingUnit = (value) => {
  const unit = normText(value).replace(/[\s_-]+/g, '');
  if (unit === 'singledose' || unit === 'tablet' || unit === 'capsule' || unit === 'bottle' || unit === 'tube' || unit === 'vial') return 'SINGLE_DOSE';
  if (unit === 'strip' || unit === 'blister') return 'STRIP';
  if (unit === 'innerbox' || unit === 'pack') return 'INNER_BOX';
  if (unit === 'outerbox' || unit === 'box' || unit === 'carton') return 'OUTER_BOX';
  return null;
};

/**
 * Validate one canonicalized row.
 * Returns { status, issues, hasBatchInfo } where status is
 * 'ready' | 'error' | 'supplier_issue' | 'duplicate'.
 */
function validateRow(row) {
  const issues = [];
  const hasBatchInfo = !!(row.batch_number || row.expiry_date || row.quantity);

  if (!row.generic_name) issues.push({ field: 'generic_name', label: 'Generic Name', message: 'Generic name is required' });
  if (!row.strength) issues.push({ field: 'strength', label: 'Strength', message: 'Strength is required' });

  if (hasBatchInfo) {
    if (!row.supplier) issues.push({ field: 'supplier', label: 'Supplier', message: 'Supplier is required' });
    for (const [field, label] of Object.entries(BATCH_FIELD_LABELS)) {
      if (field === 'supplier') continue;
      if (field === 'qr_code' || field === 'barcode' || field === 'abc_category' || field === 'ven_category') continue; // optional fields
      if (!row[field]) issues.push({ field, label, message: `${label} is missing` });
    }
    if (row.expiry_date && !isValidDate(row.expiry_date)) {
      issues.push({ field: 'expiry_date', label: 'Expiry Date', message: 'Use YYYY-MM-DD' });
    }
    if (row.quantity && (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0)) {
      issues.push({ field: 'quantity', label: 'Units Received', message: 'Units received must be a positive number' });
    }
    if (row.buy_price && !Number.isFinite(Number(row.buy_price))) {
      issues.push({ field: 'buy_price', label: 'Buy Price', message: 'Must be a number' });
    }
    if (row.sell_price && !Number.isFinite(Number(row.sell_price))) {
      issues.push({ field: 'sell_price', label: 'Sell Price', message: 'Must be a number' });
    }
    if (row.units_per_package && (!Number.isFinite(Number(row.units_per_package)) || Number(row.units_per_package) < 1)) {
      issues.push({ field: 'units_per_package', label: 'Single doses per selected unit', message: 'Must be at least 1' });
    }
    if (row.packaging_unit && !normalizePackagingUnit(row.packaging_unit)) {
      issues.push({ field: 'packaging_unit', label: 'Packaging Unit', message: `Must be one of: ${PACKAGING_UNITS.join(', ')}` });
    }
    if (row.abc_category && !ABC_CATEGORIES.includes(String(row.abc_category).toUpperCase())) {
      issues.push({ field: 'abc_category', label: 'ABC Category', message: 'Must be A, B, or C' });
    }
    if (row.ven_category && !VEN_CATEGORIES.includes(String(row.ven_category).toUpperCase())) {
      issues.push({ field: 'ven_category', label: 'VEN Category', message: 'Must be V, E, or N' });
    }
  }

  return { hasBatchInfo, issues };
}

/* ── PREVIEW ────────────────────────────────────────────────────────────── */

/**
 * Build an editable import preview.
 * Efficient: loads medicines / suppliers ONCE and matches in memory instead
 * of issuing one query per row.
 */
exports.previewImport = async (rows, mode = 'batch') => {
  const canonicalRows = rows.map(exports.canonicalizeRow);
  const uploadedIdentities = new Set();

  const meds = await db.query(
    `SELECT medicine_id, generic_name, brand_name, strength, dosage_form FROM medicines`
  );
  const medIndex = new Map(); // identityKey -> medicine_id
  for (const m of meds.rows) {
    medIndex.set(
      [normText(m.generic_name), normText(m.brand_name), normStrength(m.strength)].join('||'),
      m.medicine_id
    );
  }

  const sups = await db.query(`SELECT supplier_id, name FROM suppliers`);
  const supplierIndex = new Map();
  for (const s of sups.rows) supplierIndex.set(normText(s.name), s.supplier_id);

  const preview = [];
  for (let i = 0; i < canonicalRows.length; i++) {
    const row = canonicalRows[i];
    const { hasBatchInfo, issues } = validateRow(row);

    // Medicine identity match
    const key = identityKey(row);
    const medicine_id = medIndex.get(key) || null;
    const repeatedInFile = uploadedIdentities.has(key);
    uploadedIdentities.add(key);

    // Supplier match by name
    let supplier_id = null;
    let supplierIssue = null;
    if (row.supplier) {
      supplier_id = supplierIndex.get(normText(row.supplier)) || null;
      if (!supplier_id) supplierIssue = row.supplier;
    }

    // Duplicate batch detection (same medicine + same batch number)
    let batch_id = null;
    let current_stock = null;
    let duplicate = false;
    if (medicine_id && row.batch_number) {
      const b = await db.query(
        `SELECT batch_id, stock_quantity FROM batches WHERE medicine_id = $1 AND LOWER(TRIM(batch_number)) = $2`,
        [medicine_id, normText(row.batch_number)]
      );
      if (b.rows.length > 0) {
        batch_id = b.rows[0].batch_id;
        current_stock = b.rows[0].stock_quantity;
        duplicate = true;
      }
    }

    let status = 'ready';
    if (issues.length > 0) status = 'error';
    else if (supplierIssue) status = 'supplier_issue';
    else if (duplicate || repeatedInFile) status = 'duplicate';

    preview.push({
      row_index: i,
      data: row,
      has_batch_info: hasBatchInfo,
      medicine_id,
      batch_id,
      current_stock,
      supplier_id,
      supplier_issue: supplierIssue,
      duplicate,
      repeated_in_file: repeatedInFile,
      issues,
      status,
      decision: !medicine_id
        ? 'new_medicine_new_batch'
        : duplicate
          ? 'existing_medicine_existing_batch'
          : 'existing_medicine_new_batch',
    });
  }
  return preview;
};

/* ── CONFIRM ────────────────────────────────────────────────────────────── */

/**
 * Commit the (already validated and user-edited) rows inside ONE transaction.
 * Supplier names create the supplier on the fly when no supplier_id is given.
 */
exports.confirmImport = async (rows, userId, mode = 'batch') => {
  const client = await db.getClient();
  const stats = { imported: 0, medicines_created: 0, medicines_updated: 0, batches_created: 0, stock_updated: 0, suppliers_created: 0, skipped: 0 };
  try {
    await client.query('BEGIN');

    // Restored databases may have a stale batch sequence even after startup
    // migrations. Align it inside the same transaction before inserting stock.
    if (mode !== 'medicine') {
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence('batches', 'batch_id'),
          COALESCE((SELECT MAX(batch_id) FROM batches), 0) + 1,
          false
        )
      `);
    }

    // In-memory caches grown during the loop so repeated identities stay fast.
    const supplierCache = new Map(); // normName -> id
    const medIndex = new Map();
    const importedBatchKeys = new Set();
    const meds = await client.query(`SELECT medicine_id, generic_name, brand_name, strength FROM medicines`);
    for (const m of meds.rows) {
      medIndex.set([normText(m.generic_name), normText(m.brand_name), normStrength(m.strength)].join('||'), m.medicine_id);
    }

    for (const raw of rows) {
      const row = exports.canonicalizeRow(raw);
      const { issues } = validateRow(row);
      if (issues.length > 0) { stats.skipped++; continue; }

      const key = [normText(row.generic_name), normText(row.brand_name), normStrength(row.strength)].join('||');
      if (mode === 'medicine') {
        // Medicine imports are identity-safe upserts: existing identities are
        // updated, never duplicated, so a complete file can repair master data.
        let category_id = null;
        let sub_category_id = null;
        if (row.category) {
          const categoryResult = await client.query(
            `SELECT category_id FROM categories WHERE LOWER(TRIM(name)) = LOWER($1) AND status = 'ACTIVE' LIMIT 1`,
            [clean(row.category)]
          );
          category_id = categoryResult.rows[0]?.category_id || null;
        }
        if (category_id && row.subcategory) {
          const subcategoryResult = await client.query(
            `SELECT sub_category_id FROM sub_categories WHERE category_id = $1 AND LOWER(TRIM(name)) = LOWER($2) AND status = 'ACTIVE' LIMIT 1`,
            [category_id, clean(row.subcategory)]
          );
          sub_category_id = subcategoryResult.rows[0]?.sub_category_id || null;
        }
        const existingMedicineId = medIndex.get(key);
        const medicineValues = [
          clean(row.generic_name), clean(row.brand_name) || clean(row.generic_name), clean(row.strength),
          row.mass !== undefined && row.mass !== '' && Number.isFinite(Number(row.mass)) ? Number(row.mass) : null,
          normalizeMassUnit(row.mass_unit), clean(row.dosage_form) || 'Solid', clean(row.route) || 'Oral',
          clean(row.manufacturer) || null, clean(row.country) || null, clean(row.image_url) || null,
          normalizePrescriptionType(row.prescription_type), category_id, sub_category_id, clean(row.description) || null,
          clean(row.indications) || null, clean(row.contraindications) || null, clean(row.side_effects) || null,
          clean(row.warnings) || null, clean(row.storage_conditions) || null,
        ];
        const medRes = existingMedicineId
          ? await client.query(
            `UPDATE medicines SET
               generic_name=$1, brand_name=$2, strength=$3, mass=$4, mass_unit=$5, dosage_form=$6,
               route=$7, manufacturer=$8, country=$9, image_url=$10, prescription_type=$11,
               category_id=$12, sub_category_id=$13, description=$14, indications=$15,
               contraindications=$16, side_effects=$17, warnings=$18, storage_conditions=$19,
               updated_at=CURRENT_TIMESTAMP
             WHERE medicine_id=$20 RETURNING medicine_id`,
            [...medicineValues, existingMedicineId]
          )
          : await client.query(
          `INSERT INTO medicines
             (generic_name, brand_name, strength, mass, mass_unit, dosage_form, route, manufacturer, country,
              image_url, prescription_type, category_id, sub_category_id, description, indications,
              contraindications, side_effects, warnings, storage_conditions)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           RETURNING medicine_id`,
          medicineValues
        );
        medIndex.set(key, medRes.rows[0].medicine_id);
        if (existingMedicineId) stats.medicines_updated = (stats.medicines_updated || 0) + 1;
        else stats.medicines_created++;
        stats.imported++;
        continue;
      }

      if (!row.quantity) { stats.skipped++; continue; }
      if (!row.batch_number || !isValidDate(row.expiry_date)) {
        throw new Error(`Batch ${row.batch_number || '(unnamed)'} requires a valid expiry date in YYYY-MM-DD format.`);
      }
      if (!Number.isFinite(Number(row.buy_price)) || Number(row.buy_price) <= 0 || !Number.isFinite(Number(row.sell_price)) || Number(row.sell_price) <= 0) {
        throw new Error(`Batch ${row.batch_number || '(unnamed)'} requires positive buy and sell prices.`);
      }
      const importedBatchKey = `${key}||${normText(row.batch_number)}`;
      if (importedBatchKeys.has(importedBatchKey)) { stats.skipped++; continue; }
      importedBatchKeys.add(importedBatchKey);

      const quantity = parseInt(row.quantity, 10);
      const buyPrice = Number(row.buy_price) || 0;
      const sellPrice = Number(row.sell_price) || 0;

      /* Supplier: existing id, match by name, or create inline. */
      let supplier_id = row.supplier_id ? Number(row.supplier_id) : null;
      if (!supplier_id && !row.supplier) {
        throw new Error(`Batch ${row.batch_number || '(unnamed)'} requires a registered supplier.`);
      }
      if (!supplier_id && row.supplier) {
        const nk = normText(row.supplier);
        if (supplierCache.has(nk)) {
          supplier_id = supplierCache.get(nk);
        } else {
          const found = await client.query(`SELECT supplier_id FROM suppliers WHERE LOWER(TRIM(name)) = $1`, [nk]);
          if (found.rows.length > 0) {
            supplier_id = found.rows[0].supplier_id;
          } else {
            const created = await client.query(
              `INSERT INTO suppliers (name) VALUES ($1) RETURNING supplier_id`, [row.supplier]
            );
            supplier_id = created.rows[0].supplier_id;
            stats.suppliers_created++;
          }
          supplierCache.set(nk, supplier_id);
        }
      }
      if (!supplier_id) {
        throw new Error(`Supplier could not be resolved for batch ${row.batch_number || '(unnamed)'}.`);
      }

      /* Medicine: match by identity, or create. */
      let medicine_id = medIndex.get(key) || null;
      if (!medicine_id) {
        // Resolve category / subcategory by name (silently skipped if unknown).
        let category_id = null;
        let sub_category_id = null;
        if (row.category) {
          const catRes = await client.query(
            `SELECT category_id FROM categories WHERE LOWER(TRIM(name)) = LOWER($1) AND status = 'ACTIVE' LIMIT 1`,
            [clean(row.category)]
          );
          if (catRes.rows.length > 0) category_id = catRes.rows[0].category_id;
        }
        if (category_id && row.subcategory) {
          const subRes = await client.query(
            `SELECT sub_category_id FROM sub_categories
             WHERE category_id = $1 AND LOWER(TRIM(name)) = LOWER($2) AND status = 'ACTIVE' LIMIT 1`,
            [category_id, clean(row.subcategory)]
          );
          if (subRes.rows.length > 0) sub_category_id = subRes.rows[0].sub_category_id;
        }

        // Parse mass / weight (e.g. "250 mg" or mass=250 + mass_unit=mg).
        let mass_value = null;
        let mass_unit = null;
        if (row.mass !== undefined && row.mass !== null && row.mass !== '') {
          const parsedMass = Number(row.mass);
          if (Number.isFinite(parsedMass) && parsedMass > 0) {
            mass_value = parsedMass;
            mass_unit = normalizeMassUnit(row.mass_unit) || 'mg';
          }
        }

        const medRes = await client.query(
          `INSERT INTO medicines
             (generic_name, brand_name, strength, mass, mass_unit, dosage_form, route, manufacturer, country,
              image_url, prescription_type, category_id, sub_category_id,
              description, indications, contraindications, side_effects, warnings, storage_conditions)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING medicine_id`,
          [
            clean(row.generic_name), clean(row.brand_name) || clean(row.generic_name),
            clean(row.strength), mass_value, mass_unit,
            clean(row.dosage_form) || 'Solid',
            clean(row.route) || 'Oral', clean(row.manufacturer) || null, clean(row.country) || null,
            clean(row.image_url) || null,
            normalizePrescriptionType(row.prescription_type),
            category_id, sub_category_id,
            clean(row.description) || null, clean(row.indications) || null,
            clean(row.contraindications) || null, clean(row.side_effects) || null,
            clean(row.warnings) || null, clean(row.storage_conditions) || null,
          ]
        );
        medicine_id = medRes.rows[0].medicine_id;
        medIndex.set(key, medicine_id);
        stats.medicines_created++;
      }

      /* Batch: existing batch -> stock increase; otherwise new batch. */
      let batch_id, previous_stock = 0;
      const batchCheck = await client.query(
        `SELECT batch_id, stock_quantity FROM batches WHERE medicine_id = $1 AND LOWER(TRIM(batch_number)) = $2`,
        [medicine_id, normText(row.batch_number)]
      );
      // Packaging fields: normalize and validate
      const unitKey = normalizePackagingUnit(row.packaging_unit) || 'SINGLE_DOSE';
      const dosesPerUnit = Math.max(1, Math.floor(Number(row.units_per_package) || 1));
      // Stock is tracked in SINGLE DOSES so existing FEFO deduction logic stays correct.
      const totalSingleDoses = quantity * dosesPerUnit;
      const buyPricePerDose = buyPrice / dosesPerUnit;
      const sellPricePerDose = sellPrice / dosesPerUnit;
      const barcode = clean(row.barcode) || null;
      const qrCode = clean(row.qr_code) || null;
      const abc = row.abc_category ? String(row.abc_category).toUpperCase() : null;
      const ven = row.ven_category ? String(row.ven_category).toUpperCase() : null;
      if (batchCheck.rows.length > 0) {
        batch_id = batchCheck.rows[0].batch_id;
        previous_stock = batchCheck.rows[0].stock_quantity;
        await client.query(
          `UPDATE batches SET stock_quantity = stock_quantity + $1,
            packaging_unit = COALESCE(packaging_unit, $2), units_per_package = COALESCE(units_per_package, $3),
            barcode = COALESCE(barcode, $4), qr_code = COALESCE(qr_code, $5),
            abc_category = COALESCE(abc_category, $6), ven_category = COALESCE(ven_category, $7),
            buy_price = COALESCE(buy_price, $8), sell_price = COALESCE(sell_price, $9)
          WHERE batch_id = $10`,
          [totalSingleDoses, unitKey, dosesPerUnit, barcode, qrCode, abc, ven, buyPricePerDose, sellPricePerDose, batch_id]
        );
        stats.stock_updated++;
      } else {
        const batchRes = await client.query(
          `INSERT INTO batches (medicine_id, supplier_id, batch_number, expiry_date, buy_price, sell_price, stock_quantity, barcode, qr_code, abc_category, ven_category, packaging_unit, units_per_package, single_doses_received)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING batch_id`,
          [medicine_id, supplier_id, clean(row.batch_number), row.expiry_date || null, buyPricePerDose, sellPricePerDose, totalSingleDoses, barcode, qrCode, abc, ven, unitKey, dosesPerUnit, totalSingleDoses]
        );
        batch_id = batchRes.rows[0].batch_id;
        stats.batches_created++;
      }

      await client.query(
        `INSERT INTO stock_movements (batch_id, user_id, movement_type, quantity, previous_stock, new_stock, notes)
         VALUES ($1,$2,'RESUPPLY',$3,$4,$5,$6)`,
        [batch_id, userId, totalSingleDoses, previous_stock, previous_stock + totalSingleDoses, 'Inventory Import']
      );
      stats.imported++;
    }

    await client.query('COMMIT');
    emitDataUpdated('inventory');
    emitDataUpdated('medicines');
    return stats;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/* ── CSV / JSON template row ────────────────────────────────────────────── */

exports.templateRows = {
  /* Medicine master-data template (no stock — importing a medicine does NOT add stock)
     Section A — Basic Drug Information
     Section B — Clinical Information                                    */
  medicine: [{
    generic_name: 'Paracetamol',
    brand_name: 'Panadol',
    strength: '500 mg',
    mass: '500',
    mass_unit: 'mg',
    dosage_form: 'Solid',
    manufacturer: 'GSK',
    country: 'UK',
    image_url: '',
    route: 'Oral',
    prescription_type: 'OTC',
    category: 'Analgesics',
    subcategory: 'Pain Relievers',
    description: 'Pain reliever and fever reducer',
    indications: 'Fever and mild to moderate pain',
    contraindications: 'Severe liver impairment',
    side_effects: 'Nausea, rash (rare)',
    warnings: 'Do not exceed 4 g per day',
    storage_conditions: 'Store below 25°C, protect from moisture',
  }],
  /* Batch / Resupply template — includes ALL fields from the Receive Stock form */
  batch: [{
    generic_name: 'Paracetamol',
    brand_name: 'Panadol',
    strength: '500 mg',
    batch_number: 'PAR-2026-01',
    supplier: 'ABC Pharmaceutical',
    expiry_date: '2028-06-30',
    packaging_unit: 'STRIP',
    units_per_package: '10',
    buy_price: '2.50',
    sell_price: '3.50',
    quantity: '500',
    barcode: '1234567890',
    qr_code: 'QR-PAR-001',
    abc_category: 'A',
    ven_category: 'V',
  }],
};