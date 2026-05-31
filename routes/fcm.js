/**
 * FCM Notification Routes
 * Handles push notification subscriptions and preferences
 */

const express = require('express');
const { getFirestore } = require('../backend/firebase-admin-init');
const { processPendingChanges, deriveWatchIndex } = require('../backend/fcm');

const router = express.Router();

// Subscribe user device to FCM notifications
router.post('/subscribe', async (req, res) => {
    try {
        const { userId, token } = req.body;

        if (!userId || !token) {
            return res.status(400).json({ error: 'userId and token are required' });
        }

        const db = getFirestore();
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            const oldTokens = userDoc.data().tokens || [];

            await userRef.update({
                tokens: [token],
                lastUpdated: new Date().toISOString()
            });

            console.log(`✅ Updated FCM token for user ${userId}`);
            console.log(`   Old tokens count: ${oldTokens.length} → New: 1`);

            const verifyDoc = await userRef.get();
            const verifyTokens = verifyDoc.data().tokens || [];
            if (verifyTokens.length > 1) {
                console.warn(`⚠️  WARNING: User ${userId} still has ${verifyTokens.length} tokens after update!`);
            }
        } else {
            await userRef.set({
                tokens: [token],
                preferences: {
                    watchedTimetables: []
                },
                watchedKeys: [],
                hasReminders: false,
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            });
            console.log(`✅ Created new user ${userId} with FCM token`);
        }

        res.json({ success: true, message: 'Token saved successfully' });

    } catch (error) {
        console.error('FCM subscribe error:', error);
        res.status(500).json({ error: 'Failed to save token' });
    }
});

// Unsubscribe user device
router.post('/unsubscribe', async (req, res) => {
    try {
        const { userId, token } = req.body;

        if (!userId || !token) {
            return res.status(400).json({ error: 'userId and token are required' });
        }

        const db = getFirestore();
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            const userData = userDoc.data();
            const tokens = userData.tokens || [];
            const filteredTokens = tokens.filter(t => t !== token);

            await userRef.update({
                tokens: filteredTokens,
                lastUpdated: new Date().toISOString()
            });

            res.json({ success: true, message: 'Token removed successfully' });
        } else {
            res.status(404).json({ error: 'User not found' });
        }

    } catch (error) {
        console.error('FCM unsubscribe error:', error);
        res.status(500).json({ error: 'Failed to remove token' });
    }
});

// Update user notification preferences
router.post('/update-preferences', async (req, res) => {
    try {
        const { userId, watchedTimetables } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        if (!Array.isArray(watchedTimetables)) {
            return res.status(400).json({ error: 'watchedTimetables must be an array' });
        }

        const db = getFirestore();
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        // Denormalized index fields for efficient watcher/reminder queries.
        const { watchedKeys, hasReminders } = deriveWatchIndex(watchedTimetables);

        if (userDoc.exists) {
            await userRef.update({
                'preferences.watchedTimetables': watchedTimetables,
                watchedKeys,
                hasReminders,
                lastUpdated: new Date().toISOString()
            });
        } else {
            await userRef.set({
                tokens: [],
                preferences: {
                    watchedTimetables: watchedTimetables
                },
                watchedKeys,
                hasReminders,
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            });
        }

        res.json({ success: true, message: 'Preferences updated successfully' });

    } catch (error) {
        console.error('FCM update preferences error:', error);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

// Update global notification preferences (systemStatus)
router.post('/update-global-preferences', async (req, res) => {
    try {
        const { userId, notificationTypes } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        if (!notificationTypes || typeof notificationTypes !== 'object') {
            return res.status(400).json({ error: 'notificationTypes must be an object' });
        }

        const db = getFirestore();
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            // Update existing user
            await userRef.update({
                'preferences.notificationTypes.systemStatus': notificationTypes.systemStatus ?? false,
                lastUpdated: new Date().toISOString()
            });
        } else {
            // Create new user
            await userRef.set({
                tokens: [],
                preferences: {
                    watchedTimetables: [],
                    notificationTypes: {
                        systemStatus: notificationTypes.systemStatus ?? false
                    }
                },
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            });
        }

        res.json({ success: true, message: 'Global preferences updated successfully' });

    } catch (error) {
        console.error('FCM update global preferences error:', error);
        res.status(500).json({ error: 'Failed to update global preferences' });
    }
});

// Get user notification preferences
router.get('/preferences/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const db = getFirestore();
        const userDoc = await db.collection('users').doc(userId).get();

        if (userDoc.exists) {
            const userData = userDoc.data();
            const prefs = userData.preferences || {};
            const notifTypes = prefs.notificationTypes || {};

            res.json({
                watchedTimetables: prefs.watchedTimetables || [],
                hasTokens: (userData.tokens || []).length > 0,
                notificationTypes: {
                    systemStatus: notifTypes.systemStatus ?? false
                }
            });
        } else {
            res.json({
                watchedTimetables: [],
                hasTokens: false,
                notificationTypes: {
                    systemStatus: false
                }
            });
        }

    } catch (error) {
        console.error('FCM get preferences error:', error);
        res.status(500).json({ error: 'Failed to get preferences' });
    }
});

// Manually trigger notification processing
router.post('/process-changes', async (req, res) => {
    try {
        console.log('Manual notification processing triggered via API');
        processPendingChanges().catch(err => console.error('Process changes error:', err));
        res.json({ message: 'Processing started in background', status: 'running' });
    } catch (error) {
        console.error('FCM process changes error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
