/**
 * offlineDb.js — the browser-side offline cache for NET-PHARMA.
 *
 * WHAT THIS IS (and what it is NOT)
 * ─────────────────────────────────
 * This is a READ-ONLY, SYNCHRONISED LOCAL CACHE of medicine data and medicine
 * pictures, so a pharmacist can still look up a medicine when the connection
 * is down. It is NOT a replacement for the PostgreSQL database, which always
 * remains the source of truth:
 *   • Nothing here is ever uploaded. There is no offline write queue, so a
 *     stale offline copy can never overwrite newer server data.
 *   • Records are keyed by their real `medicine_id` (the server's own primary
 *     key), so re-syncing UPDATES rows in place and can never create
 *     duplicates.
 *   • A cached record is only ever written from a server payload — see
 *     `offlineSync.mergeMedicine` for the newer-wins conflict rule.
 *
 * STORES
 *   medicines        full medicine rows, keyed by medicine_id, plus the
 *                    denormalised search text used for offline lookup
 *   medicine_images  image BLOBS keyed by the medicine they belong to, so a
 *                    picture already seen while online still renders offline
 *   sync_metadata    small key/value rows: when the last sync ran, how many
 *                    medicines/images are cached, and the cache version
 *
 * Written in plain ES5-compatible IndexedDB with no library, matching the
 * rest of this project (no extra dependencies).
 */

const DB_NAME = 'net_pharmacy_offline';
const DB_VERSION = 1;

export const STORES = {
  MEDICINES: 'medicines',
  MEDICINE_IMAGES: 'medicine_images',
  SYNC_METADATA: 'sync_metadata',
};

let dbPromise = null;
let unavailable = false;

/** Is IndexedDB usable at all? (Private-mode / disabled-storage browsers.) */
export const isOfflineStorageAvailable = () =>
  typeof window !== 'undefined' && 'indexedDB' in window && !unavailable;

const openDb = () => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!isOfflineStorageAvailable()) {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }

    let request;
    try {
      request = window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      unavailable = true;
      reject(err);
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORES.MEDICINES)) {
        const store = db.createObjectStore(STORES.MEDICINES, { keyPath: 'medicine_id' });
        store.createIndex('by_updated_at', 'updated_at', { unique: false });
        store.createIndex('by_cached_at', 'cached_at', { unique: false });
        store.createIndex('by_name', 'generic_name', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.MEDICINE_IMAGES)) {
        // Keyed by the medicine id, so a re-sync replaces the picture rather
        // than accumulating copies, and offline lookup is a direct get().
        db.createObjectStore(STORES.MEDICINE_IMAGES, { keyPath: 'medicine_id' });
      }

      if (!db.objectStoreNames.contains(STORES.SYNC_METADATA)) {
        db.createObjectStore(STORES.SYNC_METADATA, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // If another tab upgrades the schema, release our handle cleanly.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };

    request.onerror = () => {
      unavailable = true;
      dbPromise = null;
      reject(request.error || new Error('Could not open the offline database'));
    };
    request.onblocked = () => {
      reject(new Error('The offline database is blocked by another tab'));
    };
  });

  // A failed open must not poison every later call.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
};

/** Run `work(stores…, mode)` inside one transaction, resolved on commit. */
const withStore = async (storeNames, mode, fn) => {
  const db = await openDb();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];

  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(names, mode);
    } catch (err) {
      reject(err);
      return;
    }

    tx.oncomplete = () => resolve(tx._result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Offline transaction aborted'));

    try {
      const stores = names.map((name) => tx.objectStore(name));
      tx._result = fn(...stores);
    } catch (err) {
      try { tx.abort(); } catch (_) { /* already aborting */ }
      reject(err);
    }
  });
};

/* ── generic helpers ──────────────────────────────────────────────────── */

export const getAll = async (storeName) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

export const get = async (storeName, key) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
};

export const getCount = async (storeName) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).count();
    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
  });
};

export const put = (storeName, value) =>
  withStore(storeName, 'readwrite', (store) => { store.put(value); });

export const putMany = (storeName, values) =>
  withStore(storeName, 'readwrite', (store) => {
    values.forEach((value) => store.put(value));
  });

export const deleteRecord = (storeName, key) =>
  withStore(storeName, 'readwrite', (store) => { store.delete(key); });

export const clearStore = async (storeName) =>
  withStore(storeName, 'readwrite', (store) => { store.clear(); });

/** Delete every offline record (used by the "clear offline data" action). */
export const clearAllOfflineData = async () => {
  await withStore(
    [STORES.MEDICINES, STORES.MEDICINE_IMAGES, STORES.SYNC_METADATA],
    'readwrite',
    (medicines, images, meta) => {
      medicines.clear();
      images.clear();
      meta.clear();
    }
  );
};
