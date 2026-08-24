const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.get('/', userController.getAllUsers);
router.post('/', userController.addUser);
router.put('/:id', userController.updateUser);
router.put('/:id/status', userController.changeStatus);
router.put('/:id/reset-password', userController.resetPassword);

module.exports = router;
