const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
const localConfig = {
  host: process.env.PG_HOST || process.env.DB_HOST || 'localhost',
  user: process.env.PG_USER || process.env.DB_USER || 'postgres',
  password: process.env.PG_PASSWORD || process.env.DB_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || process.env.DB_NAME || 'pharmacy_db',
  port: Number(process.env.PG_PORT || 5432),
};

const pgPool = new Pool({
  ...(connectionString ? { connectionString } : localConfig),
  ...(connectionString && process.env.PGSSLMODE !== 'disable'
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
  max: 10,
});

const initializeDB = async () => {
  let client;
  try {
    client = await pgPool.connect();

    /*
     * Additive migrations for existing databases.
     * Packaging unit system: batches record WHICH packaging unit was
     * received (SINGLE_DOSE / STRIP / INNER_BOX / OUTER_BOX), how many
     * single doses one of those units contains, and the prices PER THAT UNIT.
     * stock_quantity continues to be tracked in SINGLE DOSES so all existing
     * FEFO sale/deduction logic remains correct.
     */
    const safeColumns = [
      `ALTER TABLE batches ADD COLUMN IF NOT EXISTS packaging_unit VARCHAR(20) NOT NULL DEFAULT 'SINGLE_DOSE'`,
      `ALTER TABLE batches ADD COLUMN IF NOT EXISTS units_per_package INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE batches ADD COLUMN IF NOT EXISTS single_doses_received INTEGER`,
      // Sale metadata used by POS dispensing records
      `ALTER TABLE sales ADD COLUMN IF NOT EXISTS override_reason VARCHAR(255)`,
      `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS dose_per_admin INTEGER`,
      `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS frequency_code VARCHAR(10)`,
      `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS duration_days INTEGER`,
      `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS route_of_admin VARCHAR(20)`,
      `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS required_qty INTEGER`,
      `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS dispensing_unit VARCHAR(50)`,
      `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS counseling_note TEXT`,
      // Users may authenticate with an email-style username; keep a dedicated column optional
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(150)`,
    // Idempotent POS checkout: the same operation_id can never create a
    // second sale (network retries are safe).
    `ALTER TABLE sales ADD COLUMN IF NOT EXISTS operation_id VARCHAR(100)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS sales_operation_id_unique ON sales (operation_id) WHERE operation_id IS NOT NULL`,
    // Master-data management: audit-friendly timestamps + optional descriptions
    `ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE sub_categories ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE sub_categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  ];
  // System-level security events (failed logins of unknown accounts,
  // lockouts) have NO user row — audit columns must be nullable.
  for (const ddl of [
    `ALTER TABLE audit_logs ALTER COLUMN user_id DROP NOT NULL`,
    `ALTER TABLE audit_logs ALTER COLUMN table_name DROP NOT NULL`,
    `ALTER TABLE audit_logs ALTER COLUMN record_id DROP NOT NULL`,
  ]) {
    try { await client.query(ddl); } catch (_) { /* already nullable */ }
  }
    for (const ddl of safeColumns) {
      try { await client.query(ddl); }
      catch (e) { console.warn('Migration skipped:', e.message); }
    }

    // Create Tables with strict schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
          user_id bigserial PRIMARY KEY,
          role VARCHAR(255) CHECK (role IN('ADMIN', 'PHARMACY')) NOT NULL,
          full_name VARCHAR(150) NOT NULL,
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          status VARCHAR(255) CHECK (status IN('ACTIVE', 'INACTIVE')) NOT NULL DEFAULT 'ACTIVE',
          created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS categories (
          category_id bigserial PRIMARY KEY,
          name VARCHAR(100) UNIQUE NOT NULL,
          status VARCHAR(255) CHECK (status IN('ACTIVE', 'INACTIVE')) NOT NULL DEFAULT 'ACTIVE'
      );

      CREATE TABLE IF NOT EXISTS sub_categories (
          sub_category_id bigserial PRIMARY KEY,
          category_id BIGINT NOT NULL REFERENCES categories(category_id),
          name VARCHAR(100) NOT NULL,
          status VARCHAR(255) CHECK (status IN('ACTIVE', 'INACTIVE')) NOT NULL DEFAULT 'ACTIVE',
          UNIQUE(category_id, name)
      );

      CREATE TABLE IF NOT EXISTS medicines (
          medicine_id bigserial PRIMARY KEY,
          category_id BIGINT REFERENCES categories(category_id),
          sub_category_id BIGINT REFERENCES sub_categories(sub_category_id),
          generic_name VARCHAR(150) NOT NULL,
          brand_name VARCHAR(150),
          strength VARCHAR(100) NOT NULL,
          dosage_form VARCHAR(100) NOT NULL,
          manufacturer VARCHAR(150),
          country VARCHAR(100),
          route VARCHAR(100),
          prescription_type VARCHAR(255) CHECK (prescription_type IN('OTC', 'PRESCRIPTION', 'CONTROLLED')),
          description TEXT,
          indications TEXT,
          contraindications TEXT,
          side_effects TEXT,
          warnings TEXT,
          storage_conditions TEXT,
          reorder_level INTEGER DEFAULT 50,
          max_level INTEGER DEFAULT 500,
          status VARCHAR(255) CHECK (status IN('ACTIVE', 'INACTIVE')) NOT NULL DEFAULT 'ACTIVE',
          created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS suppliers (
          supplier_id bigserial PRIMARY KEY,
          name VARCHAR(150) UNIQUE NOT NULL,
          contact_person VARCHAR(150),
          phone VARCHAR(50),
          email VARCHAR(150),
          address TEXT,
          status VARCHAR(255) CHECK (status IN('ACTIVE', 'INACTIVE')) NOT NULL DEFAULT 'ACTIVE',
          created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS batches (
          batch_id bigserial PRIMARY KEY,
          medicine_id BIGINT NOT NULL REFERENCES medicines(medicine_id),
          supplier_id BIGINT NOT NULL REFERENCES suppliers(supplier_id),
          batch_number VARCHAR(100) NOT NULL,
          manufacture_date DATE,
          expiry_date DATE NOT NULL,
          buy_price DECIMAL(12, 2) NOT NULL,
          sell_price DECIMAL(12, 2) NOT NULL,
          stock_quantity INTEGER NOT NULL,
          minimum_stock INTEGER DEFAULT 0,
          maximum_stock INTEGER,
          barcode VARCHAR(100),
          qr_code TEXT,
          abc_category VARCHAR(10) CHECK (abc_category IN('A', 'B', 'C')),
          ven_category VARCHAR(10) CHECK (ven_category IN('V', 'E', 'N')),
          status VARCHAR(255) CHECK (status IN('ACTIVE', 'EXPIRED', 'DEPLETED', 'INACTIVE')) NOT NULL DEFAULT 'ACTIVE',
          created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(medicine_id, batch_number)
      );

      CREATE TABLE IF NOT EXISTS resupplies (
          resupply_id bigserial PRIMARY KEY,
          supplier_id BIGINT NOT NULL REFERENCES suppliers(supplier_id),
          user_id BIGINT NOT NULL REFERENCES users(user_id),
          invoice_number VARCHAR(100),
          resupply_date DATE NOT NULL DEFAULT CURRENT_DATE,
          total_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
          discount DECIMAL(14, 2) NOT NULL DEFAULT 0,
          tax DECIMAL(14, 2) NOT NULL DEFAULT 0,
          status VARCHAR(255) CHECK (status IN('DRAFT', 'COMPLETED', 'CANCELLED')) NOT NULL DEFAULT 'COMPLETED',
          created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS resupply_items (
          resupply_item_id bigserial PRIMARY KEY,
          resupply_id BIGINT NOT NULL REFERENCES resupplies(resupply_id),
          batch_id BIGINT NOT NULL REFERENCES batches(batch_id),
          quantity INTEGER NOT NULL,
          free_quantity INTEGER NOT NULL DEFAULT 0,
          buy_price DECIMAL(12, 2) NOT NULL,
          total_price DECIMAL(14, 2) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sales (
          sale_id bigserial PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(user_id),
          invoice_number VARCHAR(100),
          sale_date TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          subtotal DECIMAL(14, 2) NOT NULL DEFAULT 0,
          discount DECIMAL(14, 2) NOT NULL DEFAULT 0,
          tax DECIMAL(14, 2) NOT NULL DEFAULT 0,
          total_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
          paid_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
          payment_method VARCHAR(255) CHECK (payment_method IN('CASH', 'CARD', 'TRANSFER', 'OTHER')),
          status VARCHAR(255) CHECK (status IN('DRAFT', 'COMPLETED', 'CANCELLED', 'REFUNDED')) NOT NULL DEFAULT 'COMPLETED',
          created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sale_items (
          sale_item_id bigserial PRIMARY KEY,
          sale_id BIGINT NOT NULL REFERENCES sales(sale_id),
          batch_id BIGINT NOT NULL REFERENCES batches(batch_id),
          quantity INTEGER NOT NULL,
          sell_price DECIMAL(12, 2) NOT NULL,
          discount DECIMAL(12, 2) NOT NULL DEFAULT 0,
          total_price DECIMAL(14, 2) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stock_movements (
          movement_id bigserial PRIMARY KEY,
          medicine_id BIGINT REFERENCES medicines(medicine_id),
          batch_id BIGINT NOT NULL REFERENCES batches(batch_id),
          user_id BIGINT NOT NULL REFERENCES users(user_id),
          movement_type VARCHAR(50) CHECK (movement_type IN(
            'RESUPPLY','SALE','RETURN','DAMAGE','EXPIRY','ADJUSTMENT',
            'PHYSICAL_COUNT','TRANSFER_IN','TRANSFER_OUT','OPENING_BALANCE'
          )) NOT NULL,
          quantity INTEGER NOT NULL,
          previous_stock INTEGER NOT NULL,
          new_stock INTEGER NOT NULL,
          reference_type VARCHAR(50),
          reference_id BIGINT,
          reason VARCHAR(100),
          notes TEXT,
          movement_date TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
          audit_id bigserial PRIMARY KEY,
          user_id BIGINT REFERENCES users(user_id),
          action VARCHAR(50) NOT NULL,
          module VARCHAR(50),
          table_name VARCHAR(100),
          record_id BIGINT,
          entity_type VARCHAR(50),
          entity_id BIGINT,
          description TEXT,
          old_values jsonb,
          new_values jsonb,
          metadata jsonb,
          ip_address VARCHAR(50),
          user_agent TEXT,
          session_id BIGINT,
          status VARCHAR(10) DEFAULT 'SUCCESS',
          created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
          session_id bigserial PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(user_id),
          login_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          logout_at TIMESTAMP(0) WITHOUT TIME ZONE,
          last_activity_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ip_address VARCHAR(50),
          user_agent TEXT,
          logout_reason VARCHAR(50)
      );

      CREATE TABLE IF NOT EXISTS physical_counts (
          physical_count_id bigserial PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(user_id),
          reference_number VARCHAR(50),
          notes TEXT,
          status VARCHAR(20) CHECK (status IN('PENDING','APPROVED','REJECTED')) NOT NULL DEFAULT 'APPROVED',
          approved_by BIGINT REFERENCES users(user_id),
          approved_at TIMESTAMP(0) WITHOUT TIME ZONE,
          created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS physical_count_items (
          item_id bigserial PRIMARY KEY,
          physical_count_id BIGINT NOT NULL REFERENCES physical_counts(physical_count_id),
          batch_id BIGINT NOT NULL REFERENCES batches(batch_id),
          system_quantity INTEGER NOT NULL,
          physical_quantity INTEGER NOT NULL,
          variance INTEGER NOT NULL,
          reason VARCHAR(100),
          notes TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
          setting_key VARCHAR(100) PRIMARY KEY,
          setting_value TEXT NOT NULL,
          description TEXT,
          updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add compatibility columns for older databases and new app fields
    await client.query(`
      ALTER TABLE medicines ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(150);
      ALTER TABLE medicines ADD COLUMN IF NOT EXISTS country VARCHAR(100);
      ALTER TABLE medicines ADD COLUMN IF NOT EXISTS reorder_level INTEGER DEFAULT 50;
      ALTER TABLE medicines ADD COLUMN IF NOT EXISTS max_level INTEGER DEFAULT 500;

      ALTER TABLE batches ADD COLUMN IF NOT EXISTS minimum_stock INTEGER DEFAULT 0;
      ALTER TABLE batches ADD COLUMN IF NOT EXISTS maximum_stock INTEGER;
      ALTER TABLE batches ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);
      ALTER TABLE batches ADD COLUMN IF NOT EXISTS qr_code TEXT;
      ALTER TABLE batches ADD COLUMN IF NOT EXISTS abc_category CHAR(1);
      ALTER TABLE batches ADD COLUMN IF NOT EXISTS ven_category CHAR(1);

      ALTER TABLE sales ADD COLUMN IF NOT EXISTS override_reason TEXT;

      ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS dose_per_admin DECIMAL(6,2);
      ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS frequency_code VARCHAR(20);
      ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS duration_days INTEGER;
      ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS route_of_admin VARCHAR(20);
      ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS required_qty INTEGER;
      ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS dispensing_unit VARCHAR(50);
      ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS counseling_note TEXT;

      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS module VARCHAR(50);
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id BIGINT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata jsonb;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(50);
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS session_id BIGINT;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status VARCHAR(10) DEFAULT 'SUCCESS';
      ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS medicine_id BIGINT REFERENCES medicines(medicine_id);
      ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reference_type VARCHAR(50);
      ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reason VARCHAR(100);
    `);

    // Add indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS medicines_generic_name_index ON medicines(generic_name);
      CREATE INDEX IF NOT EXISTS medicines_brand_name_index ON medicines(brand_name);
      CREATE INDEX IF NOT EXISTS batches_medicine_id_index ON batches(medicine_id);
      CREATE INDEX IF NOT EXISTS batches_supplier_id_index ON batches(supplier_id);
      CREATE INDEX IF NOT EXISTS batches_expiry_date_index ON batches(expiry_date);
      CREATE INDEX IF NOT EXISTS resupplies_supplier_id_index ON resupplies(supplier_id);
      CREATE INDEX IF NOT EXISTS resupply_items_resupply_id_index ON resupply_items(resupply_id);
      CREATE INDEX IF NOT EXISTS resupply_items_batch_id_index ON resupply_items(batch_id);
      CREATE INDEX IF NOT EXISTS sales_sale_date_index ON sales(sale_date);
      CREATE INDEX IF NOT EXISTS sale_items_sale_id_index ON sale_items(sale_id);
      CREATE INDEX IF NOT EXISTS sale_items_batch_id_index ON sale_items(batch_id);
      CREATE INDEX IF NOT EXISTS stock_movements_batch_id_index ON stock_movements(batch_id);
      CREATE INDEX IF NOT EXISTS stock_movements_medicine_id_index ON stock_movements(medicine_id);
      CREATE INDEX IF NOT EXISTS stock_movements_movement_date_index ON stock_movements(movement_date);
      CREATE INDEX IF NOT EXISTS audit_logs_user_id_index ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS audit_logs_module_index ON audit_logs(module);
      CREATE INDEX IF NOT EXISTS audit_logs_created_at_index ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS physical_counts_user_id_index ON physical_counts(user_id);
      CREATE INDEX IF NOT EXISTS physical_count_items_count_id_index ON physical_count_items(physical_count_id);
      CREATE INDEX IF NOT EXISTS user_sessions_user_id_index ON user_sessions(user_id);
    `);

    // Alter tables for any schema additions
    try {
        await client.query(`
            ALTER TABLE batches 
            ADD COLUMN IF NOT EXISTS barcode VARCHAR(100),
            ADD COLUMN IF NOT EXISTS qr_code TEXT,
            ADD COLUMN IF NOT EXISTS abc_category VARCHAR(10) CHECK (abc_category IN('A', 'B', 'C')),
            ADD COLUMN IF NOT EXISTS ven_category VARCHAR(10) CHECK (ven_category IN('V', 'E', 'N'));
        `);
    } catch (alterErr) {
        console.warn('Alter table skipped or failed:', alterErr.message);
    }

    // Seed Defaults
    await client.query(`
      INSERT INTO settings (setting_key, setting_value, description)
      VALUES 
        ('default_profit_margin', '25', 'Default profit margin % applied to buy price'),
        ('currency', 'ETB', 'Default currency used in the system')
      ON CONFLICT (setting_key) DO NOTHING;
    `);

    // NOTE: the initial ADMIN account is seeded by src/seed.js with a REAL
    // bcrypt hash. Never insert a placeholder hash here — it would block
    // the seeder and create an account nobody can sign into.

    const catCheck = await client.query(`SELECT category_id FROM categories LIMIT 1`);
    if (catCheck.rows.length === 0) {
        const catRes = await client.query(`INSERT INTO categories (name) VALUES ('General') RETURNING category_id`);
        await client.query(`INSERT INTO sub_categories (category_id, name) VALUES ($1, 'Uncategorized')`, [catRes.rows[0].category_id]);
    }

    console.log('PostgreSQL database initialized successfully with strictly normalized schema.');
  } catch (err) {
    console.error('Error initializing PostgreSQL database:', err.message);
    throw err;
  } finally {
    client?.release();
  }
};

const query = async (text, params = []) => {
  return new Promise((resolve, reject) => {
    pgPool.query(text, params, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
};

const getClient = async () => {
    return await pgPool.connect();
};

module.exports = {
  query,
  initializeDB,
  getClient,
  getPgPool: () => pgPool
};
