const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');

// Login is rate-limited AND protected by DB-backed progressive lockout.
router.post('/login', authLimiter, authController.login);
// NET-PHARMA is an internal system — there is intentionally NO public signup route.
router.post('/guest', authLimiter, authController.guestLogin);
router.post('/logout', authenticate, authController.logout);
router.post('/refresh-activity', authenticate, authController.refreshActivity);
router.get('/me', authenticate, authController.getCurrentUser);

// Session history & administration (ADMIN-only) — real server-side records.
router.get('/sessions', authenticate, requireAdmin, authController.getSessions);
router.post('/sessions/:id/revoke', authenticate, requireAdmin, authController.revokeSession);
router.get('/sessions/mine', authenticate, authController.getMySessions);

module.exports = router;
