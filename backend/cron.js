/**
 * Cron Job Scheduler
 * Automatically runs prefetch every 10 minutes<
 */

const cron = require('node-cron');
const { prefetchAllData } = require('./prefetch');
const { initializeFirebaseAdmin, getFirestore } = require('./firebase-admin-init');
const { sendLessonReminders } = require('./lesson-reminder');
const { processPendingChanges, cleanupOldChanges } = require('./fcm');
const { cleanupOldNotifications } = require('./notification-tracker');

let cronJob = null;
let lessonReminderCron = null;
let cleanupCron = null;
let isRunning = false;

// Track last prefetch status (in-memory fallback)
let lastPrefetchStatus = {
    isHealthy: false,
    lastRun: null,
    lastSuccess: null,
    definitionsCount: 0,
    successCount: 0,
    totalRequests: 0,
    error: 'No prefetch has run yet - status unknown'
};

// Track previous health status for change detection
let previousHealthStatus = null;

/**
 * Save prefetch status to Firestore (for serverless persistence)
 */
async function savePrefetchStatus(status) {
    try {
        const db = getFirestore();
        await db.collection('system').doc('prefetchStatus').set({
            ...status,
            lastRun: status.lastRun ? status.lastRun.toISOString() : null,
            lastSuccess: status.lastSuccess ? status.lastSuccess.toISOString() : null,
            updatedAt: new Date().toISOString()
        });
        console.log('✅ Prefetch status saved to Firestore');
    } catch (error) {
        console.error('Failed to save prefetch status to Firestore:', error.message);
    }
}

/**
 * Load prefetch status from Firestore (for serverless)
 */
async function loadPrefetchStatus() {
    try {
        const db = getFirestore();
        const doc = await db.collection('system').doc('prefetchStatus').get();

        if (!doc.exists) {
            return lastPrefetchStatus; // Return default if not found
        }

        const data = doc.data();
        return {
            isHealthy: data.isHealthy,
            lastRun: data.lastRun ? new Date(data.lastRun) : null,
            lastSuccess: data.lastSuccess ? new Date(data.lastSuccess) : null,
            definitionsCount: data.definitionsCount || 0,
            successCount: data.successCount || 0,
            totalRequests: data.totalRequests || 0,
            error: data.error || null
        };
    } catch (error) {
        console.error('Failed to load prefetch status from Firestore:', error.message);
        return lastPrefetchStatus; // Return in-memory fallback
    }
}

/**
 * Run prefetch with error handling and status tracking
 */
async function runPrefetch() {
    if (isRunning) {
        console.log('⏭️  Prefetch already running, skipping this run');
        return;
    }

    isRunning = true;
    const startTime = new Date();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🕐 Prefetch started at: ${startTime.toLocaleString('cs-CZ')}`);
    console.log(`${'='.repeat(60)}`);

    try {
        const result = await prefetchAllData();

        console.log(`✅ Prefetch successful`);
        console.log(`   Duration: ${(result.duration / 1000 / 60).toFixed(2)} minutes`);
        console.log(`   Success: ${result.successCount}/${result.totalRequests}`);

        // Update status - healthy if we got definitions
        const isHealthy = result.definitionsCount > 0;

        lastPrefetchStatus = {
            isHealthy: isHealthy,
            lastRun: startTime,
            lastSuccess: startTime,
            definitionsCount: result.definitionsCount || 0,
            successCount: result.successCount,
            totalRequests: result.totalRequests,
            error: result.definitionsCount === 0 ? 'No definitions fetched - API may be down or cookie expired' : null
        };

        // Save status to Firestore (for serverless persistence)
        await savePrefetchStatus(lastPrefetchStatus);

        // Detect API status change and send notifications
        await detectAndNotifyStatusChange(isHealthy);

        // Process pending changes and send notifications
        console.log('📨 Processing pending change notifications...');
        await processPendingChanges();

    } catch (error) {
        console.error(`❌ Prefetch failed:`, error.message);
        console.error(error.stack);

        // Update status - unhealthy
        lastPrefetchStatus = {
            isHealthy: false,
            lastRun: startTime,
            lastSuccess: lastPrefetchStatus.lastSuccess,
            definitionsCount: 0,
            successCount: 0,
            totalRequests: 0,
            error: error.message
        };

        // Save status to Firestore (for serverless persistence)
        await savePrefetchStatus(lastPrefetchStatus);

        // Detect API status change and send notifications
        await detectAndNotifyStatusChange(false);

    } finally {
        isRunning = false;
        const endTime = new Date();
        console.log(`🕐 Prefetch ended at: ${endTime.toLocaleString('cs-CZ')}\n`);
    }
}

/**
 * Detect API status change and send notifications if needed
 */
async function detectAndNotifyStatusChange(currentHealth) {
    // Skip if this is the first run (previousHealthStatus not set yet)
    if (previousHealthStatus === null) {
        previousHealthStatus = currentHealth;
        console.log(`🔄 Initial API health status: ${currentHealth ? 'healthy' : 'unhealthy'}`);
        return;
    }

    // Check if status changed
    if (previousHealthStatus !== currentHealth) {
        console.log(`\n🔔 API status changed: ${previousHealthStatus ? 'healthy' : 'unhealthy'} → ${currentHealth ? 'healthy' : 'unhealthy'}`);

        // Notifications removed - user will see alert in UI
        if (!currentHealth) {
            // API went down
            console.log('⚠️  API is down (notifications disabled)');
        } else {
            // API restored
            console.log('✅ API restored (notifications disabled)');
        }

        // Update previous status
        previousHealthStatus = currentHealth;
    }
}

/**
 * Start cron job scheduler
 * Runs every 10 minutes (e.g., 14:00, 14:10, 14:20, ...)
 */
function startCronJob() {
    if (cronJob) {
        console.log('⚠️  Cron job already running');
        return;
    }

    // Initialize Firebase first
    try {
        initializeFirebaseAdmin();
    } catch (error) {
        console.error('Failed to initialize Firebase, cron job not started');
        return;
    }

    // Run immediately on startup (unless disabled for dev)
    const skipInitialPrefetch = process.env.SKIP_INITIAL_PREFETCH === 'true';

    if (skipInitialPrefetch) {
        console.log('⏭️  Skipping initial prefetch (SKIP_INITIAL_PREFETCH=true)');
        console.log('   To run prefetch manually: POST /api/prefetch/trigger\n');
    } else {
        console.log('🚀 Running initial prefetch on startup...');
        runPrefetch().catch(err => console.error('Initial prefetch failed:', err));
    }

    // Schedule cron: Every 10 minutes
    // Cron format: minute hour day month weekday
    // '*/10 * * * *' = every 10 minutes
    cronJob = cron.schedule('*/10 * * * *', () => {
        console.log('⏰ 10-minute prefetch triggered');
        runPrefetch().catch(err => console.error('Scheduled prefetch failed:', err));
    });

    // Schedule lesson reminder cron: Every minute
    lessonReminderCron = cron.schedule('* * * * *', () => {
        sendLessonReminders().catch(err => console.error('Lesson reminder failed:', err));
    });

    // Schedule cleanup cron: Daily at midnight (00:00)
    cleanupCron = cron.schedule('0 0 * * *', () => {
        console.log('🧹 Daily cleanup triggered');
        cleanupOldNotifications(7).catch(err => console.error('Cleanup notifications failed:', err));
        cleanupOldChanges(2).catch(err => console.error('Cleanup changes failed:', err));
    });

    console.log('✅ Cron jobs scheduled:');
    console.log('   - Prefetch: Running every 10 minutes');
    console.log('   - Lesson reminders: Running every minute');
    console.log('   - Cleanup: Running daily at midnight (old notification records & processed changes)\n');
}

/**
 * Stop cron jobs
 */
function stopCronJob() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
        console.log('🛑 Prefetch cron job stopped');
    }
    if (lessonReminderCron) {
        lessonReminderCron.stop();
        lessonReminderCron = null;
        console.log('🛑 Lesson reminder cron job stopped');
    }
    if (cleanupCron) {
        cleanupCron.stop();
        cleanupCron = null;
        console.log('🛑 Cleanup cron job stopped');
    }
}

/**
 * Get cron job status
 */
function getCronStatus() {
    return {
        running: cronJob !== null,
        lessonReminderRunning: lessonReminderCron !== null,
        cleanupRunning: cleanupCron !== null,
        prefetchInProgress: isRunning,
    };
}

/**
 * Get last prefetch status (for API health check)
 * Loads from Firestore for serverless compatibility
 */
async function getLastPrefetchStatus() {
    try {
        const status = await loadPrefetchStatus();
        return {
            ...status,
            prefetchInProgress: isRunning
        };
    } catch (error) {
        console.error('Failed to get prefetch status:', error.message);
        // Fallback to in-memory status
        return {
            ...lastPrefetchStatus,
            prefetchInProgress: isRunning
        };
    }
}

/**
 * Manually trigger prefetch (for testing or manual refresh)
 * Ensures Firebase is initialized before running (important for Vercel serverless)
 */
async function triggerManualPrefetch() {
    console.log('🔧 Manual prefetch triggered');

    // Initialize Firebase Admin if not already initialized
    // This is crucial for Vercel serverless functions where startCronJob() doesn't run
    try {
        initializeFirebaseAdmin();
    } catch (error) {
        console.error('Failed to initialize Firebase Admin:', error.message);
        throw error;
    }

    return runPrefetch();
}

module.exports = {
    startCronJob,
    stopCronJob,
    getCronStatus,
    getLastPrefetchStatus,
    triggerManualPrefetch,
};
