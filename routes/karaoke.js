// routes/karaoke.js
const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/karaokeController');

// POST /api/karaoke — proses vocal separation
router.post('/', controller.process);

// GET /api/karaoke/status?trackId=xxx — cek cache
router.get('/status', controller.status);

module.exports = router;
