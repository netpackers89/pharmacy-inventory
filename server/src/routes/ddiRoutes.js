const express = require('express');
const router = express.Router();
const ddiController = require('../controllers/ddiController');
const { authenticate } = require('../middleware/auth');

// Read-only clinical safety check — any authenticated session (incl. guests) may run it.
router.post('/check', authenticate, ddiController.check);

module.exports = router;
