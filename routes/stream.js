// routes/stream.js
// Maps /api/stream/* to downloadController

const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/downloadController');

// GET /api/stream?id=VIDEO_ID   — main stream/download endpoint
router.get('/', controller.stream);
router.post('/', controller.stream);

// GET /api/stream/info?id=VIDEO_ID
router.get('/info', controller.info);

// GET /api/stream/tracks
router.get('/tracks', controller.getAllTracks);

// GET /api/stream/search?q=query
router.get('/search', controller.searchLocal);

module.exports = router;
