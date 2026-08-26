const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/categoryController');
const { requireAdmin } = require('../middleware/auth');

/*
 * Reads are available to all authenticated staff (global gate in app.js).
 * Every mutation is ADMIN-ONLY and audited server-side.
 * NOTE: specific /subcategories routes are registered BEFORE the generic
 * /:id routes so they can never be swallowed by the parameter pattern.
 */
router.get('/', ctrl.getAll);
router.get('/active', ctrl.getActive);

/* Subcategories (specific paths first) */
router.post('/:category_id/subcategories', requireAdmin, ctrl.addSubCategory);
router.put('/subcategories/:id', requireAdmin, ctrl.updateSubCategory);
router.put('/subcategories/:id/status', requireAdmin, ctrl.setSubCategoryStatus);

/* Categories */
router.post('/', requireAdmin, ctrl.addCategory);
router.put('/:id', requireAdmin, ctrl.updateCategory);
router.put('/:id/status', requireAdmin, ctrl.setCategoryStatus);

module.exports = router;
