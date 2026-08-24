const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');

router.get('/stock', inventoryController.getStock);
router.post('/stock', inventoryController.addStock);
router.get('/bincard', inventoryController.getBinCard);
router.get('/movements', inventoryController.getMovements);
router.post('/adjust', inventoryController.adjustStock);
router.post('/adjust-bulk', inventoryController.adjustStockBulk);
router.get('/alerts', inventoryController.getAlerts);

router.get('/bincard-index', inventoryController.getBinCardIndex);
router.get('/bincard/:medicine_id', inventoryController.getBinCardDetail);
router.get('/what-to-buy', inventoryController.getWhatToBuy);

module.exports = router;
