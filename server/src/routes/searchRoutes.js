const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/searchController');

/*
 * GLOBAL SEARCH — one endpoint for the navbar command palette.
 * Authentication is enforced globally in app.js before every /api route, so a
 * guest can never search without a valid session.
 */
router.get('/', ctrl.globalSearch);
router.get('/pages', ctrl.searchPagesOnly);

module.exports = router;