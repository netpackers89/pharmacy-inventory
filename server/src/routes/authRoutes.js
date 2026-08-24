const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/login', authController.login);
// NET-PHARMA is an internal system — there is intentionally NO public signup route.
router.post('/guest', authController.guestLogin);
router.post('/logout', authController.logout);
router.post('/refresh-activity', authController.refreshActivity);
router.get('/me', authController.getCurrentUser);

module.exports = router;
