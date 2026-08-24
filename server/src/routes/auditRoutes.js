const express = require('express');
const router = express.Router();
const { getAuditLogs } = require('../controllers/auditController');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Audit logs are sensitive — administrators only.
router.get('/', authenticate, requireAdmin, getAuditLogs);

module.exports = router;
