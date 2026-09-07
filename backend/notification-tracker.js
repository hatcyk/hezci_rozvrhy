/**
 * Notification Tracker Module
 * Firestore-based deduplication for lesson reminders
 */

const { getFirestore } = require('./firebase-admin-init');

const COLLECTION_NAME = 'lesson_notifications_sent';

/**
 * Check if notification has already been sent for this user/date/lesson
 * @param {String} userId - User ID
 * @param {String} date - Date string (YYYY-MM-DD)
 * @param {Number} lessonHour - Lesson hour (0-12)
 * @returns {Promise<Boolean>} True if already sent
 */
async function hasNotificationBeenSent(userId, date, lessonHour) {
    try {
        const db = getFirestore();
        const docId = `${userId}_${date}_${lessonHour}`;

        const doc = await db.collection(COLLECTION_NAME).doc(docId).get();

        return doc.exists;
    } catch (error) {
        console.error(`[DEDUP ERROR] Failed to check if notification was sent:`, error.message);
        // In case of error, return false (better to send duplicate than miss notification)
        return false;
    }
}

/**
 * Record that a notification has been sent
 * @param {String} userId - User ID
 * @param {String} date - Date string (YYYY-MM-DD)
 * @param {Number} lessonHour - Lesson hour (0-12)
 * @param {Object} details - Additional details to store
 * @returns {Promise<void>}
 */
async function recordNotificationSent(userId, date, lessonHour, details = {}) {
    try {
        const db = getFirestore();
        const docId = `${userId}_${date}_${lessonHour}`;

        await db.collection(COLLECTION_NAME).doc(docId).set({
            userId,
            date,
            lessonHour,
            sentAt: new Date().toISOString(),
            ...details
        });

        console.log(`💾 [RECORD] Recorded notification: ${docId}`);
    } catch (error) {
        console.error(`[RECORD ERROR] Failed to record notification:`, error.message);
        // Don't throw - notification was already sent successfully
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
    hasNotificationBeenSent,
    recordNotificationSent,
    cleanupOldNotifications,
    clearNotificationsForDate,
};
