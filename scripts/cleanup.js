#!/usr/bin/env node

/**
 * Standalone cleanup run.
 *
 * Prunes the deduplication records of already delivered reminders, the
 * processed change documents, job runs older than 30 days and admin audit
 * records older than 90 days. Meant to run
 * once a day. Recorded in `runs` (contract S4).
 */

require('dotenv').config();
const { initializeFirebaseAdmin } = require('../backend/firebase-admin-init');
const { cleanupOldNotifications } = require('../backend/notification-tracker');
const { cleanupOldChanges } = require('../backend/fcm');
const { runJob, cleanupOldRuns, failedCleanup } = require('../backend/cron');
const { cleanupOldAudit, AUDIT_KEEP_DAYS } = require('../backend/admin');

const KEEP_NOTIFICATION_DAYS = 7;
const KEEP_CHANGE_DAYS = 2;
const KEEP_RUN_DAYS = 30;

async function main() {
    try {
        initializeFirebaseAdmin();

        const { counts } = await runJob('cleanup', async () => {
            const notifications = await cleanupOldNotifications(KEEP_NOTIFICATION_DAYS);
            const changes = await cleanupOldChanges(KEEP_CHANGE_DAYS);
            const runs = await cleanupOldRuns(KEEP_RUN_DAYS);
            // Admin audit trail (S5): 90 days are enough to review access.
            const audit = await cleanupOldAudit(AUDIT_KEEP_DAYS);
            return {
                counts: {
                    notificationsDeleted: notifications.deleted || 0,
                    changesDeleted: changes.deleted || 0,
                    runsDeleted: runs.deleted || 0,
                    auditDeleted: audit.deleted || 0,
                },
                // The cleanup helpers log and return their errors instead of throwing.
                ...failedCleanup([notifications, changes, runs, audit]),
            };
        });

        console.log(`✅ Cleanup: removed ${counts.notificationsDeleted} notification records, ` +
            `${counts.changesDeleted} change documents and ${counts.runsDeleted} runs`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Cleanup failed:', error.message);
        process.exit(1);
    }
}

main();
