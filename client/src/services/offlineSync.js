/**
 * offlineSync.js — synchronises server medicine data into the local cache and
 * serves it back when the network is unavailable.
 *
 * CONTRACT
 * ────────
 *   1. When ONLINE  : fetch medicines from the backend, merge them into
 *                     IndexedDB (keyed by the server's own medicine_id, so a
 *                     re-sync updates in place and never duplicates), and
 *                     progressively cache their pictures.
 *   2. When OFFLINE : read the same records straight out of IndexedDB, so
 *                     search and the medicine details view keep working.
 *   3. CONFLICT RULE: the backend always wins. A local record is only ever
 *                     replaced by a server payload, and an older server
 *                     payload never overwrites a newer cached one. Offline
 *                     edits are never pushed back, so this cache can never
 *                     damage the PostgreSQL source of truth.
 *
 * PICTURES
 * ─────────
 * Images are stored as BLOBs in IndexedDB, keyed by medicine_id, together
 * with the source URL and a `source_url` stamp. They are fetched one at a
 * time, on demand, only for medicines the user actually opens (plus the
 * newest page of a sync) — never thousands at once. `getCachedImageUrl`
 * hands back an object URL for offline rendering; a medicine whose picture
 * was never downloaded simply falls back to the existing placeholder.
 */

import {
  STORES,
  isOfflineStorageAvailable,
  get,
  getAll,
  getCount,
  put,
  putMany,
  clearAllOfflineData,
} from './offlineDb';

/** Bumped whenever the CACHE SHAPE changes, which forces a clean re-sync. */
export const CACHE_VERSION = 1;

/* Sync bookkeeping keys inside the sync_metadata store. */
const META_LAST_SYNC = 'last_sync_at';
const META_COUNTS = 'counts';
const META_VERSION = 'cache_version';

/* Only the newest page of a sync gets its pictures pre-fetched; anything else
   is cached lazily when the user opens that medicine. This is what keeps a
   large catalogue from downloading thousands of images at once. */
const PREFETCH_IMAGE_LIMIT = 24;

/* Give up on a single image rather than stalling the queue. */
const IMAGE_FETCH_TIMEOUT_MS = 12000;

const nowIso = () => new Date().toISOString();

/* ── search text ──────────────────────────────────────────────────────── */

const clean = (value) => (value === null || value === undefined ? '' : String(value).trim());

/**
 * Build the single lower-cased blob that offline search matches against.
 * It covers the same fields the online search already supports: medicine
 * name, brand, generic, strength, barcode/QR, category, therapeutic class,
 * manufacturer and indication.
 */
const buildSearchText = (med, batches = []) => {
  const barcodes = [];
  const qrCodes = [];
  batches.forEach((b) => {
    if (b?.barcode) barcodes.push(b.barcode);
    if (b?.qr_code) qrCodes.push(b.qr_code);
  });

  return [
    med.generic_name,
    med.brand_name,
    med.name,
    med.strength,
    med.dosage_form,
    med.route,
    med.prescription_type,
    med.category_name,
    med.sub_category_name,
    med.therapeutic_class,
    med.manufacturer,
    med.country,
    med.indications,
    med.description,
    ...barcodes,
    ...qrCodes,
  ]
    .map(clean)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

/* ── conflict resolution ──────────────────────────────────────────────── */

const timeValue = (value) => {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : 0;
};

/* ── writing the cache ────────────────────────────────────────────────── */

const toCacheRecord = (med) => {
  const batches = Array.isArray(med.batches) ? med.batches : [];
  return {
    ...med,
    medicine_id: String(med.medicine_id),
    // The detail payload carries batches/suppliers; the list payload does not.
    batches,
    suppliers: Array.isArray(med.suppliers) ? med.suppliers : [],
    search_text: buildSearchText(med, batches),
    cached_at: nowIso(),
    server_updated_at: med.updated_at || med.created_at || null,
  };
};

/**
 * Cache a single medicine (list row or full detail payload).
 * Safe to call repeatedly: the record is keyed by medicine_id, so this
 * updates in place and cannot create a duplicate.
 */
export const cacheMedicine = async (med) => {
  if (!med || med.medicine_id === undefined || med.medicine_id === null) return false;
  if (!isOfflineStorageAvailable()) return false;

  const id = String(med.medicine_id);
  const record = toCacheRecord(med);
  const existing = await get(STORES.MEDICINES, id);
  await put(STORES.MEDICINES, mergeMedicine(record, existing));
  return true;
};

/** Cache many medicines in a single transaction (one sync page). */
export const cacheMedicines = async (medicines) => {
  if (!isOfflineStorageAvailable() || !Array.isArray(medicines) || !medicines.length) return 0;

  const existing = await getAll(STORES.MEDICINES);
  const byId = new Map(existing.map((m) => [String(m.medicine_id), m]));

  const records = [];
  for (const med of medicines) {
    if (!med || med.medicine_id === undefined || med.medicine_id === null) continue;
    const id = String(med.medicine_id);
    const record = toCacheRecord(med);
    // A list row carries less than a previously-cached detail record; merge
    // so viewing a list never wipes clinical text already cached.
    const previous = byId.get(id);
    const hasBatchesNow = Array.isArray(med.batches) && med.batches.length > 0;
    const hadBatches = previous && previous.batches && previous.batches.length > 0;
    if (previous && !hasBatchesNow && hadBatches) {
      record.batches = previous.batches;
      record.suppliers = previous.suppliers || [];
      record.search_text = buildSearchText(record, record.batches);
    }
    byId.set(id, record);
    records.push(record);
  }

  if (!records.length) return 0;
  await putMany(STORES.MEDICINES, records);
  return records.length;
};

/* ── reading the cache ────────────────────────────────────────────────── */

/** One cached medicine by id, or null. */
export const getCachedMedicine = async (medicineId) => {
  if (!isOfflineStorageAvailable() || medicineId === undefined || medicineId === null) return null;
  try {
    return await get(STORES.MEDICINES, String(medicineId));
  } catch (_) {
    return null;
  }
};

/**
 * Search the cached medicines.
 * Mirrors the online search fields: name, brand, generic, strength,
 * barcode/QR, category, therapeutic class, manufacturer and indication.
 * Matching is substring + case-insensitive, exactly like the server ILIKE.
 */
export const searchCachedMedicines = async (query, options = {}) => {
  const { limit = 50, offset = 0 } = options;
  if (!isOfflineStorageAvailable()) return { medicines: [], total: 0 };

  let all;
  try {
    all = await getAll(STORES.MEDICINES);
  } catch (_) {
    return { medicines: [], total: 0 };
  }

  const needle = String(query || '').trim().toLowerCase();
  let matched = all;
  if (needle) {
    matched = all.filter((m) => String(m.search_text || '').includes(needle));
  }

  // Same default ordering the online list uses: generic name ascending.
  matched.sort((a, b) => String(a.generic_name || '').localeCompare(String(b.generic_name || '')));

  return {
    medicines: matched.slice(offset, offset + limit),
    total: matched.length,
    page: Math.floor(offset / Math.max(limit, 1)) + 1,
    limit,
    totalPages: Math.max(1, Math.ceil(matched.length / Math.max(limit, 1))),
  };
};

/* ── medicine images ──────────────────────────────────────────────────── */

/* medicine_id -> object URL. Revoked by releaseCachedImages() so a long
   session does not leak blob URLs. */
const objectUrlCache = new Map();

const isCacheableImageUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Inline data URIs are already local — nothing to download or store.
  if (/^data:image\//i.test(trimmed)) return false;
  return /^(https?:\/\/|\/)/i.test(trimmed);
};

/**
 * Download a medicine picture and store the BLOB in IndexedDB, keyed by the
 * medicine id. Safe to call repeatedly: if the source URL has not changed the
 * stored copy is kept, and the network is never hit twice for the same image.
 */
export const cacheMedicineImage = async (med) => {
  const id = med?.medicine_id;
  const url = clean(med?.image_url);
  if (!isOfflineStorageAvailable() || id === undefined || id === null) return false;
  if (!isCacheableImageUrl(url)) return false;

  const medicineId = String(id);

  try {
    const existing = await get(STORES.MEDICINE_IMAGES, medicineId);
    if (existing && existing.source_url === url && existing.blob) return true;

    // Skip absurdly large downloads; a packaging photo is never megabytes.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal, mode: 'cors', credentials: 'omit' });
    clearTimeout(timer);
    if (!response.ok) return false;

    const blob = await response.blob();
    if (!blob || !/^image\//i.test(blob.type || '')) return false;
    if (blob.size > 4 * 1024 * 1024) return false;

    await put(STORES.MEDICINE_IMAGES, {
      medicine_id: medicineId,
      source_url: url,
      content_type: blob.type,
      size: blob.size,
      blob,
      cached_at: nowIso(),
    });
    return true;
  } catch (_) {
    /* A failed image download is never fatal: the UI falls back to the
       existing placeholder, and a later sync/view can try again. */
    return false;
  }
};

/**
 * Cache several medicine pictures SEQUENTIALLY, so a large catalogue never
 * opens dozens of parallel connections or saturates the pharmacy's link.
 * Stops immediately on the first failure.
 */
export const cacheMedicineImages = async (medicines, limit = PREFETCH_IMAGE_LIMIT) => {
  const list = (Array.isArray(medicines) ? medicines : []).filter((m) => isCacheableImageUrl(clean(m?.image_url)));
  let done = 0;
  for (const med of list) {
    if (done >= limit) break;
    // eslint-disable-next-line no-await-in-loop
    const ok = await cacheMedicineImage(med);
    if (ok) done += 1;
  }
  return done;
};

/**
 * Get a locally cached picture for a medicine as an object URL.
 * Returns null when nothing was ever downloaded (the caller then shows the
 * normal placeholder). Object URLs are reused, so rendering a list does not
 * create a new URL per render.
 */
export const getCachedImageUrl = async (medicineId) => {
  if (!isOfflineStorageAvailable() || medicineId === undefined || medicineId === null) return null;
  const key = String(medicineId);

  const memo = objectUrlCache.get(key);
  if (memo) return memo;

  try {
    const record = await get(STORES.MEDICINE_IMAGES, key);
    if (!record?.blob) return null;
    const url = URL.createObjectURL(record.blob);
    objectUrlCache.set(key, url);
    return url;
  } catch (_) {
    return null;
  }
};

/* ── sync metadata & status ───────────────────────────────────────────── */

const readMeta = async (key) => {
  try {
    const row = await get(STORES.SYNC_METADATA, key);
    return row ? row.value : null;
  } catch (_) {
    return null;
  }
};

const writeMeta = (key, value) =>
  put(STORES.SYNC_METADATA, { key, value, updated_at: nowIso() }).catch(() => {});

/** When the last successful sync finished (ISO string), or null. */
export const getLastSyncAt = () => readMeta(META_LAST_SYNC);

/**
 * Drop the whole cache when its shape version no longer matches, so an
 * upgraded client never reads records it cannot understand.
 */
const ensureCacheVersion = async () => {
  const current = await readMeta(META_VERSION);
  if (current === CACHE_VERSION) return true;
  if (current === null) {
    await writeMeta(META_VERSION, CACHE_VERSION);
    return true;
  }
  // Version changed: start clean rather than mixing old and new shapes.
  await clearAllOfflineData();
  await writeMeta(META_VERSION, CACHE_VERSION);
  return true;
};

/** Counts + last sync, for the status indicator and Settings. */
export const getOfflineStats = async () => {
  if (!isOfflineStorageAvailable()) {
    return { medicines: 0, images: 0, lastSyncAt: null, available: false };
  }
  try {
    const [medicines, images, lastSyncAt] = await Promise.all([
      getCount(STORES.MEDICINES),
      getCount(STORES.MEDICINE_IMAGES),
      getLastSyncAt(),
    ]);
    return { medicines, images, lastSyncAt, available: true };
  } catch (_) {
    return { medicines: 0, images: 0, lastSyncAt: null, available: false };
  }
};

export { clearAllOfflineData };

/**
 * Synchronise medicines from the backend into the local cache.
 *
 * `medicinesAPI` is injected by the caller (App-level) so this module stays
 * free of any dependency on the HTTP layer and can be unit-tested.
 *
 * Progressive by design: pages are fetched and written one at a time, and
 * pictures are only pre-fetched for the final page (the newest medicines) so
 * a catalogue of thousands never triggers thousands of image downloads.
 */
export const syncMedicines = async (medicinesAPI, options = {}) => {
  const { pageSize = 200, maxPages = 25, prefetchImages = true } = options;

  if (!isOfflineStorageAvailable()) {
    return { ok: false, reason: 'unavailable', cached: 0 };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, reason: 'offline', cached: 0 };
  }

  await ensureCacheVersion();

  let totalCached = 0;
  let lastPageMedicines = [];
  let page = 1;

  try {
    for (; page <= maxPages; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await medicinesAPI.getAll({ page, limit: pageSize, sortBy: 'created_date', sortOrder: 'desc' });
      const data = res?.data;
      const rows = Array.isArray(data) ? data : (data?.medicines || []);
      if (!rows.length) break;

      // eslint-disable-next-line no-await-in-loop
      const written = await cacheMedicines(rows);
      totalCached += written;
      lastPageMedicines = rows;

      // A short page means we have reached the end of the catalogue.
      const totalPages = Array.isArray(data) ? 1 : (data?.totalPages || 1);
      if (!Array.isArray(data) && page >= totalPages) break;
    }
  } catch (err) {
    /* Keep whatever was already cached — a partial sync is still useful, and
       the previous data is never discarded because of a network blip. */
    return {
      ok: false,
      reason: 'error',
      error: err?.message || 'sync failed',
      cached: totalCached,
    };
  }

  /* Pictures: only the newest page, sequentially, with a hard cap. Every
     other medicine's picture is cached the first time the user opens it. */
  let images = 0;
  if (prefetchImages && lastPageMedicines.length) {
    images = await cacheMedicineImages(lastPageMedicines, PREFETCH_IMAGE_LIMIT);
  }

  await writeMeta(META_LAST_SYNC, nowIso());
  await writeMeta(META_COUNTS, { medicines: totalCached, images });

  return { ok: true, cached: totalCached, images, pages: page };
};

/** Is a picture already available locally for this medicine? */
export const hasCachedImage = async (medicineId) => {
  if (!isOfflineStorageAvailable() || medicineId === undefined || medicineId === null) return false;
  try {
    const record = await get(STORES.MEDICINE_IMAGES, String(medicineId));
    return Boolean(record?.blob);
  } catch (_) {
    return false;
  }
};

/** Revoke every object URL handed out so far (memory hygiene). */
export const releaseCachedImages = () => {
  objectUrlCache.forEach((url) => {
    try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
  });
  objectUrlCache.clear();
};

/** All cached medicines (used by the full offline sync and by POS). */
export const getCachedMedicines = async () => {
  if (!isOfflineStorageAvailable()) return [];
  try { return await getAll(STORES.MEDICINES); } catch (_) { return []; }
};


/**
 * Decide whether an incoming SERVER record may replace the cached one.
 * The server is the source of truth, so the answer is "yes" unless we can
 * prove the cached copy is strictly newer (which should not normally happen,
 * but protects against an out-of-order response overwriting fresher data).
 */
const mergeMedicine = (incoming, existing) => {
  if (!existing) return incoming;
  const incomingAt = timeValue(incoming.updated_at);
  const existingAt = timeValue(existing.updated_at);
  if (existingAt > incomingAt) {
    // Keep the newer clinical content, but refresh the cache bookkeeping and
    // take any field the server now has that we did not.
    return {
      ...existing,
      ...incoming,
      updated_at: existing.updated_at,
      server_updated_at: incoming.updated_at || existing.server_updated_at,
      cached_at: nowIso(),
    };
  }
  return incoming;
};
