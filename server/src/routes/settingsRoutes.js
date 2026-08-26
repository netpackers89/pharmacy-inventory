const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/settingsController');
const { requireAdmin } = require('../middleware/auth');

// Reads: authenticated staff (global gate). Mutations: administrator-only.
router.get('/', ctrl.getAll);
router.put('/:key', requireAdmin, ctrl.updateSetting);
router.post('/batch', requireAdmin, ctrl.updateBatch);

module.exports = router;
