const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reportController');
const { requireAdmin } = require('../middleware/auth');

router.get('/overview', ctrl.getOverview);
router.get('/sales', ctrl.getSalesReport);
router.get('/sales-series', ctrl.getSalesSeries);
router.get('/inventory', ctrl.getInventoryReport);
router.get('/profit', ctrl.getProfitReport);
router.get('/expiry', ctrl.getExpiryReport);
router.get('/movements', ctrl.getMovementReport);
router.get('/moving', ctrl.getMovingReport);
router.get('/users', ctrl.getUserReport);

/*
 * SCHEDULED REPORT EXPORTS & TELEGRAM DELIVERY — ADMINISTRATOR ONLY.
 * These endpoints can generate real .xlsx workbooks and send them to the
 * pharmacy Telegram chat, so they are protected on the server, not just in
 * the UI. Authentication itself is enforced globally in app.js.
 */
router.get('/weekly/export', requireAdmin, ctrl.exportWeeklyReport);
router.get('/monthly/export', requireAdmin, ctrl.exportMonthlyReport);
router.get('/audit/export', requireAdmin, ctrl.exportAuditReport);
router.get('/bincard/export', requireAdmin, ctrl.exportBinCard);
router.get('/schedule', requireAdmin, ctrl.getSchedule);
router.get('/deliveries', requireAdmin, ctrl.getDeliveries);
router.post('/send', requireAdmin, ctrl.sendReportNow);
router.post('/deliveries/:id/retry', requireAdmin, ctrl.retryDelivery);

module.exports = router;
