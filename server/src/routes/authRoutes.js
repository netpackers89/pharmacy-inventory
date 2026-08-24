const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/login', authController.login);
router.post('/signup', authController.signup);
router.post('/logout', authController.logout);
router.post('/refresh-activity', authController.refreshActivity);
router.get('/me', authController.getCurrentUser);

module.exports = router;