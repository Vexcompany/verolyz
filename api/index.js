/**
 * api/index.js — Vercel Serverless Entry Point
 * Handle semua routes: notifications + search + stream + karaoke
 * CommonJS agar konsisten dengan routes/controllers/services
 */

const express           = require('express');
const mongoose          = require('mongoose');
const notificationRoutes = require('./notifications.js');
const searchRoutes      = require('../routes/search.js');
const streamRoutes      = require('../routes/stream.js');
const karaokeRoutes     = require('../routes/karaoke.js');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();

// ── CORS ─────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── MongoDB (lazy connect, satu kali per instance) ────────────
let mongoConnected = false;
async function connectMongo() {
  if (mongoConnected || !process.env.MONGODB_URI) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 5,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
    });
    mongoConnected = true;
    console.log('✓ MongoDB connected');
  } catch (err) {
    console.error('✗ MongoDB error:', err.message);
  }
}

// Middleware: connect MongoDB sebelum tiap request ke /api/notifications
app.use('/api/notifications', async (req, res, next) => {
  await connectMongo();
  next();
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/notifications', notificationRoutes);
app.use('/api/apple-search',  searchRoutes);
app.use('/api/stream',        streamRoutes);
app.use('/api/karaoke',       karaokeRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Pagaska Music Backend 🎵',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'unknown',
    debug: {
      mongodb:   !!process.env.MONGODB_URI,
      vapid:     !!process.env.VAPID_PUBLIC_KEY,
      r2:        !!process.env.R2_BUCKET_NAME,
      theresav:  !!process.env.THERESAV_API_KEY,
    },
  });
});

app.get('/', (req, res) => res.redirect('/api/health'));

// ── 404 ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path,
    available: [
      'GET  /api/health',
      'GET  /api/apple-search?q=query',
      'GET  /api/stream?id=VIDEO_ID',
      'POST /api/stream',
      'GET  /api/stream/tracks',
      'GET  /api/stream/search?q=query',
      'POST /api/karaoke',
      'GET  /api/karaoke/status?trackId=xxx',
      'POST /api/notifications/subscribe',
      'POST /api/notifications/send',
      'GET  /api/notifications/history',
      'GET  /api/notifications/public-key',
    ],
  });
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// ── Export untuk Vercel ───────────────────────────────────────
module.exports = app;

// ── Local dev ─────────────────────────────────────────────────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  connectMongo();
  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}/api/health`));
}
