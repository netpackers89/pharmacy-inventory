const express = require('express');
const router = express.Router();
const medicineController = require('../controllers/medicineController');

// NOTE: authentication is enforced GLOBALLY in app.js before any router
// runs — every request here is already authenticated with an open session.
router.get('/', medicineController.getAllMedicines);
router.get('/:id', medicineController.getMedicineById);
router.post('/', medicineController.addMedicine);
router.put('/:id', medicineController.updateMedicine);
router.delete('/:id', medicineController.deleteMedicine);
router.post('/import/preview', medicineController.previewImport);
router.post('/import/confirm', medicineController.confirmImport);

module.exports = router;
