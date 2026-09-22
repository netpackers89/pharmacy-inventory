const DB_NAME = 'net_pharmacy_offline';
const DB_VERSION = 1;

const STORES = {
  MEDICINES: 'medicines',
  STOCK: 'stock',
  SALES: 'sales',
  INVENTORY: 'inventory',
  USERS: 'users',
  SUPPLIERS: 'suppliers',
  DASHBOARD: 'dashboard',
  QUEUE: 'sync_queue',
  SETTINGS: 'settings',
};

const createIndexes = (db) => {
  // Medicines store
  const medStore = db.createObjectStore(STORES.MEDICINES, { keyPath: 'medicine_id' });
  medStore.createIndex('by_barcode', 'barcode', { unique: false });
  medStore.createIndex('by_name', 'name', { unique: false });
  medStore.createIndex('updated_at', 'updated_at', { unique: false });

  // Stock store
  const stockStore = db.createObjectStore(STORES.STOCK, { keyPath: 'medicine_id' });
  stockStore.createIndex('by_stock', 'stock_on_hand', { unique: false });

  // Sales store
  const salesStore = db.createObjectStore(STORES.SALES, { keyPath: 'sale_id', autoIncrement: false });
  salesStore.createIndex('by_date', 'created_at', { unique: false });
  salesStore.createIndex('by_status', 'status', { unique: false });

  // Inventory movements
  const invStore = db.createObjectStore(STORES.INVENTORY, { keyPath: 'movement_id' });
  invStore.createIndex('by_medicine', 'medicine_id', { unique: false });
  invStore.createIndex('by_date', 'created_at', { unique: false });

  // Sync queue for offline actions
  const queueStore = db.createObjectStore(STORES.QUEUE, { keyPath: 'id', autoIncrement: false });
  queueStore.createIndex('by_status', 'status', { unique: false });
  queueStore.createIndex('by_type', 'operation_type', { unique: false });
  queueStore.createIndex('by_created', 'created_at', { unique: false });

  // Settings cache
  const settingsStore = db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });

  return db;
};

export const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORES.MEDICINES)) createIndexes(db);
    };
  });
};

export const getDB = async () => {
  const db = await openDB();
  return db;
};

// Generic CRUD operations
export const put = async (storeName, data) => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(data);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const get = async (storeName, key) => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getAll = async (storeName) => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const deleteRecord = async (storeName, key) => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const clearStore = async (storeName) => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// Query with index
export const queryIndex = async (storeName, indexName, value) => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// Bulk operations
export const bulkPut = async (storeName, items) => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    items.forEach(item => store.put(item));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

// Get store count
export const getCount = async (storeName) => {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// Get all data for a store with optional filter
export const getfiltered = async (storeName, filterFn) => {
  const all = await getAll(storeName);
  return filterFn ? all.filter(filterFn) : all;
};
