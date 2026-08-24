const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const aiController = require('../controllers/aiController');

// AI autofill is an authenticated staff convenience (guests don't edit medicines anyway).
router.post('/autofill', authenticate, aiController.autofill);
router.post('/check-interactions', authenticate, aiController.checkInteractions);

module.exports = router;
