const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');

router.get('/stats/dashboard', salesController.getDashboardStats);
router.get('/', salesController.getAllSales);
router.get('/:id', salesController.getSaleDetails);
router.post('/', salesController.createSale);

module.exports = router;
