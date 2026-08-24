const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const { authenticate, requireAdmin } = require('../middleware/auth');

/*
 * Staff (pharmacists) may add/edit suppliers; STATUS changes are
 * ADMIN-ONLY and audited. Guests are rejected by the global
 * enforceGuestReadOnly middleware before reaching any route.
 */
router.use(authenticate);

router.get('/', supplierController.getAllSuppliers);
router.get('/:id', supplierController.getSupplierById);
router.post('/', supplierController.addSupplier);
router.put('/:id', supplierController.updateSupplier);
router.put('/:id/status', requireAdmin, supplierController.changeSupplierStatus);

module.exports = router;
