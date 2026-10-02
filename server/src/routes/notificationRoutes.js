const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/notificationController');
const { requireAdmin } = require('../middleware/auth');

/*
 * OUTBOUND NOTIFICATIONS (Telegram).
 *
 * Authentication is enforced globally in app.js; these endpoints additionally
 * require an ADMINISTRATOR because they can send real messages to the pharmacy
 * chat and reveal configuration state. No endpoint here ever returns the bot
 * token.
 */
router.get('/status', requireAdmin, ctrl.status);
router.get('/log', requireAdmin, ctrl.log);
router.get('/telegram/chats', requireAdmin, ctrl.chats);
router.post('/telegram/test', requireAdmin, ctrl.test);
router.post('/run-check', requireAdmin, ctrl.runCheck);

module.exports = router;
