const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/settingsController');

router.get('/', ctrl.getAll);
router.put('/:key', ctrl.updateSetting);
router.post('/batch', ctrl.updateBatch);

module.exports = router;
