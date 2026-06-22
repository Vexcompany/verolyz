// api/notifications.js — CommonJS

const express      = require('express');
const Notification = require('../models/Notification.js');
const webpush      = require('web-push');

const router = express.Router();

// Configure web push (hanya kalau env vars ada)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('⚠️  VAPID env vars tidak lengkap — web push dinonaktifkan');
}

// ── Auth helper ───────────────────────────────────────────────
function checkAdmin(req, res) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    res.status(401).json({ success: false, message: 'Unauthorized - Invalid admin token' });
    return false;
  }
  return true;
}

// ==================== ADMIN ENDPOINTS ====================

/**
 * POST /api/notifications/send
 */
router.post('/send', async (req, res) => {
  try {
    if (!checkAdmin(req, res)) return;

    const { title, body, icon, badge, tag, requireInteraction } = req.body;
    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Title and body are required' });
    }

    const notification = new Notification({
      title,
      body,
      icon:               icon || '/logo-512x512.png',
      badge:              badge || '/badge-72x72.png',
      tag:                tag || 'pagaska-notification',
      requireInteraction: requireInteraction || false,
      sentAt:             new Date(),
      readBy:             [],
    });

    await notification.save();

    // Ambil semua subscription unik
    const subscriptions = await Notification.find(
      { subscription: { $exists: true, $ne: null } },
      { subscription: 1 }
    );

    let successCount = 0;
    let failureCount = 0;

    for (const doc of subscriptions) {
      try {
        await webpush.sendNotification(
          doc.subscription,
          JSON.stringify({
            title,
            body,
            icon:               icon || '/logo-512x512.png',
            badge:              badge || '/badge-72x72.png',
            tag:                tag || 'pagaska-notification',
            requireInteraction: requireInteraction || false,
            notificationId:     notification._id,
            timestamp:          Date.now(),
          })
        );
        successCount++;
      } catch (err) {
        failureCount++;
        console.error('Push failed:', err.message);
        // Hapus subscription yang expired/invalid (status 410)
        if (err.statusCode === 410) {
          await Notification.deleteOne({ _id: doc._id }).catch(() => {});
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Notifications sent',
      notification: notification._id,
      stats: { sent: successCount, failed: failureCount, total: subscriptions.length },
    });
  } catch (err) {
    console.error('[notifications/send]', err.message);
    res.status(500).json({ success: false, message: 'Failed to send notifications', error: err.message });
  }
});

/**
 * GET /api/notifications/history
 */
router.get('/history', async (req, res) => {
  try {
    if (!checkAdmin(req, res)) return;

    const limit = parseInt(req.query.limit) || 50;
    const skip  = parseInt(req.query.skip)  || 0;

    const notifications = await Notification
      .find({ title: { $exists: true } })
      .select('title body icon sentAt readBy')
      .sort({ sentAt: -1 })
      .limit(limit)
      .skip(skip);

    const total = await Notification.countDocuments({ title: { $exists: true } });

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: { total, limit, skip, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch history', error: err.message });
  }
});

/**
 * DELETE /api/notifications/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    if (!checkAdmin(req, res)) return;

    const notification = await Notification.findByIdAndDelete(req.params.id);
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.status(200).json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== USER ENDPOINTS ====================

/**
 * POST /api/notifications/subscribe
 */
router.post('/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription) {
      return res.status(400).json({ success: false, message: 'Subscription object is required' });
    }

    // Cek duplikat berdasarkan endpoint subscription
    const endpoint = subscription.endpoint;
    const existing = await Notification.findOne({ 'subscription.endpoint': endpoint });
    if (existing) {
      return res.status(200).json({ success: true, message: 'Already subscribed' });
    }

    await new Notification({ subscription, subscribedAt: new Date() }).save();

    res.status(200).json({ success: true, message: 'Successfully subscribed to notifications' });
  } catch (err) {
    console.error('[notifications/subscribe]', err.message);
    res.status(500).json({ success: false, message: 'Failed to subscribe', error: err.message });
  }
});

/**
 * POST /api/notifications/unsubscribe
 */
router.post('/unsubscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription) {
      return res.status(400).json({ success: false, message: 'Subscription object is required' });
    }

    await Notification.deleteOne({ 'subscription.endpoint': subscription.endpoint });

    res.status(200).json({ success: true, message: 'Successfully unsubscribed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/mark-read
 */
router.post('/mark-read', async (req, res) => {
  try {
    const { notificationId, userId } = req.body;
    if (!notificationId || !userId) {
      return res.status(400).json({ success: false, message: 'notificationId and userId are required' });
    }

    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { $addToSet: { readBy: userId } },
      { new: true }
    );

    res.status(200).json({ success: true, data: notification });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/notifications/public-key
 */
router.get('/public-key', (req, res) => {
  res.status(200).json({ success: true, publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

module.exports = router;
