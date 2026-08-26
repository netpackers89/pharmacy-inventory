const express = require('express');
const router = express.Router();
const { getAuditLogs, exportAuditLogs, getAuditMeta } = require('../controllers/auditController');
const { authenticate, requireAdmin } = require('../middleware/auth');

/*
 * Audit logs are sensitive — ADMINISTRATORS ONLY, enforced by the Express
 * server (never by React). Viewing, filtering, searching and exporting are
 * all rejected with 403 for PHARMACY / GUEST / anonymous users.
 *
 * NOTE: specific routes must be registered BEFORE the generic '/' route.
 */
router.get('/', authenticate, requireAdmin, getAuditLogs);
router.get('/export', authenticate, requireAdmin, exportAuditLogs);
router.get('/meta/actions', authenticate, requireAdmin, getAuditMeta);

module.exports = router;
