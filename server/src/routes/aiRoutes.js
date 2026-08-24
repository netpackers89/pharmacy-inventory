const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');

router.post('/autofill', aiController.autofill);
router.post('/check-interactions', aiController.checkInteractions);
router.post('/counseling', aiController.generateCounseling);

module.exports = router;
