// routes/search.js — FIXED
// Dipanggil dari server.js sebagai: app.use('/api/apple-search', searchRoutes)
// Jadi endpoint akhirnya: GET /api/apple-search?q=query

const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');

// GET /api/apple-search?q=query&region=id
router.get('/', searchController.search);

module.exports = router;
