/**
 * searchController.js — ONE global search across the whole application.
 *
 * Returns grouped results (Medicines / Batches / Stock Movements / Pages) so a
 * single navbar input can find a medicine, a batch number, a document
 * reference or an application page.
 *
 * SEARCHABLE FIELDS ARE REAL
 *   Only columns that exist in the current schema are queried — the same ones
 *   already used elsewhere in this project (generic_name, brand_name, strength,
 *   dosage_form, barcode, therapeutic_class, batch_number, …).
 *
 * PERMISSIONS
 *   The global authentication gate in app.js already requires a valid session.
 *   Audit records are ADMIN-only, so they are only offered to administrators;
 *   a guest therefore cannot discover restricted records through search.
 */

const db = require('../config/db');

/** Minimum characters before a search runs. */
const MIN_CHARS = 2;
const MEDICINE_LIMIT = 8;
const BATCH_LIMIT = 8;
const MOVEMENT_LIMIT = 6;

/** Application pages available to search and navigate to. */
const PAGES = [
  { id: 'dashboard', label: 'Dashboard', keywords: 'home overview kpi summary' },
  { id: 'drugs', label: 'Medicines (Drug Directory)', keywords: 'drugs medicines catalogue create edit abc ven' },
  { id: 'inventory', label: 'Inventory & Stock', keywords: 'stock batches expiry bincard movements adjustments counts' },
  { id: 'pos', label: 'Point of Sale', keywords: 'pos sell sale checkout prescription dispense' },
  { id: 'import', label: 'Import Medicines', keywords: 'import csv excel bulk upload' },
  { id: 'suppliers', label: 'Suppliers', keywords: 'suppliers vendors distributor' },
  { id: 'reports', label: 'Reports & Audit Log', keywords: 'reports analytics audit excel telegram bincard' },
  { id: 'settings', label: 'Settings', keywords: 'settings users categories pricing appearance theme audit' },
];

const like = (q) => `%${String(q).toLowerCase()}%`;

async function searchMedicines(q) {
  const { rows } = await db.query(`
    SELECT m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form,
           m.barcode, COALESCE(m.base_unit, 'UNIT') AS base_unit,
           COALESCE(m.reorder_level, 0)::int AS reorder_level,
           COALESCE(SUM(b.stock_quantity), 0)::int AS stock
      FROM medicines m
      LEFT JOIN batches b ON b.medicine_id = m.medicine_id AND b.status <> 'INACTIVE'
      LEFT JOIN categories c ON c.category_id = m.category_id
     WHERE LOWER(m.generic_name) LIKE $1
        OR LOWER(COALESCE(m.brand_name, '')) LIKE $1
        OR LOWER(COALESCE(m.strength, '')) LIKE $1
        OR LOWER(COALESCE(m.dosage_form, '')) LIKE $1
        OR LOWER(COALESCE(m.route, '')) LIKE $1
        OR LOWER(COALESCE(m.barcode, '')) LIKE $1
        OR LOWER(COALESCE(c.name, '')) LIKE $1
     GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form,
              m.barcode, m.base_unit, m.reorder_level
     ORDER BY m.generic_name ASC
     LIMIT $2
  `, [like(q), MEDICINE_LIMIT]);

  return rows.map((r) => ({
    type: 'medicine',
    id: r.medicine_id,
    title: r.generic_name,
    subtitle: [r.brand_name, r.strength, r.dosage_form].filter(Boolean).join(' · '),
    meta: `${r.stock} ${r.base_unit}`,
    stockState: r.stock <= 0 ? 'out' : (r.reorder_level > 0 && r.stock <= r.reorder_level ? 'low' : 'ok'),
    target: 'medicine-details',
    medicineId: r.medicine_id,
  }));
}

/** Audit records — ADMIN-ONLY. Guests/pharmacists never reach this query. */
async function searchAudit(q) {
  const { rows } = await db.query(`
    SELECT al.audit_id, al.created_at, al.action, al.module, al.description,
           COALESCE(u.full_name, 'System') AS full_name
      FROM audit_logs al
      LEFT JOIN users u ON u.user_id = al.user_id
     WHERE LOWER(COALESCE(al.action, '')) LIKE $1
        OR LOWER(COALESCE(al.description, '')) LIKE $1
     ORDER BY al.created_at DESC
     LIMIT $2
  `, [like(q), 5]);
  return rows.map((r) => ({
    type: 'audit',
    id: r.audit_id,
    title: r.action,
    subtitle: `${r.full_name} · ${String(r.created_at).slice(0, 16)}`,
    meta: r.module || '',
    target: 'audit-log',
  }));
}

async function searchBatches(q) {
  const { rows } = await db.query(`
    SELECT b.batch_id, b.batch_number, b.expiry_date, b.stock_quantity,
           m.medicine_id, m.generic_name, m.strength
      FROM batches b
      JOIN medicines m ON m.medicine_id = b.medicine_id
     WHERE LOWER(b.batch_number) LIKE $1
        OR LOWER(m.generic_name) LIKE $1
        OR LOWER(COALESCE(m.brand_name, '')) LIKE $1
     ORDER BY b.expiry_date ASC NULLS LAST
     LIMIT $2
  `, [like(q), BATCH_LIMIT]);

  return rows.map((r) => ({
    type: 'batch',
    id: r.batch_id,
    title: r.batch_number,
    subtitle: `${r.generic_name}${r.strength ? ` · ${r.strength}` : ''}`,
    meta: r.expiry_date ? `Exp ${String(r.expiry_date).slice(0, 10)}` : 'No expiry',
    extra: `Qty ${r.stock_quantity}`,
    target: 'medicine-bincard',
    medicineId: r.medicine_id,
  }));
}

async function searchMovements(q) {
  const { rows } = await db.query(`
    SELECT sm.movement_id, sm.movement_date, sm.movement_type, sm.quantity,
           b.batch_number, m.generic_name
      FROM stock_movements sm
      JOIN batches b ON b.batch_id = sm.batch_id
      JOIN medicines m ON m.medicine_id = b.medicine_id
     WHERE LOWER(m.generic_name) LIKE $1
        OR LOWER(COALESCE(b.batch_number, '')) LIKE $1
        OR LOWER(COALESCE(sm.notes, '')) LIKE $1
        OR LOWER(COALESCE(sm.reason, '')) LIKE $1
     ORDER BY sm.movement_date DESC, sm.movement_id DESC
     LIMIT $2
  `, [like(q), MOVEMENT_LIMIT]);

  return rows.map((r) => ({
    type: 'movement',
    id: r.movement_id,
    title: `${r.movement_type} · ${r.generic_name}`,
    subtitle: `Batch ${r.batch_number || '—'} · ${String(r.movement_date).slice(0, 10)}`,
    meta: `${Number(r.quantity) > 0 ? '+' : ''}${r.quantity}`,
    target: 'inventory-movements',
    medicineId: r.generic_name,
  }));
}

function searchPages(q) {
  const needle = String(q).toLowerCase();
  return PAGES
    .filter((p) => p.label.toLowerCase().includes(needle) || p.keywords.includes(needle))
    .slice(0, 6)
    .map((p) => ({ type: 'page', id: p.id, title: p.label, subtitle: 'Application page', target: 'page', page: p.id }));
}

/** GET /api/search?q=… */
exports.globalSearch = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < MIN_CHARS) {
      return res.json({ success: true, query: q, groups: [], total: 0 });
    }

    const isAdmin = req.user?.role === 'ADMIN';
    const [medicines, batches, movements, audit] = await Promise.all([
      searchMedicines(q).catch(() => []),
      searchBatches(q).catch(() => []),
      searchMovements(q).catch(() => []),
      // Audit records are administrator-only.
      isAdmin ? searchAudit(q).catch(() => []) : Promise.resolve([]),
    ]);
    const pages = searchPages(q);

    const groups = [
      { key: 'medicines', label: 'Medicines', items: medicines },
      { key: 'batches', label: 'Batches', items: batches },
      { key: 'movements', label: 'Stock Movements', items: movements },
      { key: 'audit', label: 'Audit Log', items: audit },
      { key: 'pages', label: 'Pages', items: pages },
    ].filter((g) => g.items.length > 0);

    res.json({
      success: true,
      query: q,
      groups,
      total: groups.reduce((sum, g) => sum + g.items.length, 0),
    });
  } catch (err) {
    console.error('[SEARCH]', err.message);
    res.status(500).json({ success: false, error: 'Search is unavailable right now.', groups: [], total: 0 });
  }
};

/** GET /api/search/pages — the static page list. */
exports.searchPagesOnly = async (_req, res) => {
  res.json({ success: true, pages: PAGES.map((p) => ({ id: p.id, label: p.label, keywords: p.keywords })) });
};

// Assigned as `exports.*` above, so they must be re-exported explicitly.
module.exports = {
  globalSearch: exports.globalSearch,
  searchPagesOnly: exports.searchPagesOnly,
  PAGES,
  MIN_CHARS,
};