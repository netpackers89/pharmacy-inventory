const db = require('../config/db');
const { seedData } = require('../seed');
const { getIO } = require('../socket');

exports.seedDatabase = async (req, res) => {
  try {
    // Run seedData function
    await seedData();
    getIO().emit('data_updated', { message: 'Database seeded' });
    res.json({ message: 'Database seeded successfully' });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ error: 'Server error during seeding' });
  }
};

exports.clearDatabase = async (req, res) => {
  try {
    await db.query('TRUNCATE TABLE sale_items, sales, inventory, medicines, suppliers RESTART IDENTITY CASCADE');
    getIO().emit('data_updated', { message: 'Database cleared' });
    res.json({ message: 'Database cleared successfully' });
  } catch (err) {
    console.error('Clear error:', err);
    res.status(500).json({ error: 'Server error during database clear' });
  }
};
