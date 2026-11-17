/**
 * FCM Notification Routes
 * Handles push notification subscriptions and preferences.
 *
 * Every user route goes through requireUser: the caller must send the Firebase
 * ID token of the user named in the path/body (contract S1). The writes are
 * limited per signed-in user (limitWrites).
 */

const express = require('express');
const admin = require('firebase-admin');
const { getFirestore, getMessaging } = require('../backend/firebase-admin-init');
const { processPendingChanges, deriveWatchIndex } = require('../backend/fcm');
const { requireUser, verifyCronRequest } = require('../backend/auth-middleware');
const { AttemptLimiter } = require('../backend/admin');
const { validateFcmToken, validateWatchedTimetables, isPlainObject } = require('./validation');

const router = express.Router();

// Every write is a read and a write of the user's document. Per uid, not per
// IP (the whole school shares one). 60, not fewer: every switch in the
// notification settings saves at once (9 per timetable, plus groups).
const WRITE_WINDOW_MS = 10 * 60 * 1000;
const MAX_WRITES = 60;
const writes = new AttemptLimiter({ max: MAX_WRITES, windowMs: WRITE_WINDOW_MS, lockMs: WRITE_WINDOW_MS });

function limitWrites(req, res, next) {
    const state = writes.status(req.uid);
    if (state.locked) {
        res.setHeader('Retry-After', String(state.retryAfterSec));
        return res.status(429).json({ error: 'Příliš mnoho změn nastavení upozornění, zkuste to později.', retryAfterSec: state.retryAfterSec });
    }
    writes.fail(req.uid); // counts one write
    return next();
}

// What FCM answers for a token that is malformed, of another project or no
// longer registered (with a valid message, as the dry run below sends).
const REJECTED_TOKEN_ERRORS = new Set([
    'messaging/invalid-argument',
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
]);

/**
 * Ask FCM whether the token can receive messages, without delivering
 * anything (dry run). Before, any string up to 4 kB was stored and the jobs
 * kept sending to it (an 'invalid-argument' token is never pruned, see
 * backend/fcm.js). Any other failure (FCM unreachable, quota) accepts the
 * token: an outage at Google must not keep users from turning notifications
 * on; a dead token is pruned at the next send.
 */
async function isTokenAccepted(token) {
    try {
        await getMessaging().send({ token, data: {} }, true);
        return true;
    } catch (error) {
        if (error && REJECTED_TOKEN_ERRORS.has(error.code)) return false;
        console.warn(`⚠️ FCM token check unavailable (${(error && (error.code || error.message)) || 'unknown error'}) - token accepted`);
        return true;
    }
}

/**
 * Other users/* documents that hold the token. One device under two IDs (a
 * 1.x document left behind when the migration could not prove the old ID, an
 * ID replaced after the site data were cleared) gets every notification twice
 * and cannot switch the old one off. Best effort: without the lookup the
 * token is still saved.
 */
async function otherHolders(db, userId, token) {
    try {
        const snap = await db.collection('users').where('tokens', 'array-contains', token).get();
        return snap.docs.filter(doc => doc.id !== userId);
    } catch (error) {
        console.error('FCM subscribe: lookup of other holders of the token failed:', error.message);
        return [];
    }
}

// Subscribe user device to FCM notifications
router.post('/subscribe', requireUser, limitWrites, async (req, res) => {
    try {
        const { userId, token } = req.body;

        if (!userId || !token) {
            return res.status(400).json({ error: 'userId and token are required' });
        }
        const tokenError = validateFcmToken(token);
        if (tokenError) return res.status(400).json({ error: tokenError });
        if (!(await isTokenAccepted(token))) {
            return res.status(400).json({ error: 'FCM rejected the token' });
        }

        const db = getFirestore();
        const userRef = db.collection('users').doc(userId);
        const [userDoc, others] = await Promise.all([userRef.get(), otherHolders(db, userId, token)]);

        // Taking the token from the others and storing it here in one batch.
        const batch = db.batch();
        for (const doc of others) {
            batch.update(doc.ref, { tokens: admin.firestore.FieldValue.arrayRemove(token) });
        }

        const oldTokens = userDoc.exists ? userDoc.data().tokens || [] : null;
        if (userDoc.exists) {
            batch.update(userRef, {
                tokens: [token],
                notificationsEnabled: true,
                lastUpdated: new Date().toISOString()
            });
        } else {
            batch.set(userRef, {
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
        }
        await batch.commit();

        if (oldTokens) {
            console.log(`✅ Updated FCM token for user ${userId}`);
            console.log(`   Old tokens count: ${oldTokens.length} → New: 1`);
        } else {
            console.log(`✅ Created new user ${userId} with FCM token`);
        }
        if (others.length) console.log(`   Token removed from ${others.length} other user document(s)`);

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
router.post('/unsubscribe', requireUser, limitWrites, async (req, res) => {
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
router.post('/update-preferences', requireUser, limitWrites, async (req, res) => {
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
router.post('/update-global-preferences', requireUser, limitWrites, async (req, res) => {
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
