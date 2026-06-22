// models/Notification.js — CommonJS

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Notification content (untuk broadcast)
  title:              { type: String },
  body:               { type: String },
  icon:               { type: String, default: '/logo-512x512.png' },
  badge:              { type: String, default: '/badge-72x72.png' },
  tag:                { type: String, default: 'pagaska-notification' },
  requireInteraction: { type: Boolean, default: false },

  // Push subscription (untuk subscriber record)
  subscription: {
    type:   mongoose.Schema.Types.Mixed,
    sparse: true,
  },

  // Timestamps
  sentAt:       { type: Date, default: Date.now },
  subscribedAt: { type: Date },

  // Read tracking
  readBy: [{ type: String }],

  // Metadata
  type: {
    type:    String,
    enum:    ['news', 'update', 'alert', 'promotion'],
    default: 'news',
  },
  priority: {
    type:    String,
    enum:    ['low', 'normal', 'high'],
    default: 'normal',
  },
  action:    { type: String, default: null },
  actionUrl: { type: String, default: null },
}, {
  timestamps: true,
  collection: 'notifications',
});

notificationSchema.index({ sentAt: -1 });
notificationSchema.index({ 'subscription.endpoint': 1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
