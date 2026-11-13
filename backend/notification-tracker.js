/**
 * Notification Tracker Module
 * Firestore-based deduplication for lesson reminders
 */

const { getFirestore } = require('./firebase-admin-init');

const COLLECTION_NAME = 'lesson_notifications_sent';

// gRPC status ALREADY_EXISTS, raised by DocumentReference.create() when the
// document is already there.
const ALREADY_EXISTS = 6;

function reminderDocId(userId, date, lessonHour) {
    return `${userId}_${date}_${lessonHour}`;
}

function isAlreadyExists(error) {
    return !!error && (error.code === ALREADY_EXISTS || error.code === 'already-exists' ||
        /ALREADY_EXISTS/.test(String(error.message || '')));
}

/**
 * Claim the right to send one reminder (user, date, lesson hour).
 *
 * docRef.create() fails when the document exists, so of several runs that
 * reach the same reminder at the same time exactly one wins. The old
 * get → send → set let two overlapping runs (cron-job.org every minute + a
 * slow run, or a retried request) both pass the check and send twice.
 *
 * Delivery is at-most-once: a run that claims and then dies does not retry.
 * `sentAt` is set at claim time so the nightly cleanup also removes claims
 * that never finished.
 *
 * @returns {Promise<boolean>} true = this run owns the reminder and must send it
 */
async function claimReminder(userId, date, lessonHour, details = {}) {
    const db = getFirestore();
    const docId = reminderDocId(userId, date, lessonHour);
    try {
        await db.collection(COLLECTION_NAME).doc(docId).create({
            userId,
            date,
            lessonHour,
            status: 'sending',
            sentAt: new Date().toISOString(),
            ...details
        });
        return true;
    } catch (error) {
        if (isAlreadyExists(error)) return false;
        // Firestore unavailable: skip rather than risk one duplicate per poll
        // for the whole reminder window.
        console.error(`[CLAIM ERROR] Failed to claim reminder ${docId}:`, error.message);
        return false;
    }
}

/**
 * Record how a claimed reminder ended ('sent' | 'failed').
 */
async function finishReminder(userId, date, lessonHour, outcome = {}) {
    const docId = reminderDocId(userId, date, lessonHour);
    try {
        const db = getFirestore();
        await db.collection(COLLECTION_NAME).doc(docId).update({
            status: outcome.status || 'sent',
            finishedAt: new Date().toISOString(),
            ...(outcome.successCount !== undefined ? { successCount: outcome.successCount } : {}),
            ...(outcome.error ? { error: String(outcome.error).slice(0, 500) } : {})
        });
    } catch (error) {
        // The claim already prevents a resend; this is bookkeeping only.
        console.error(`[RECORD ERROR] Failed to finish reminder ${docId}:`, error.message);
    }
}

/**
 * Cleanup old notification records (older than specified days)
 * @param {Number} [daysToKeep=7] - Number of days to keep records
 * @returns {Promise<Object>} Cleanup result { deleted, errors }
 */
async function cleanupOldNotifications(daysToKeep = 7) {
    try {
        const db = getFirestore();

        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoffISO = cutoffDate.toISOString();

        console.log(`🧹 [CLEANUP] Starting cleanup of notifications older than ${daysToKeep} days (before ${cutoffISO})`);

        // Query old records
        const snapshot = await db.collection(COLLECTION_NAME)
            .where('sentAt', '<', cutoffISO)
            .get();

        if (snapshot.empty) {
            console.log(`   No old notifications to clean up`);
            return { deleted: 0, errors: 0 };
        }

        console.log(`   Found ${snapshot.size} old notifications to delete`);

        // Delete in batches (Firestore batch limit is 500)
        const batchSize = 500;
        let totalDeleted = 0;
        let totalErrors = 0;

        for (let i = 0; i < snapshot.docs.length; i += batchSize) {
            const batch = db.batch();
            const batchDocs = snapshot.docs.slice(i, i + batchSize);

            batchDocs.forEach(doc => {
                batch.delete(doc.ref);
            });

            try {
                await batch.commit();
                totalDeleted += batchDocs.length;
                console.log(`   Deleted batch ${Math.floor(i / batchSize) + 1}: ${batchDocs.length} records`);
            } catch (error) {
                totalErrors += batchDocs.length;
                console.error(`   Error deleting batch ${Math.floor(i / batchSize) + 1}:`, error.message);
            }
        }

        console.log(`✅ [CLEANUP] Completed: ${totalDeleted} deleted, ${totalErrors} errors`);

        return { deleted: totalDeleted, errors: totalErrors };

    } catch (error) {
        console.error(`❌ [CLEANUP ERROR] Failed to cleanup old notifications:`, error.message);
        return { deleted: 0, errors: 1, error: error.message };
    }
}

/**
 * Clear all notification records for a specific date (for testing/debugging)
 * @param {String} date - Date string (YYYY-MM-DD)
 * @returns {Promise<Number>} Number of records deleted
 */
async function clearNotificationsForDate(date) {
    try {
        const db = getFirestore();

        const snapshot = await db.collection(COLLECTION_NAME)
            .where('date', '==', date)
            .get();

        if (snapshot.empty) {
            return 0;
        }

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();

        console.log(`🗑️ Cleared ${snapshot.size} notification records for date ${date}`);
        return snapshot.size;

    } catch (error) {
        console.error(`Failed to clear notifications for date ${date}:`, error.message);
        return 0;
    }
}

module.exports = {
    COLLECTION_NAME,
    reminderDocId,
    isAlreadyExists,
    claimReminder,
    finishReminder,
    cleanupOldNotifications,
    clearNotificationsForDate,
};
