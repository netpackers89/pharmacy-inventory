const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataController');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Seeding/clearing the database is destructive — administrators only.
router.post('/seed', authenticate, requireAdmin, dataController.seedDatabase);
router.post('/clear', authenticate, requireAdmin, dataController.clearDatabase);

module.exports = router;
