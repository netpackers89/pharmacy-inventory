const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, requireAdmin } = require('../middleware/auth');

/*
 * Lightweight staff count for dashboards — any authenticated staff member
 * may read the NUMBER of active accounts (no personal data exposed).
 */
router.get('/count', authenticate, userController.getUserCount);

/*
 * Everything below is ADMINISTRATOR-ONLY.
 * Authentication is enforced globally in app.js; this adds the ADMIN role
 * check. Guests, PHARMACY users and unauthenticated requests are all
 * rejected server-side.
 */
router.use(requireAdmin);

router.get('/', userController.getAllUsers);
router.post('/', userController.addUser);
router.put('/:id', userController.updateUser);
router.put('/:id/status', userController.changeStatus);
router.put('/:id/reset-password', userController.resetPassword);

module.exports = router;
