require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const key = process.argv[2] || 'netsanet';
pool.query("DELETE FROM login_security WHERE username_key LIKE $1", [key + '%'])
  .then(r => { console.log('unlocked', key, '- rows:', r.rowCount); return pool.end(); })
  .catch(e => { console.error(e.message); process.exit(1); });
