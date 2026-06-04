// routes/stream.js
const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/downloadController');

router.get('/',                controller.stream);
router.post('/',               controller.stream);
router.get('/info',            controller.info);
router.get('/tracks',          controller.getAllTracks);
router.get('/search',          controller.searchLocal);
router.get('/balancer-status', controller.balancerStatus);

module.exports = router;
