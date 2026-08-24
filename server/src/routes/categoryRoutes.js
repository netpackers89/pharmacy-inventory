const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/categoryController');

router.get('/', ctrl.getAll);
router.post('/', ctrl.addCategory);
router.put('/:id', ctrl.updateCategory);
router.post('/:category_id/subcategories', ctrl.addSubCategory);
router.put('/subcategories/:id', ctrl.updateSubCategory);

module.exports = router;
