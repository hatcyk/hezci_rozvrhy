/**
 * FCM Notification Routes
 * Handles push notification subscriptions and preferences.
 *
 * Every user route goes through requireUser: the caller must send the Firebase
 * ID token of the user named in the path/body (contract S1).
 */

const express = require('express');
const { getFirestore } = require('../backend/firebase-admin-init');
const { processPendingChanges, deriveWatchIndex } = require('../backend/fcm');
const { requireUser, verifyCronRequest } = require('../backend/auth-middleware');
const { validateFcmToken, validateWatchedTimetables, isPlainObject } = require('./validation');

const router = express.Router();

// Subscribe user device to FCM notifications
router.post('/subscribe', requireUser, async (req, res) => {
    try {
        const { userId, token } = req.body;

        if (!userId || !token) {
            return res.status(400).json({ error: 'userId and token are required' });
        }
        const tokenError = validateFcmToken(token);
        if (tokenError) return res.status(400).json({ error: tokenError });

        const db = getFirestore();
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            const oldTokens = userDoc.data().tokens || [];

            await userRef.update({
                tokens: [token],
                notificationsEnabled: true,
                lastUpdated: new Date().toISOString()
            });

            console.log(`✅ Updated FCM token for user ${userId}`);
            console.log(`   Old tokens count: ${oldTokens.length} → New: 1`);
        } else {
            await userRef.set({
                tokens: [token],
                notificationsEnabled: true,
                preferences: {
                    watchedTimetables: []
                },
                watchedKeys: [],
                hasReminders: false,
                watchedTypes: [],
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

// Turn notifications off for a user.
// `token` is optional: without it every token of the user is removed, which is
// what the app needs when the browser session never loaded its own token.
// notificationsEnabled records the choice, so nothing re-enables it silently.
router.post('/unsubscribe', requireUser, async (req, res) => {
    try {
        const { userId, token } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }
        if (token !== undefined && token !== null) {
            const tokenError = validateFcmToken(token);
            if (tokenError) return res.status(400).json({ error: tokenError });
        }

        const db = getFirestore();
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            // Nothing stored for this user - the requested state already holds.
            return res.json({ success: true, message: 'No subscription to remove' });
        }

        const tokens = userDoc.data().tokens || [];
        const remainingTokens = token ? tokens.filter(t => t !== token) : [];

        await userRef.update({
            tokens: remainingTokens,
            notificationsEnabled: false,
            lastUpdated: new Date().toISOString()
        });

        console.log(`🔕 Notifications disabled for user ${userId} (tokens ${tokens.length} → ${remainingTokens.length})`);
        res.json({ success: true, message: 'Notifications disabled', tokens: remainingTokens.length });

    } catch (error) {
        console.error('FCM unsubscribe error:', error);
        res.status(500).json({ error: 'Failed to remove token' });
    }
});

// Update user notification preferences
router.post('/update-preferences', requireUser, async (req, res) => {
    try {
        const { userId, watchedTimetables } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const listError = validateWatchedTimetables(watchedTimetables);
        if (listError) return res.status(400).json({ error: listError });

        const db = getFirestore();
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        // Denormalized index fields for efficient watcher/reminder queries.
        const { watchedKeys, hasReminders, watchedTypes } = deriveWatchIndex(watchedTimetables);

        if (userDoc.exists) {
            await userRef.update({
                'preferences.watchedTimetables': watchedTimetables,
                watchedKeys,
                hasReminders,
                watchedTypes,
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
                watchedTypes,
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
router.post('/update-global-preferences', requireUser, async (req, res) => {
    try {
        const { userId, notificationTypes } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        if (!isPlainObject(notificationTypes)) {
            return res.status(400).json({ error: 'notificationTypes must be an object' });
        }
        const systemStatus = notificationTypes.systemStatus === true;

        const db = getFirestore();
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            // Update existing user
            await userRef.update({
                'preferences.notificationTypes.systemStatus': systemStatus,
                lastUpdated: new Date().toISOString()
            });
        } else {
            // Create new user
            await userRef.set({
                tokens: [],
                preferences: {
                    watchedTimetables: [],
                    notificationTypes: { systemStatus }
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
router.get('/preferences/:userId', requireUser, async (req, res) => {
    try {
        const { userId } = req.params;

        const db = getFirestore();
        const userDoc = await db.collection('users').doc(userId).get();

        if (userDoc.exists) {
            const userData = userDoc.data();
            const prefs = userData.preferences || {};
            const notifTypes = prefs.notificationTypes || {};

            const hasTokens = (userData.tokens || []).length > 0;

            res.json({
                watchedTimetables: prefs.watchedTimetables || [],
                hasTokens,
                // Explicit user choice; older docs predate the flag, so fall back
                // to "enabled if a token is stored".
                notificationsEnabled: userData.notificationsEnabled ?? hasTokens,
                notificationTypes: {
                    systemStatus: notifTypes.systemStatus ?? false
                }
            });
        } else {
            res.json({
                watchedTimetables: [],
                hasTokens: false,
                notificationsEnabled: false,
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

// Manually trigger notification processing. Sends pushes to every watcher, so
// it is a scheduler endpoint (CRON_SECRET), not a public one.
router.post('/process-changes', verifyCronRequest, async (req, res) => {
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
