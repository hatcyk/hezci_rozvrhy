/**
 * Prefetch runner + status tracking
 *
 * Scheduling lives in .github/workflows/ (prefetch, process-notifications,
 * lesson-reminders, cleanup); this module only runs a prefetch on demand
 * (/api/cron/prefetch, /api/prefetch/trigger) and persists its status for
 * /api/status.
 */

const { prefetchAllData } = require('./prefetch');
const { initializeFirebaseAdmin, getFirestore } = require('./firebase-admin-init');
const { processPendingChanges } = require('./fcm');

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

    } finally {
        isRunning = false;
        const endTime = new Date();
        console.log(`🕐 Prefetch ended at: ${endTime.toLocaleString('cs-CZ')}\n`);
    }
}

/**
 * Runner status (for /api/prefetch/status)
 */
function getCronStatus() {
    return { prefetchInProgress: isRunning };
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

    // Initialize Firebase Admin if not already initialized (serverless-safe)
    try {
        initializeFirebaseAdmin();
    } catch (error) {
        console.error('Failed to initialize Firebase Admin:', error.message);
        throw error;
    }

    return runPrefetch();
}

module.exports = {
    getCronStatus,
    getLastPrefetchStatus,
    triggerManualPrefetch,
};
