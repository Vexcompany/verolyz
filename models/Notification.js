import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  // Notification content
  title: {
    type: String,
    required: false
  },
  body: {
    type: String,
    required: false
  },
  icon: {
    type: String,
    default: '/logo-512x512.png'
  },
  badge: {
    type: String,
    default: '/badge-72x72.png'
  },
  tag: {
    type: String,
    default: 'spotif-notification'
  },
  requireInteraction: {
    type: Boolean,
    default: false
  },
  
  // User subscription
  subscription: {
    type: mongoose.Schema.Types.Mixed,
    sparse: true
  },
  
  // Metadata
  sentAt: {
    type: Date,
    default: Date.now
  },
  subscribedAt: {
    type: Date,
    default: Date.now
  },
  
  // Read tracking
  readBy: [{
    type: String,
    default: []
  }],
  
  // Additional metadata
  type: {
    type: String,
    enum: ['news', 'update', 'alert', 'promotion'],
    default: 'news'
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high'],
    default: 'normal'
  },
  
  // Link/action
  action: {
    type: String,
    default: null
  },
  actionUrl: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  collection: 'notifications'
});

// Index for better query performance
notificationSchema.index({ sentAt: -1 });
notificationSchema.index({ subscription: 1 });
notificationSchema.index({ createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
