// api/server.js — Vercel Serverless Function
// Wrapper untuk semua routes non-notification:
// /api/apple-search, /api/stream, /api/karaoke

const express        = require('express');
const corsMiddleware = require('../middleware/cors.js');
const searchRoutes   = require('../routes/search.js');
const streamRoutes   = require('../routes/stream.js');
const karaokeRoutes  = require('../routes/karaoke.js');

// Muat .env hanya saat development lokal
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();

// CORS harus paling pertama
app.use(corsMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/apple-search', searchRoutes);
app.use('/api/stream',       streamRoutes);
app.use('/api/karaoke',      karaokeRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Pagaska Music Backend 🎵 (R2 Edition)',
    endpoints: [
      'GET  /api/apple-search?q=query[&region=id]',
      'GET  /api/stream?id=YOUTUBE_VIDEO_ID',
      'POST /api/stream',
      'GET  /api/stream/info?trackId=xxx',
      'GET  /api/stream/tracks',
      'GET  /api/stream/search?q=query',
      'GET  /api/stream/balancer-status',
      'POST /api/karaoke',
      'GET  /api/karaoke/status?trackId=xxx',
    ],
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ status: false, message: `${req.method} ${req.path} not found` });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ status: false, message: err.message });
});

module.exports = app;
