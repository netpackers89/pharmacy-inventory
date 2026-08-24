const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reportController');

router.get('/overview', ctrl.getOverview);
router.get('/sales', ctrl.getSalesReport);
router.get('/inventory', ctrl.getInventoryReport);
router.get('/profit', ctrl.getProfitReport);
router.get('/expiry', ctrl.getExpiryReport);
router.get('/movements', ctrl.getMovementReport);
router.get('/moving', ctrl.getMovingReport);
router.get('/users', ctrl.getUserReport);

module.exports = router;
