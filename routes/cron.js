/**
 * Cron Routes for Vercel Cron Jobs
 * These endpoints are called by Vercel's cron scheduler
 * Protected by CRON_SECRET to prevent unauthorized access
 */

const express = require('express');
const { triggerManualPrefetch } = require('../backend/cron');
const { sendLessonReminders, getPragueTime } = require('../backend/lesson-reminder');
const { processPendingChanges } = require('../backend/fcm');
const { initializeFirebaseAdmin, getFirestore } = require('../backend/firebase-admin-init');

const router = express.Router();

/**
 * Middleware to verify Vercel Cron request
 * Vercel sends Authorization header with CRON_SECRET
 */
function verifyCronRequest(req, res, next) {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;

    // If CRON_SECRET is not set, allow request (for local development)
    if (!cronSecret) {
        console.warn('⚠️  CRON_SECRET not set - cron endpoint is unprotected');
        return next();
    }

    // Check if Authorization header matches
    if (authHeader === `Bearer ${cronSecret}`) {
        return next();
    }

    console.error('❌ Unauthorized cron request attempt');
    return res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Prefetch cron endpoint - runs every 10 minutes
 * Called by Vercel Cron (every 10 minutes)
 */
router.get('/prefetch', verifyCronRequest, async (req, res) => {
    try {
        console.log('⏰ Vercel Cron: Prefetch triggered');

        // Start prefetch in background
        triggerManualPrefetch().catch(err =>
            console.error('Cron prefetch error:', err)
        );

        res.json({
            success: true,
            message: 'Prefetch started',
            timestamp: getPragueTime().toISOString()
        });
    } catch (error) {
        console.error('Cron prefetch endpoint error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Lesson reminders cron endpoint - runs every minute
 * Called by Vercel Cron (every minute)
 */
router.get('/lesson-reminders', verifyCronRequest, async (req, res) => {
    try {
        console.log('⏰ Vercel Cron: Lesson reminders triggered');

        // Send lesson reminders
        const result = await sendLessonReminders();

        res.json({
            success: true,
            result: result,
            timestamp: getPragueTime().toISOString()
        });
    } catch (error) {
        console.error('Cron lesson reminders error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Process notifications cron endpoint
 * Processes pending change notifications from Firestore and sends FCM
 */
router.get('/process-notifications', verifyCronRequest, async (req, res) => {
    const startTime = new Date();

    try {
        console.log('⏰ Cron: Process notifications triggered');

        // Ensure Firebase is initialized
        initializeFirebaseAdmin();

        const result = await processPendingChanges();

        // Update status in Firestore
        const db = getFirestore();
        await db.collection('system').doc('notificationStatus').set({
            lastRun: startTime.toISOString(),
            lastSuccess: startTime.toISOString(),
            processedCount: result.processedCount || 0,
            sentCount: result.sentCount || 0,
            error: null,
            updatedAt: new Date().toISOString()
        });

        console.log(`✅ Notifications processed: ${result.processedCount} changes, ${result.sentCount} sent`);

        res.json({
            success: true,
            processedCount: result.processedCount || 0,
            sentCount: result.sentCount || 0,
            timestamp: getPragueTime().toISOString()
        });
    } catch (error) {
        console.error('Cron process-notifications error:', error);

        // Save error status
        try {
            initializeFirebaseAdmin();
            const db = getFirestore();
            await db.collection('system').doc('notificationStatus').set({
                lastRun: startTime.toISOString(),
                lastSuccess: null,
                processedCount: 0,
                sentCount: 0,
                error: error.message,
                updatedAt: new Date().toISOString()
            });
        } catch (fsError) {
            console.error('Failed to save error status:', fsError.message);
        }

        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
