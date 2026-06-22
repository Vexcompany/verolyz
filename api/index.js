/**
 * api/index.js — Vercel Serverless Function
 * MAIN HANDLER untuk Pagaska Music Backend
 * - Combines: Express app + Routes + MongoDB + Notifications
 * - Export handler agar Vercel bisa execute sebagai function
 * - JANGAN gunakan app.listen() di Vercel
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import notificationRoutes from './notifications.js';

dotenv.config();

const app = express();

// ════════════════════════════════════════════════════════════════
//  MIDDLEWARE — CORS HARUS PALING PERTAMA!
// ════════════════════════════════════════════════════════════════

app.use(cors({
  origin: [
    'https://spotif-main.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    '*'  // Fallback untuk development — HAPUS di production
  ],
  credentials: false,  // Jangan pakai true + '*' bersamaan
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ════════════════════════════════════════════════════════════════
//  MONGODB CONNECTION
// ════════════════════════════════════════════════════════════════

if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    socketTimeoutMS: 45000,
  })
    .then(() => console.log('✓ MongoDB connected'))
    .catch(err => console.error('✗ MongoDB error:', err.message));
} else {
  console.warn('⚠️  MONGODB_URI not set — skipping MongoDB connection');
}

// ════════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════════

// Notifications
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Pagaska Music Backend 🎵 is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'unknown',
    vercel: !!process.env.VERCEL
  });
});

// Root redirect
app.get('/', (req, res) => {
  res.redirect('/api/health');
});

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
      'GET  /api/notifications/public-key'
    ]
  });
});

// ════════════════════════════════════════════════════════════════
//  ERROR HANDLER
// ════════════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  console.error(err.stack);
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ════════════════════════════════════════════════════════════════
//  EXPORT: Default handler untuk Vercel
// ════════════════════════════════════════════════════════════════
export default app;

// ════════════════════════════════════════════════════════════════
//  LOCAL DEVELOPMENT: Listen hanya jika bukan Vercel
// ════════════════════════════════════════════════════════════════

if (!process.env.VERCEL && !process.env.VERCEL_ENV) {
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
