#!/usr/bin/env node

/**
 * Standalone lesson-reminder run.
 *
 * Sends the "next lesson" reminders that are due right now. Meant to be called
 * every minute during school hours, either by GitHub Actions or by cron on a
 * self-hosted server (see DEPLOYMENT.md).
 */

require('dotenv').config();
const { initializeFirebaseAdmin } = require('../backend/firebase-admin-init');
const { sendLessonReminders } = require('../backend/lesson-reminder');

async function main() {
    try {
        initializeFirebaseAdmin();

        const result = await sendLessonReminders();
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
