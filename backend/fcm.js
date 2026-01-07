/**
 * Firebase Cloud Messaging Module
 * Handles push notifications to users
 */

const { getFirestore, getMessaging } = require('./firebase-admin-init');
const { createChangeSummary, createDetailedChangeSummary } = require('./change-detector');

/**
 * Send notification to a single FCM token
 * @param {String} token - FCM device token
 * @param {Object} notification - Notification payload
 * @returns {Promise<String>} Message ID
 */
async function sendNotificationToToken(token, notification) {
    try {
        const messaging = getMessaging();

        const message = {
            data: {
                title: notification.title,
                body: notification.body,
                icon: notification.icon || '/icon-192.png',
                ...(notification.data || {})
            },
            token: token
        };

        const response = await messaging.send(message);
        console.log(`✅ Notification sent to token ${token.substring(0, 20)}...`);
        return response;

    } catch (error) {
        console.error(`❌ Failed to send notification to token ${token.substring(0, 20)}...:`, error.message);
        throw error;
    }
}

/**
 * Send notification to multiple FCM tokens
 * @param {Array<String>} tokens - Array of FCM device tokens
 * @param {Object} notification - Notification payload
 * @returns {Promise<Object>} Result with success/failure counts
 */
async function sendNotificationToTokens(tokens, notification) {
    if (!tokens || tokens.length === 0) {
        console.log('⚠️  No tokens to send notification to');
        return { successCount: 0, failureCount: 0 };
    }

    try {
        const messaging = getMessaging();

        const message = {
            data: {
                title: notification.title,
                body: notification.body,
                icon: notification.icon || '/icon-192.png',
                ...(notification.data || {})
            },
            tokens: tokens
        };

        const response = await messaging.sendEachForMulticast(message);

        console.log(`✅ Sent notification to ${response.successCount}/${tokens.length} devices`);

        if (response.failureCount > 0) {
            console.warn(`⚠️  Failed to send to ${response.failureCount} devices`);
        }

        return {
            successCount: response.successCount,
            failureCount: response.failureCount,
            responses: response.responses
        };

    } catch (error) {
        console.error(`❌ Failed to send multicast notification:`, error.message);
        throw error;
    }
}

/**
 * Get all users watching a specific timetable with their notification preferences
 * @param {Object} timetable - Timetable metadata (type, id, scheduleType)
 * @returns {Promise<Array>} Array of user IDs, their tokens, and notification preferences
 */
async function getUsersWatchingTimetable(timetable) {
    try {
        const db = getFirestore();

        // Query all users
        const usersSnapshot = await db.collection('users').get();

        const watchingUsers = [];

        usersSnapshot.forEach(userDoc => {
            const userData = userDoc.data();
            const preferences = userData.preferences;

            if (!preferences || !preferences.watchedTimetables) {
                return;
            }

            // Find the watched timetable entry
            const watchedTimetable = preferences.watchedTimetables.find(watched =>
                watched.type === timetable.type &&
                watched.id === timetable.id &&
                watched.scheduleType === timetable.scheduleType
            );

            if (watchedTimetable && userData.tokens && userData.tokens.length > 0) {
                // Backwards compatibility: migrate groupFilter to groupFilters
                let groupFilters = watchedTimetable.groupFilters;
                if (!groupFilters && watchedTimetable.groupFilter) {
                    groupFilters = [watchedTimetable.groupFilter];
                } else if (!groupFilters) {
                    groupFilters = ['all'];
                }

                watchingUsers.push({
                    userId: userDoc.id,
                    tokens: userData.tokens,
                    notificationTypes: watchedTimetable.notificationTypes || null,
                    groupFilters: groupFilters
                });
            }
        });

        return watchingUsers;

    } catch (error) {
        console.error('Failed to get users watching timetable:', error.message);
        throw error;
    }
}

/**
 * Filter changes based on user's notification preferences
 * @param {Array} changes - Array of changes
 * @param {Object} notificationTypes - User's notification type preferences
 * @returns {Array} Filtered changes
 */
function filterChangesByPreferences(changes, notificationTypes) {
    if (!notificationTypes || !notificationTypes.changes) {
        // No preferences set, send all change notifications (default behavior)
        return changes;
    }

    const userPrefs = notificationTypes.changes;

    return changes.filter(change => {
        // Check if user wants this type of notification
        const typeKey = change.type;
        const isEnabled = userPrefs[typeKey];

        // If preference is not set, default to true for important changes
        if (isEnabled === undefined) {
            // Default: send important notifications (removed, substitution, room_change)
            return ['lesson_removed', 'substitution', 'room_change'].includes(typeKey);
        }

        return isEnabled;
    });
}

/**
 * Standardize group name to normalized format
 * @param {String} groupName - Raw group name from Bakalari
 * @returns {String} Standardized name (e.g., "1.sk", "2.sk", "TVDi", "TVk1")
 */
function standardizeGroupName(groupName) {
    if (!groupName) return '';

    const lower = groupName.toLowerCase().trim();

    // "celá třída" - return empty (handled by filterChangesByGroup)
    if (lower.includes('celá') || lower === 'cela') {
        return '';
    }

    // Special groups (TV, etc.) - keep as-is
    // These start with letters followed by optional digits (TVk1, TVDi, TVCh, etc.)
    // Don't convert these to "1.sk" format
    if (/^[a-záčďéěíňóřšťúůýž]{2,}/i.test(lower)) {
        return groupName; // Return original (preserve case)
    }

    // Extrahuj číslo: "1. sk", "skupina 1", "1.skupina" → "1.sk"
    const groupMatch = lower.match(/^(\d+)[\.\s]*(?:skupina|sk)?$|^(?:skupina|sk)[\.\s]*(\d+)$/);
    if (groupMatch) {
        const groupNum = groupMatch[1] || groupMatch[2];
        return `${groupNum}.sk`;
    }

    return groupName;
}

/**
 * Filter changes by group preferences (supports multiple groups)
 * @param {Array} changes - Array of changes
 * @param {Array} groupFilters - User's group filters ([] = all groups | ["1.sk", "2.sk"] = specific groups)
 * @returns {Array} Filtered changes
 */
function filterChangesByGroup(changes, groupFilters) {
    // Empty array or "all" - zobraz vše
    if (!groupFilters || groupFilters.length === 0 || groupFilters.includes('all')) return changes;

    return changes.filter(change => {
        // Změna nemá info o hodině - zobraz
        if (!change.lesson) {
            console.log(`[FILTER CHANGE] ✅ PASS (no lesson info):`, change.type);
            return true;
        }

        // Hodina bez skupiny - zobraz vždy (je pro celou třídu)
        // Robustní kontrola pro různé případy: null, undefined, prázdný string
        const hasNoGroup = !change.lesson.group ||
                          (typeof change.lesson.group === 'string' && change.lesson.group.trim() === '');

        if (hasNoGroup) {
            console.log(`[FILTER CHANGE] ✅ PASS (no group - whole class): ${change.lesson.subject || change.type}`);
            return true;
        }

        // Porovnej standardizované skupiny
        const standardizedLessonGroup = standardizeGroupName(change.lesson.group);
        const passes = groupFilters.includes(standardizedLessonGroup);

        console.log(`[FILTER CHANGE] ${passes ? '✅ PASS' : '❌ FAIL'} (group match): ${change.lesson.subject || change.type}, group: "${change.lesson.group}" → "${standardizedLessonGroup}"`);
        return passes;
    });
}

/**
 * Process pending changes and send notifications
 * This should be called periodically or triggered after prefetch
 */
async function processPendingChanges() {
    console.log('\n🔔 Processing pending notification changes...');

    try {
        const db = getFirestore();

        // Get all pending changes
        const changesSnapshot = await db.collection('changes')
            .where('sent', '==', false)
            .get();

        if (changesSnapshot.empty) {
            console.log('✅ No pending changes to process');
            return { processedCount: 0, sentCount: 0 };
        }

        console.log(`📊 Found ${changesSnapshot.size} pending change documents`);

        let processedCount = 0;
        let sentCount = 0;

        for (const changeDoc of changesSnapshot.docs) {
            const changeData = changeDoc.data();
            const timetable = changeData.timetable;
            const changes = changeData.changes;

            // Get users watching this timetable
            const watchingUsers = await getUsersWatchingTimetable(timetable);

            if (watchingUsers.length === 0) {
                console.log(`⏭️  Skipping ${timetable.name} - no users watching`);

                // Mark as sent even though no users are watching
                await changeDoc.ref.update({ sent: true, sentAt: new Date().toISOString() });
                processedCount++;
                continue;
            }

            // Send to each user with their filtered changes
            let totalSent = 0;

            for (const user of watchingUsers) {
                try {
                    // Filter changes based on user preferences
                    let filteredChanges = filterChangesByPreferences(changes, user.notificationTypes);

                    // Filter by group (now supports multiple groups)
                    filteredChanges = filterChangesByGroup(filteredChanges, user.groupFilters);

                    if (filteredChanges.length === 0) {
                        console.log(`⏭️  No relevant changes for user ${user.userId}`);
                        continue;
                    }

                    // Create notification payload with filtered changes
                    const summary = createChangeSummary(filteredChanges);
                    const detailedSummary = createDetailedChangeSummary(filteredChanges);

                    // Format schedule type in CAPSLOCK for title
                    const scheduleTypeLabel = timetable.scheduleType === 'Actual' ? 'AKTUÁLNÍ' : 'PŘÍŠTÍ';

                    const notification = {
                        title: `${timetable.name} ${scheduleTypeLabel}: Změny v rozvrhu`,
                        body: summary,
                        data: {
                            type: 'timetable_change',
                            timetableType: timetable.type,
                            timetableId: timetable.id,
                            scheduleType: timetable.scheduleType,
                            changeCount: filteredChanges.length.toString(),
                            timestamp: new Date().toISOString(),
                            detailedBody: detailedSummary
                        },
                        icon: '/icon-192.png'
                    };

                    const result = await sendNotificationToTokens(user.tokens, notification);
                    totalSent += result.successCount;
                } catch (error) {
                    console.error(`Failed to send to user ${user.userId}:`, error.message);
                }
            }

            // Mark as sent
            await changeDoc.ref.update({
                sent: true,
                sentAt: new Date().toISOString(),
                sentToUsers: watchingUsers.length,
                sentToDevices: totalSent
            });

            console.log(`✅ Sent notifications for ${timetable.name} to ${totalSent} devices`);

            processedCount++;
            sentCount += totalSent;
        }

        console.log(`\n✅ Processed ${processedCount} change documents, sent ${sentCount} notifications`);

        return { processedCount, sentCount };

    } catch (error) {
        console.error('❌ Failed to process pending changes:', error.message);
        throw error;
    }
}

/**
 * Cleanup old processed changes (older than specified days)
 * @param {Number} [daysToKeep=2] - Number of days to keep changes (default 2 days)
 * @returns {Promise<Object>} Cleanup result { deleted, errors }
 */
async function cleanupOldChanges(daysToKeep = 2) {
    try {
        const db = getFirestore();

        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoffISO = cutoffDate.toISOString();

        console.log(`\n🧹 [CLEANUP CHANGES] Starting cleanup of changes older than ${daysToKeep} days (before ${cutoffISO})`);

        // Query old processed changes (sent: true AND older than cutoff)
        const snapshot = await db.collection('changes')
            .where('sent', '==', true)
            .where('sentAt', '<', cutoffISO)
            .get();

        if (snapshot.empty) {
            console.log(`   No old changes to clean up`);
            return { deleted: 0, errors: 0 };
        }

        console.log(`   Found ${snapshot.size} old changes to delete`);

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
                console.log(`   Deleted batch ${Math.floor(i / batchSize) + 1}: ${batchDocs.length} changes`);
            } catch (error) {
                totalErrors += batchDocs.length;
                console.error(`   Error deleting batch ${Math.floor(i / batchSize) + 1}:`, error.message);
            }
        }

        console.log(`✅ [CLEANUP CHANGES] Completed: ${totalDeleted} deleted, ${totalErrors} errors\n`);

        return { deleted: totalDeleted, errors: totalErrors };

    } catch (error) {
        console.error(`❌ [CLEANUP CHANGES ERROR] Failed to cleanup old changes:`, error.message);
        return { deleted: 0, errors: 1, error: error.message };
    }
}

module.exports = {
    sendNotificationToToken,
    sendNotificationToTokens,
    getUsersWatchingTimetable,
    processPendingChanges,
    cleanupOldChanges,
};
