#!/usr/bin/env node

/**
 * Standalone lesson-reminder run.
 *
 * Sends the "next lesson" reminders that are due right now. Meant to be called
 * every minute during school hours, either by GitHub Actions or by cron on a
 * self-hosted server (see DEPLOYMENT.md). Recorded in `runs` (contract S4).
 */

require('dotenv').config();
const { initializeFirebaseAdmin } = require('../backend/firebase-admin-init');
const { sendLessonReminders } = require('../backend/lesson-reminder');
const { runJob } = require('../backend/cron');

async function main() {
    try {
        initializeFirebaseAdmin();

        const { result } = await runJob('reminders', async () => {
            const r = await sendLessonReminders();
            return {
                result: r,
                counts: {
                    sent: r.sent || 0,
                    users: r.users || 0,
                    skipped: r.skipped || 0,
                    failed: r.failed || 0,
                    ...(r.reason ? { reason: r.reason } : {}),
                },
            };
        });

        console.log(`✅ Lesson reminders: sent ${result.sent || 0}` +
            (result.reason ? ` (${result.reason})` : '') +
            (result.skipped ? `, skipped ${result.skipped}` : ''));

        process.exit(0);
    } catch (error) {
        console.error('❌ Lesson reminders failed:', error.message);
        process.exit(1);
    }
}

main();
