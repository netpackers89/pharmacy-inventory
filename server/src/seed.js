const db = require('./config/db');
const bcrypt = require('bcryptjs');

const seedData = async () => {
    // Only insert initial admin user if no users exist
    try {
        const client = await db.getClient();
        try {
            const res = await client.query('SELECT COUNT(*) FROM users');
            if (parseInt(res.rows[0].count) === 0) {
                console.log('Seeding initial admin user...');
                const hash = await bcrypt.hash('admin123', 10);
                await client.query(`
                    INSERT INTO users (role, full_name, username, password_hash, status)
                    VALUES ('ADMIN', 'System Administrator', 'admin', $1, 'ACTIVE')
                `, [hash]);
            }
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Seeding error:', err.message);
    }
};

module.exports = { seedData };
