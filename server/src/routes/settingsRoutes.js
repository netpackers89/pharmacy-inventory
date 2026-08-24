const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/settingsController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', authenticate, ctrl.getAll);
// Settings mutations are administrator-only.
router.put('/:key', authenticate, requireAdmin, ctrl.updateSetting);
router.post('/batch', authenticate, requireAdmin, ctrl.updateBatch);

module.exports = router;
