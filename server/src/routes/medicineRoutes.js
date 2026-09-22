const express = require('express');
const router = express.Router();
const medicineController = require('../controllers/medicineController');
const { requireAdmin } = require('../middleware/auth');

// NOTE: authentication is enforced GLOBALLY in app.js before any router
// runs — every request here is already authenticated with an open session.
// Reads are available to all authenticated staff.
router.get('/', medicineController.getAllMedicines);
router.get('/:id', medicineController.getMedicineById);
router.post('/', medicineController.addMedicine);
router.put('/:id', medicineController.updateMedicine);

/*
 * DESTRUCTIVE / STATUS mutations are ADMINISTRATOR-ONLY (server-side).
 *  - PATCH /:id/status  → activate / deactivate (never deletes the record)
 *  - DELETE /:id        → PERMANENT delete, safe-delete rules in a single
 *                         PostgreSQL transaction (blocks medicines with
 *                         historical pharmacy records).
 * Pharmacists keep read + create/edit medicine permissions; they cannot
 * deactivate, reactivate or permanently delete medicines.
 */
router.patch('/:id/status', requireAdmin, medicineController.setMedicineStatus);
router.delete('/:id', requireAdmin, medicineController.hardDeleteMedicine);

router.post('/import/preview', medicineController.previewImport);
router.post('/import/confirm', medicineController.confirmImport);
router.get('/import/template', medicineController.importTemplate);

module.exports = router;
