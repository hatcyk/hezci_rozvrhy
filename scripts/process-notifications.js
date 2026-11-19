#!/usr/bin/env node

/**
 * Standalone notification run (GitHub Actions, host crontab, or by hand).
 * Processes pending change notifications from Firestore and sends FCM
 * notifications; the run is recorded in `runs` (contract S4).
 */

require('dotenv').config();
const { initializeFirebaseAdmin } = require('../backend/firebase-admin-init');
const { processPendingChanges } = require('../backend/fcm');
const { runJob } = require('../backend/cron');

async function main() {
    console.log('🔔 Starting notification processing...\n');
    const startTime = Date.now();

    try {
        initializeFirebaseAdmin();

        const { result } = await runJob('notify', async () => {
            const r = await processPendingChanges();
            return { result: r, counts: { processed: r.processedCount || 0, sent: r.sentCount || 0 } };
        });

        console.log(`✅ Change documents processed: ${result.processedCount}, notifications sent: ${result.sentCount} ` +
            `(${((Date.now() - startTime) / 1000).toFixed(2)} s)`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Notification processing failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
