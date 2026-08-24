const express = require('express');
const router = express.Router();
const medicineController = require('../controllers/medicineController');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, medicineController.getAllMedicines);
router.get('/:id', authenticate, medicineController.getMedicineById);
router.post('/', authenticate, medicineController.addMedicine);
router.put('/:id', authenticate, medicineController.updateMedicine);
router.delete('/:id', authenticate, medicineController.deleteMedicine);
router.post('/import/preview', authenticate, medicineController.previewImport);
router.post('/import/confirm', authenticate, medicineController.confirmImport);

module.exports = router;
