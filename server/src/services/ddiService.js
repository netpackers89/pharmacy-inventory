/**
 * ddiService.js
 *
 * LOCAL-FIRST drug–drug interaction checking.
 *
 * Architecture (per NET-PHARMA safety requirements):
 *   POS cart → normalize names → unique sorted pairs → local ddi_interactions
 *   table (seeded from the structured fallback dataset) → structured alerts.
 *
 * The AI/Gemini service is NOT the authoritative interaction source.
 * Matching is ORDER-INDEPENDENT: pair keys are built from sorted,
 * normalized drug names, so Warfarin+Ibuprofen == Ibuprofen+Warfarin.
 */

const db = require('../config/db');
const { RAW_INTERACTIONS, normalizeDrugName } = require('../data/ddiDataset');

/** Seed the ddi_interactions table once (idempotent). */
async function ensureDdiSeeded() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ddi_interactions (
        ddi_id bigserial PRIMARY KEY,
        drug_a VARCHAR(150) NOT NULL,
        drug_b VARCHAR(150) NOT NULL,
        severity SMALLINT NOT NULL DEFAULT 3 CHECK (severity IN (1, 2, 3)),
        category VARCHAR(150),
        mechanism TEXT,
        clinical_effect TEXT,
        recommended_action TEXT,
        source VARCHAR(50) DEFAULT 'LOCAL_FALLBACK_V1',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (drug_a, drug_b)
      );
    `);

    const count = await db.query('SELECT COUNT(*) AS c FROM ddi_interactions');
    if (parseInt(count.rows[0].c) > 0) return; // already seeded / maintained in DB

    // Canonical order-independent storage: drug_a < drug_b
    for (const entry of RAW_INTERACTIONS) {
      const a = normalizeDrugName(entry.pair[0]);
      const b = normalizeDrugName(entry.pair[1]);
      const [drug_a, drug_b] = [a, b].sort();
      await db.query(`
        INSERT INTO ddi_interactions
          (drug_a, drug_b, severity, category, mechanism, clinical_effect, recommended_action, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'LOCAL_FALLBACK_V1')
        ON CONFLICT (drug_a, drug_b) DO NOTHING;
      `, [drug_a, drug_b, entry.severity, entry.category || null,
          entry.mechanism || null, entry.clinical_effect || null, entry.recommended_action || null]);
    }
    console.log(`DDI dataset seeded (${RAW_INTERACTIONS.length} interactions).`);
  } catch (err) {
    console.error('[DDI SEED]', err.message);
  }
}

/**
 * Check a list of medicine names for interactions.
 * @param {string[]} names
 * @returns {{ checked: number, hasInteractions: boolean, alerts: Array, source: 'LOCAL_DDI' }}
 */
async function checkInteractions(names) {
  const list = (Array.isArray(names) ? names : [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);

  if (list.length < 2) {
    return { checked: list.length, hasInteractions: false, alerts: [], source: 'LOCAL_DDI' };
  }

  // Unique normalized names → unique unordered pairs only (A+B, A+C, B+C — never A+A).
  const normalized = [...new Set(list.map(normalizeDrugName))];

  const pairs = [];
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      pairs.push([normalized[i], normalized[j]].sort());
    }
  }

  if (!pairs.length) {
    return { checked: normalized.length, hasInteractions: false, alerts: [], source: 'LOCAL_DDI' };
  }

  let rows = [];
  try {
    // Order-independent lookup against the canonical stored pair.
    const conditions = [];
    const params = [];
    let idx = 1;
    for (const [a, b] of pairs) {
      conditions.push(
        `((drug_a = $${idx} AND drug_b = $${idx + 1}) OR (drug_a = $${idx + 1} AND drug_b = $${idx}))`
      );
      params.push(a, b);
      idx += 2;
    }

    const result = await db.query(`
      SELECT ddi_id, drug_a, drug_b, severity, category, mechanism,
             clinical_effect, recommended_action, source
      FROM ddi_interactions
      WHERE active = TRUE AND (${conditions.join(' OR ')})
    `, params);
    rows = result.rows;
  } catch (err) {
    console.error('[DDI CHECK] DB error:', err.message);
    return {
      checked: normalized.length,
      hasInteractions: false,
      alerts: [],
      source: 'UNAVAILABLE',
      error: 'Interaction database unavailable — pharmacist judgement required.',
    };
  }

  // Map back to the display names the user actually entered.
  const byCanonical = new Map(list.map((n) => [normalizeDrugName(n), n]));
  const seen = new Set();

  const alerts = [];
  for (const row of rows) {
    // Deduplicate reverse-direction duplicates defensively.
    const key = [row.drug_a, row.drug_b].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const displayA = byCanonical.get(row.drug_a) || row.drug_a;
    const displayB = byCanonical.get(row.drug_b) || row.drug_b;

    alerts.push({
      id: row.ddi_id,
      severity: Number(row.severity),          // 1 Critical | 2 High | 3 Moderate
      drugs: [displayA, displayB],
      title:
        Number(row.severity) === 1 ? 'Critical Interaction'
        : Number(row.severity) === 2 ? 'Important Interaction'
        : 'Interaction Notice',
      category: row.category || null,
      mechanism: row.mechanism || null,
      clinical_effect: row.clinical_effect || null,
      recommended_action: row.recommended_action || null,
      requires_review: Number(row.severity) <= 2,   // pharmacist review before dispensing
      blocks_checkout: false,                        // no automatic hard-stops; configurable later
      source: row.source || 'LOCAL_DDI',
    });
  }

  alerts.sort((a, b) => a.severity - b.severity);
  return {
    checked: normalized.length,
    hasInteractions: alerts.length > 0,
    alerts,
    source: 'LOCAL_DDI',
  };
}

module.exports = { checkInteractions, ensureDdiSeeded };
