const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataController');
const { requireAdmin } = require('../middleware/auth');

// Seeding/clearing the database is destructive — administrators only.
// (Authentication is enforced globally in app.js.)
router.post('/seed', requireAdmin, dataController.seedDatabase);
router.post('/clear', requireAdmin, dataController.clearDatabase);

module.exports = router;
