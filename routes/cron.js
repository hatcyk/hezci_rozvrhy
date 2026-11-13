/**
 * Cron Routes
 * Called by an external scheduler (GitHub Actions, cron-job.org) with
 * Authorization: Bearer <CRON_SECRET>. Every call is recorded in `runs`
 * with trigger 'http' (contract S4).
 */

const express = require('express');
const { triggerManualPrefetch, runJob, cleanupOldRuns, failedCleanup } = require('../backend/cron');
const { sendLessonReminders } = require('../backend/lesson-reminder');
const { processPendingChanges, cleanupOldChanges } = require('../backend/fcm');
const { cleanupOldNotifications } = require('../backend/notification-tracker');
const { initializeFirebaseAdmin } = require('../backend/firebase-admin-init');
const { verifyCronRequest } = require('../backend/auth-middleware');
const { formatPragueTime } = require('../backend/timezone-manager');
const { intFromEnv } = require('../backend/schedule-calculator');
const { cleanupOldAudit, AUDIT_KEEP_DAYS } = require('../backend/admin');

const router = express.Router();

const KEEP_NOTIFICATION_DAYS = 7;
const KEEP_CHANGE_DAYS = 2;
const KEEP_RUN_DAYS = 30;

// cron-job.org gives up after 30 s and disables a job after more than 25
// failures, so the reminder route answers by this budget even if sending is
// still in progress (it keeps running; the claims stop any double send).
const DEFAULT_REMINDER_BUDGET_MS = 25000;

// On Vercel, work left running after the response may be frozen. When the
// optional @vercel/functions package is installed, waitUntil() keeps the
// function alive until the reminder run finishes ("Extends the lifetime of
// the request handler for the lifetime of the given Promise"). Without it
// (local server, Docker) nothing changes - the process keeps running anyway.
let waitUntil = null;
try {
    ({ waitUntil } = require('@vercel/functions'));
} catch {
    waitUntil = null;
}

// `timestamp` is the real UTC instant. It used to be getPragueTime().toISOString(),
// i.e. Prague wall-clock time labelled as UTC ("Z"), one or two hours off.
function times() {
    const now = new Date();
    return { timestamp: now.toISOString(), pragueTime: formatPragueTime(now) };
}

/**
 * Resolve with the promise's value, or with `onTimeout` after `ms`.
 */
function withBudget(promise, ms, onTimeout) {
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(onTimeout), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Prefetch: started in the background, the run records itself when done.
 */
router.get('/prefetch', verifyCronRequest, async (req, res) => {
    try {
        console.log('⏰ Cron: Prefetch triggered');

        triggerManualPrefetch({ trigger: 'http' }).catch(err =>
            console.error('Cron prefetch error:', err)
        );

        res.json({ success: true, message: 'Prefetch started', ...times() });
    } catch (error) {
        console.error('Cron prefetch endpoint error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Lesson reminders - every minute on school days.
 * 200 with the result when done within the budget, otherwise 202 (still running).
 */
router.get('/lesson-reminders', verifyCronRequest, async (req, res) => {
    const job = runJob('reminders', async () => {
        const result = await sendLessonReminders();
        return {
            result,
            counts: {
                sent: result.sent || 0,
                users: result.users || 0,
                skipped: result.skipped || 0,
                failed: result.failed || 0,
                ...(result.reason ? { reason: result.reason } : {}),
            },
        };
    }, { trigger: 'http' });

    // Keep a late failure from becoming an unhandled rejection.
    const settled = job.catch(err => console.error('Cron lesson reminders error:', err.message));
    if (waitUntil) waitUntil(settled);

    try {
        const budget = intFromEnv('REMINDER_HTTP_BUDGET_MS', DEFAULT_REMINDER_BUDGET_MS);
        const outcome = await withBudget(job, budget, null);

        if (!outcome) {
            console.warn(`⏳ Lesson reminders still running after ${budget} ms - answering early`);
            return res.status(202).json({ success: true, pending: true, ...times() });
        }
        res.json({ success: true, result: outcome.result, ...times() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Process notifications cron endpoint
 * Processes pending change notifications from Firestore and sends FCM
 */
router.get('/process-notifications', verifyCronRequest, async (req, res) => {
    try {
        console.log('⏰ Cron: Process notifications triggered');
        initializeFirebaseAdmin();

        const { result } = await runJob('notify', async () => {
            const r = await processPendingChanges();
            return { result: r, counts: { processed: r.processedCount || 0, sent: r.sentCount || 0 } };
        }, { trigger: 'http' });

        console.log(`✅ Notifications processed: ${result.processedCount} changes, ${result.sentCount} sent`);

        res.json({
            success: true,
            processedCount: result.processedCount || 0,
            sentCount: result.sentCount || 0,
            ...times()
        });
    } catch (error) {
        console.error('Cron process-notifications error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Cleanup cron endpoint - prunes old dedup/notification records and old runs.
 */
router.get('/cleanup', verifyCronRequest, async (req, res) => {
    try {
        console.log('⏰ Cron: Cleanup triggered');
        initializeFirebaseAdmin();

        const { counts } = await runJob('cleanup', async () => {
            const notifResult = await cleanupOldNotifications(KEEP_NOTIFICATION_DAYS);
            const changesResult = await cleanupOldChanges(KEEP_CHANGE_DAYS);
            const runsResult = await cleanupOldRuns(KEEP_RUN_DAYS);
            const auditResult = await cleanupOldAudit(AUDIT_KEEP_DAYS);
            return {
                counts: {
                    notificationsDeleted: notifResult.deleted || 0,
                    changesDeleted: changesResult.deleted || 0,
                    runsDeleted: runsResult.deleted || 0,
                    auditDeleted: auditResult.deleted || 0,
                },
                // The cleanup helpers log and return their errors instead of throwing.
                ...failedCleanup([notifResult, changesResult, runsResult, auditResult]),
            };
        }, { trigger: 'http' });

        res.json({ success: true, ...counts, ...times() });
    } catch (error) {
        console.error('Cron cleanup error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
module.exports.withBudget = withBudget;
