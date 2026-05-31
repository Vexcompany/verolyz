import express from 'express';
import Notification from '../models/Notification.js';
import webpush from 'web-push';

const router = express.Router();

// Configure web push
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ==================== ADMIN ENDPOINTS ====================

/**
 * POST /api/notifications/send
 * Send notification to all subscribed users
 * Required: admin authentication
 */
router.post('/send', async (req, res) => {
  try {
    const { title, body, icon, badge, tag, requireInteraction } = req.body;

    // Validate required fields
    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: 'Title and body are required'
      });
    }

    // Check admin token (you should implement proper authentication)
    const adminToken = req.headers.authorization?.split(' ')[1];
    if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized - Invalid admin token'
      });
    }

    // Create notification record in database
    const notification = new Notification({
      title,
      body,
      icon: icon || '/logo-512x512.png',
      badge: badge || '/badge-72x72.png',
      tag: tag || 'spotif-notification',
      requireInteraction: requireInteraction || false,
      sentAt: new Date(),
      readBy: []
    });

    await notification.save();

    // Get all active subscriptions
    const subscriptions = await Notification.aggregate([
      { $group: { _id: '$subscription' } }
    ]);

    // Send push notifications to all subscribers
    let successCount = 0;
    let failureCount = 0;

    for (const doc of subscriptions) {
      if (doc._id) {
        try {
          await webpush.sendNotification(
            doc._id,
            JSON.stringify({
              title,
              body,
              icon: icon || '/logo-512x512.png',
              badge: badge || '/badge-72x72.png',
              tag: tag || 'spotif-notification',
              requireInteraction: requireInteraction || false,
              notificationId: notification._id,
              timestamp: Date.now()
            })
          );
          successCount++;
        } catch (err) {
          failureCount++;
          console.error('Push failed:', err.message);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Notifications sent successfully',
      notification: notification._id,
      stats: {
        sent: successCount,
        failed: failureCount,
        total: subscriptions.length
      }
    });
  } catch (err) {
    console.error('Send notification error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to send notifications',
      error: err.message
    });
  }
});

/**
 * GET /api/notifications/history
 * Get notification history (admin)
 */
router.get('/history', async (req, res) => {
  try {
    const adminToken = req.headers.authorization?.split(' ')[1];
    if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;

    const notifications = await Notification.find()
      .select('title body icon sentAt readBy')
      .sort({ sentAt: -1 })
      .limit(limit)
      .skip(skip);

    const total = await Notification.countDocuments();

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        total,
        limit,
        skip,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch history',
      error: err.message
    });
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete a notification
 */
router.delete('/:id', async (req, res) => {
  try {
    const adminToken = req.headers.authorization?.split(' ')[1];
    if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const notification = await Notification.findByIdAndDelete(req.params.id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ==================== USER ENDPOINTS ====================

/**
 * POST /api/notifications/subscribe
 * Subscribe user to push notifications
 */
router.post('/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;

    if (!subscription) {
      return res.status(400).json({
        success: false,
        message: 'Subscription object is required'
      });
    }

    // Check if subscription already exists
    const existing = await Notification.findOne({ subscription });
    if (existing) {
      return res.status(200).json({
        success: true,
        message: 'Already subscribed'
      });
    }

    // Save new subscription
    const newSubscription = new Notification({
      subscription,
      subscribedAt: new Date()
    });

    await newSubscription.save();

    res.status(200).json({
      success: true,
      message: 'Successfully subscribed to notifications'
    });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to subscribe',
      error: err.message
    });
  }
});

/**
 * POST /api/notifications/unsubscribe
 * Unsubscribe user from push notifications
 */
router.post('/unsubscribe', async (req, res) => {
  try {
    const { subscription } = req.body;

    if (!subscription) {
      return res.status(400).json({
        success: false,
        message: 'Subscription object is required'
      });
    }

    await Notification.deleteOne({ subscription });

    res.status(200).json({
      success: true,
      message: 'Successfully unsubscribed'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/notifications/mark-read
 * Mark notification as read
 */
router.post('/mark-read', async (req, res) => {
  try {
    const { notificationId, userId } = req.body;

    if (!notificationId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'notificationId and userId are required'
      });
    }

    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { $addToSet: { readBy: userId } },
      { new: true }
    );

    res.status(200).json({
      success: true,
      data: notification
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/notifications/public-key
 * Get VAPID public key for client
 */
router.get('/public-key', (req, res) => {
  res.status(200).json({
    success: true,
    publicKey: process.env.VAPID_PUBLIC_KEY
  });
});

export default router;
