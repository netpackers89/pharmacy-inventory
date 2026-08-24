const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, requireAdmin } = require('../middleware/auth');

/*
 * User management is ADMINISTRATOR-ONLY.
 * Every route below requires a valid authenticated session AND the ADMIN role.
 * Guests, PHARMACY users and unauthenticated requests are rejected server-side.
 */
router.use(authenticate, requireAdmin);

router.get('/', userController.getAllUsers);
router.post('/', userController.addUser);
router.put('/:id', userController.updateUser);
router.put('/:id/status', userController.changeStatus);
router.put('/:id/reset-password', userController.resetPassword);

module.exports = router;
