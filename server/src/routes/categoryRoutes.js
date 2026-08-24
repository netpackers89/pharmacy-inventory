const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/categoryController');
const { authenticate, requireAdmin } = require('../middleware/auth');

/*
 * Reads are available to all authenticated staff (operational dropdowns +
 * admin management). Every mutation is ADMIN-ONLY and audited server-side.
 * NOTE: specific /subcategories routes are registered BEFORE the generic
 * /:id routes so they can never be swallowed by the parameter pattern.
 */
router.get('/', authenticate, ctrl.getAll);
router.get('/active', authenticate, ctrl.getActive);

/* Subcategories (specific paths first) */
router.post('/:category_id/subcategories', authenticate, requireAdmin, ctrl.addSubCategory);
router.put('/subcategories/:id', authenticate, requireAdmin, ctrl.updateSubCategory);
router.put('/subcategories/:id/status', authenticate, requireAdmin, ctrl.setSubCategoryStatus);

/* Categories */
router.post('/', authenticate, requireAdmin, ctrl.addCategory);
router.put('/:id', authenticate, requireAdmin, ctrl.updateCategory);
router.put('/:id/status', authenticate, requireAdmin, ctrl.setCategoryStatus);

module.exports = router;
