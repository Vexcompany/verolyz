// server.js — Pagaska Music Backend (R2 Refactor)

const express = require('express');
const app     = express();

// ── CORS ─────────────────────────────────────────────────────────
const corsMiddleware = require('./middleware/cors');
app.use(corsMiddleware);

// ── Body Parser ──────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ───────────────────────────────────────────────────────
const searchRoutes   = require('./routes/search');
const streamRoutes   = require('./routes/stream');

// Search: GET /api/apple-search?q=
app.use('/api/apple-search', searchRoutes);

// Stream / Download via R2: GET /api/stream?id=VIDEO_ID
app.use('/api/stream', streamRoutes);

// ── Health Check ─────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        status:  'ok',
        message: 'Pagaska Music Backend 🎵 (R2 Edition)',
        endpoints: [
            'GET  /api/apple-search?q=query[&region=id]',
            'GET  /api/stream?id=YOUTUBE_VIDEO_ID',
            'GET  /api/stream/info?id=YOUTUBE_VIDEO_ID',
            'GET  /api/stream/tracks[?page=1&limit=50]',
            'GET  /api/stream/search?q=query',
        ],
    });
});

// ── 404 ──────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ status: false, message: `${req.method} ${req.path} not found` });
});

// ── Global Error Handler ─────────────────────────────────────────
app.use((err, req, res, _next) => {
    console.error('[Global Error]', err.message);
    res.status(500).json({ status: false, message: err.message });
});

// ── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Pagaska Music Backend running on port ${PORT}`);
    console.log(`   R2 Bucket: ${process.env.R2_BUCKET_NAME || '(not set)'}`);
});

module.exports = app;
