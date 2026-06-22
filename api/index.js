/**
 * api/index.js — Vercel Serverless Function
 * MAIN HANDLER untuk Pagaska Music Backend
 * - Express app + Routes + MongoDB + Notifications
 * - CommonJS (require/module.exports) — konsisten dengan seluruh codebase
 */

const express           = require('express');
const cors              = require('cors');
const mongoose          = require('mongoose');
const notificationRoutes = require('./notifications.js');

// Muat .env hanya saat development lokal
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();

// ════════════════════════════════════════════════════════════════
//  MIDDLEWARE — CORS HARUS PALING PERTAMA
// ════════════════════════════════════════════════════════════════

app.use(cors({
  origin: [
    'https://music.pagaska.my.id',
    'http://localhost:3000',
    'http://localhost:5173',
  ],
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ════════════════════════════════════════════════════════════════
//  MONGODB CONNECTION
// ════════════════════════════════════════════════════════════════

let isConnected = false;

async function connectMongo() {
  if (isConnected || !process.env.MONGODB_URI) {
    if (!process.env.MONGODB_URI) console.warn('⚠️  MONGODB_URI not set — skipping MongoDB');
    return;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      socketTimeoutMS: 45000,
    });
    isConnected = true;
    console.log('✓ MongoDB connected');
  } catch (err) {
    console.error('✗ MongoDB error:', err.message);
  }
}

connectMongo();

// ════════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════════

app.use('/api/notifications', notificationRoutes);

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Pagaska Music Backend 🎵 is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'unknown',
    vercel: !!process.env.VERCEL,
    debug: {
      hasMongoDBURI:      !!process.env.MONGODB_URI,
      hasVapidPublicKey:  !!process.env.VAPID_PUBLIC_KEY,
      hasVapidPrivateKey: !!process.env.VAPID_PRIVATE_KEY,
      hasVapidSubject:    !!process.env.VAPID_SUBJECT,
      hasAdminToken:      !!process.env.ADMIN_TOKEN,
    },
  });
});

app.get('/', (req, res) => res.redirect('/api/health'));

// ════════════════════════════════════════════════════════════════
//  404 HANDLER
// ════════════════════════════════════════════════════════════════

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path,
    method: req.method,
    availableEndpoints: [
      'GET  /api/health',
      'POST /api/notifications/send',
      'POST /api/notifications/subscribe',
      'POST /api/notifications/unsubscribe',
      'GET  /api/notifications/history',
      'GET  /api/notifications/public-key',
    ],
  });
});

// ════════════════════════════════════════════════════════════════
//  ERROR HANDLER
// ════════════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

// ════════════════════════════════════════════════════════════════
//  EXPORT — Vercel pakai module.exports, bukan export default
// ════════════════════════════════════════════════════════════════

module.exports = app;

// ════════════════════════════════════════════════════════════════
//  LOCAL DEV
// ════════════════════════════════════════════════════════════════

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`
  🚀 Pagaska Music Backend Running
  📍 http://localhost:${PORT}
  🏥 Health: http://localhost:${PORT}/api/health
  📦 Node: ${process.version}
  🔧 Environment: ${process.env.NODE_ENV || 'development'}
    `);
  });
}
