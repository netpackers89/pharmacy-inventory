const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataController');

router.post('/seed', dataController.seedDatabase);
router.post('/clear', dataController.clearDatabase);

module.exports = router;
