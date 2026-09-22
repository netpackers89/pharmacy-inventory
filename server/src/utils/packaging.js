/**
 * packaging.js — the single source of truth for the unit / packaging system.
 *
 * CORE PRINCIPLE: inventory is ALWAYS counted in one BASE UNIT (a single
 * dose / single product). A medicine may additionally define an exact
 * packaging chain:
 *
 *   1 base unit ──(units_per_strip)──> 1 STRIP
 *   1 strip ──(strips_per_inner_box)──> 1 INNER BOX
 *   1 inner box ──(inner_boxes_per_outer_box)──> 1 OUTER BOX
 *
 * Every factor is an exact integer stored per medicine — never a range and
 * never a hardcoded assumption. Levels that are not configured stay NULL and
 * are simply not offered as a selling/dispensing unit.
 *
 * Both the medicine controller (writing master data) and the sales controller
 * (converting dispensing units into base units server-side, never trusting
 * the client) use these helpers, so POS, resupply and inventory can never
 * drift apart.
 */

const SELLING_UNITS = ['SINGLE_DOSE', 'STRIP', 'INNER_BOX', 'OUTER_BOX'];

const BASE_UNITS = [
  'TABLET', 'CAPSULE', 'BOTTLE', 'TUBE', 'VIAL', 'AMPOULE',
  'INJECTION', 'SACHET', 'PIECE', 'UNIT',
];

/* Human labels used by the POS / medicine views. */
const BASE_UNIT_LABELS = {
  TABLET: 'tablet',
  CAPSULE: 'capsule',
  BOTTLE: 'bottle',
  TUBE: 'tube',
  VIAL: 'vial',
  AMPOULE: 'ampoule',
  INJECTION: 'injection',
  SACHET: 'sachet',
  PIECE: 'piece',
  UNIT: 'unit',
};

const UNIT_LABELS = {
  SINGLE_DOSE: 'Single',
  STRIP: 'Strip',
  INNER_BOX: 'Inner Box',
  OUTER_BOX: 'Outer Box',
};

/** Derive a sensible base unit from the dosage form (fallback: UNIT). */
function baseUnitFromDosageForm(dosageForm) {
  const form = String(dosageForm || '').toUpperCase();
  if (/TAB|\bTABLET/.test(form)) return 'TABLET';
  if (/CAPSULE|CAP\b/.test(form)) return 'CAPSULE';
  if (/BOTTLE|SUSPENSION|SYRUP|DROP|SOLUTION/.test(form)) return 'BOTTLE';
  if (/TUBE|CREAM|GEL|OINTMENT|PASTE/.test(form)) return 'TUBE';
  if (/VIAL/.test(form)) return 'VIAL';
  if (/AMPOULE/.test(form)) return 'AMPOULE';
  if (/INJECTION|INJECTABLE/.test(form)) return 'INJECTION';
  if (/SACHET|POWDER/.test(form)) return 'SACHET';
  return 'UNIT';
}

/** Positive exact integer (≥1) or null/undefined → null. */
function optionalPositiveInt(value, { min = 1 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const int = Math.floor(n);
  if (int < min || int !== n) return null;
  return int;
}

/** Non-negative price or null/undefined → null. */
function optionalPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Normalize a medicine record into a packaging descriptor.
 * Unknown/absent levels are null; the chain is only as deep as configured.
 */
function normalizePackaging(med) {
  const unitsPerStrip = optionalPositiveInt(med?.units_per_strip, { min: 2 });
  const stripsPerInner = optionalPositiveInt(med?.strips_per_inner_box, { min: 2 });
  const innerPerOuter = optionalPositiveInt(med?.inner_boxes_per_outer_box, { min: 2 });

  const baseUnit = BASE_UNITS.includes(String(med?.base_unit || '').toUpperCase())
    ? String(med.base_unit).toUpperCase()
    : baseUnitFromDosageForm(med?.dosage_form);

  const allowOpen = med?.allow_open_package === undefined
    ? true
    : Boolean(med.allow_open_package);

  /* Cumulative base units per selling unit (null = level not configured). */
  const factors = {
    SINGLE_DOSE: 1,
    STRIP: unitsPerStrip,
    INNER_BOX: unitsPerStrip && stripsPerInner ? unitsPerStrip * stripsPerInner : null,
    OUTER_BOX: unitsPerStrip && stripsPerInner && innerPerOuter
      ? unitsPerStrip * stripsPerInner * innerPerOuter
      : null,
  };

  return {
    base_unit: baseUnit,
    base_unit_label: BASE_UNIT_LABELS[baseUnit] || 'unit',
    units_per_strip: unitsPerStrip,
    strips_per_inner_box: unitsPerStrip ? stripsPerInner : null,
    inner_boxes_per_outer_box: stripsPerInner ? innerPerOuter : null,
    allow_open_package: allowOpen,
    factors,
    selling_units: SELLING_UNITS.filter((u) => factors[u] !== null),
  };
}

/** Exact base units contained in ONE of the given selling units (or null). */
function baseUnitsFor(packaging, unit) {
  const key = String(unit || '').toUpperCase();
  if (!SELLING_UNITS.includes(key)) return null;
  const factor = packaging.factors[key];
  return factor === null || factor === undefined ? null : factor;
}
/**
 * Configured commercial price per selling unit (may be null → derive from
 * the batch's per-dose price and mark the result as calculated).
 */
function configuredPriceFor(med, unit) {
  const map = {
    SINGLE_DOSE: 'sell_price_unit',
    STRIP: 'sell_price_strip',
    INNER_BOX: 'sell_price_inner_box',
    OUTER_BOX: 'sell_price_outer_box',
  };
  const column = map[String(unit || '').toUpperCase()];
  if (!column) return null;
  const price = optionalPrice(med?.[column]);
  return price === null ? null : price;
}

/**
 * Validate + sanitize the packaging fields sent to the medicine API.
 * Throws a client-safe message on invalid input; returns the clean subset.
 */
function validatePackagingInput(body = {}) {
  const out = {};

  if (body.base_unit !== undefined) {
    const unit = String(body.base_unit || '').toUpperCase().trim();
    if (unit && !BASE_UNITS.includes(unit)) {
      throw new Error(`base_unit must be one of: ${BASE_UNITS.join(', ')}`);
    }
    if (unit) out.base_unit = unit; // empty → leave unchanged / use the dosage-form default
  }

  for (const [field, requires] of [
    ['units_per_strip', null],
    ['strips_per_inner_box', 'units_per_strip'],
    ['inner_boxes_per_outer_box', 'strips_per_inner_box'],
  ]) {
    if (body[field] !== undefined) {
      if (body[field] === null || body[field] === '') {
        out[field] = null;
        continue;
      }
      const n = Number(body[field]);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 2) {
        throw new Error(`${field} must be a whole number of 2 or more (exact packaging — ranges are not allowed)`);
      }
      out[field] = n;
    }
  }

  if (
    out.strips_per_inner_box !== undefined &&
    out.strips_per_inner_box !== null &&
    out.units_per_strip === null
  ) {
    throw new Error('strips_per_inner_box requires units_per_strip to be configured first');
  }
  if (
    out.inner_boxes_per_outer_box !== undefined &&
    out.inner_boxes_per_outer_box !== null &&
    out.strips_per_inner_box === null
  ) {
    throw new Error('inner_boxes_per_outer_box requires strips_per_inner_box to be configured first');
  }

  if (body.allow_open_package !== undefined) {
    out.allow_open_package = Boolean(body.allow_open_package);
  }

  for (const field of [
    'sell_price_unit', 'sell_price_strip',
    'sell_price_inner_box', 'sell_price_outer_box',
  ]) {
    if (body[field] !== undefined) {
      if (body[field] === null || body[field] === '') {
        out[field] = null;
        continue;
      }
      const n = Number(body[field]);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`${field} must be a positive amount`);
      }
      out[field] = Math.round(n * 100) / 100;
    }
  }

  for (const field of ['dispense_dose', 'dispense_duration_days']) {
    if (body[field] !== undefined) {
      if (body[field] === null || body[field] === '') {
        out[field] = null;
        continue;
      }
      const n = Number(body[field]);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`${field} must be 1 or more`);
      }
      out[field] = field === 'dispense_dose' ? Math.round(n * 100) / 100 : Math.floor(n);
    }
  }

  if (body.dispense_frequency !== undefined) {
    const code = String(body.dispense_frequency || '').toUpperCase().trim();
    out.dispense_frequency = code || null;
  }
  if (body.dispense_frequency_interval !== undefined) {
    if (body.dispense_frequency_interval === null || body.dispense_frequency_interval === '') {
      out.dispense_frequency_interval = null;
    } else {
      const n = Number(body.dispense_frequency_interval);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error('dispense_frequency_interval must be 1 or more');
      }
      out.dispense_frequency_interval = Math.round(n * 100) / 100;
    }
  }
  if (body.dispense_route !== undefined) {
    const route = String(body.dispense_route || '').toUpperCase().trim();
    out.dispense_route = route || null;
  }

  return out;
}

module.exports = {
  SELLING_UNITS,
  BASE_UNITS,
  BASE_UNIT_LABELS,
  UNIT_LABELS,
  baseUnitFromDosageForm,
  normalizePackaging,
  baseUnitsFor,
  configuredPriceFor,
  validatePackagingInput,
};
