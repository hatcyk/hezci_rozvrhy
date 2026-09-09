#!/usr/bin/env node

/**
 * Standalone cleanup run.
 *
 * Prunes the deduplication records of already delivered reminders and the
 * processed change documents. Meant to run once a day.
 */

require('dotenv').config();
const { initializeFirebaseAdmin } = require('../backend/firebase-admin-init');
const { cleanupOldNotifications } = require('../backend/notification-tracker');
const { cleanupOldChanges } = require('../backend/fcm');

const KEEP_NOTIFICATION_DAYS = 7;
const KEEP_CHANGE_DAYS = 2;

async function main() {
    try {
        initializeFirebaseAdmin();

        const notifications = await cleanupOldNotifications(KEEP_NOTIFICATION_DAYS);
        const changes = await cleanupOldChanges(KEEP_CHANGE_DAYS);

        console.log(`✅ Cleanup: removed ${notifications.deleted || 0} notification records ` +
            `and ${changes.deleted || 0} change documents`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Cleanup failed:', error.message);
        process.exit(1);
    }
}

main();
