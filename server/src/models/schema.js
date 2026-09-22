const db = require('../config/db');

async function initSchema() {
  console.log("Initializing database schema...");

  const createTablesSQL = [
    // users table
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'pharmacist'))
    );`,

    // suppliers table
    `CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(200) NOT NULL,
      location VARCHAR(200),
      contact_info VARCHAR(200)
    );`,

    // medicines table
    `CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_name VARCHAR(150) NOT NULL,
      generic_name VARCHAR(150) NOT NULL,
      strength VARCHAR(50),
      dosage_form VARCHAR(50),
      manufacturer VARCHAR(150),
      country VARCHAR(100),
      route_of_admin VARCHAR(50),
      prescription_required BOOLEAN DEFAULT 0,
      category VARCHAR(100),
      class VARCHAR(100),
      barcode VARCHAR(100) UNIQUE,
      indication TEXT,
      storage_info TEXT,
      description TEXT,
      contraindication TEXT,
      pregnancy_lactation TEXT,
      interactions TEXT,
      side_effects TEXT,
      storage_condition_patient TEXT,
      reorder_level INTEGER DEFAULT 50,
      max_level INTEGER DEFAULT 500,
      selling_type VARCHAR(50) DEFAULT 'Per Individual Unit (Pill)',
      package_capacity INTEGER DEFAULT 1
    );`,

    // inventory (Stock Batches) table
    `CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      batch_no VARCHAR(100) NOT NULL,
      purchase_date DATE,
      expiry_date DATE,
      manufacturer VARCHAR(150),
      country VARCHAR(100),
      purchase_price DECIMAL(10,2) DEFAULT 0.00,
      selling_price DECIMAL(10,2) DEFAULT 0.00,
      unit_price DECIMAL(10,2) DEFAULT 0.00,
      vat_tax DECIMAL(5,2) DEFAULT 0.00,
      stock_count INTEGER DEFAULT 0
    );`,

    // sales table
    `CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      pharmacist_id INTEGER REFERENCES users(id),
      total_amount DECIMAL(10,2) DEFAULT 0.00,
      counseling_points TEXT
    );`,

    // sale_items table
    `CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      medicine_id INTEGER NOT NULL REFERENCES medicines(id),
      quantity INTEGER NOT NULL,
      duration VARCHAR(50),
      dosage_instruction VARCHAR(100),
      price DECIMAL(10,2) NOT NULL
    );`,

    // physical stock counts audit log table
    `CREATE TABLE IF NOT EXISTS physical_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      counted_by VARCHAR(100),
      total_items_checked INTEGER,
      discrepancy_count INTEGER,
      gross_check_report TEXT
    );`
  ];

  for (const sql of createTablesSQL) {
    try {
      await db.query(sql);
    } catch (err) {
      console.error("Error running schema SQL:", err.message);
    }
  }

  // Safe ALTER TABLE for existing databases
  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN selling_type VARCHAR(50) DEFAULT 'Per Individual Unit (Pill)'`);
    console.log("Added selling_type column.");
  } catch (err) {
    // Column already exists, ignore
  }

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN package_capacity INTEGER DEFAULT 1`);
    console.log("Added package_capacity column.");
  } catch (err) {
    // Column already exists, ignore
  }

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN qr_code VARCHAR(200)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN abc_category CHAR(1)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN ven_category CHAR(1)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN manufacturer VARCHAR(150)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN country VARCHAR(100)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN reorder_level INTEGER DEFAULT 50`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN max_level INTEGER DEFAULT 500`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE batches ADD COLUMN barcode VARCHAR(100)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE batches ADD COLUMN qr_code TEXT`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE batches ADD COLUMN abc_category CHAR(1)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE batches ADD COLUMN ven_category CHAR(1)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE sale_items ADD COLUMN dose_per_admin DECIMAL(6,2)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE sale_items ADD COLUMN frequency_code VARCHAR(10)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE sale_items ADD COLUMN duration_days INTEGER`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE sale_items ADD COLUMN route_of_admin VARCHAR(20)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE sale_items ADD COLUMN required_qty INTEGER`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE sale_items ADD COLUMN dispensing_unit VARCHAR(50)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE sale_items ADD COLUMN counseling_note TEXT`);
  } catch (err) {}

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id INTEGER,
        description TEXT,
        old_value TEXT,
        new_value TEXT,
        ip_address VARCHAR(50),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created audit_logs table.");
  } catch (err) {
    console.error("Error creating audit_logs table:", err.message);
  }

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN image_url VARCHAR(500)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN release_type VARCHAR(50)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN therapeutic_class VARCHAR(100)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN pharmacological_class VARCHAR(100)`);
  } catch (err) {}

  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN counseling_points TEXT`);
  } catch (err) {}

  // Optional pronunciation guides (never required — nullable by design)
  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN pronunciation_english TEXT`);
  } catch (err) {}
  try {
    await db.query(`ALTER TABLE medicines ADD COLUMN pronunciation_amharic TEXT`);
  } catch (err) {}

  // Base tables used by controllers/import (idempotent for fresh installs)
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS categories (
      category_id SERIAL PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL,
      status VARCHAR(10) DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`);
    await db.query(`CREATE TABLE IF NOT EXISTS sub_categories (
      sub_category_id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(category_id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      status VARCHAR(10) DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`);
    await db.query(`CREATE TABLE IF NOT EXISTS batches (
      batch_id SERIAL PRIMARY KEY,
      medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      batch_number VARCHAR(100) NOT NULL,
      expiry_date DATE,
      buy_price DECIMAL(10,2) DEFAULT 0.00,
      sell_price DECIMAL(10,2) DEFAULT 0.00,
      stock_quantity INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`);
    await db.query(`CREATE TABLE IF NOT EXISTS stock_movements (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      movement_type VARCHAR(30) NOT NULL,
      quantity INTEGER NOT NULL,
      previous_stock INTEGER DEFAULT 0,
      new_stock INTEGER DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`);
  } catch (err) {
    console.error('Base table init:', err.message);
  }

  // Indexes for fast duplicate matching & stock joins (bulk import performance)
  try {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_medicines_generic ON medicines (LOWER(TRIM(generic_name)))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_medicines_brand ON medicines (LOWER(TRIM(brand_name)))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_medicines_strength ON medicines (LOWER(TRIM(strength)))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_batches_medicine ON batches (medicine_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_batches_number ON batches (LOWER(TRIM(batch_number)))`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_movements_batch ON stock_movements (batch_id)`);
  } catch (err) {
    // Index errors are non-fatal (e.g. expression index unsupported)
    console.error('Index init:', err.message);
  }

  console.log("Database schema initialized successfully.");
}

module.exports = { initSchema };
