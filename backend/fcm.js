/**
 * Firebase Cloud Messaging Module
 * Handles push notifications to users
 */

const admin = require('firebase-admin');
const { getFirestore, getMessaging } = require('./firebase-admin-init');
const { createChangeSummary, createDetailedChangeSummary, fitFcmDataPayload } = require('./change-detector');
const { matchesGroupFilters } = require('./bakalari-parser');

// FCM error codes that mean a token is permanently dead and should be pruned.
// 'messaging/invalid-argument' is NOT here: FCM returns it for a malformed
// *message* too ("signals an invalid registration only if the payload is
// completely valid", firebase.google.com/docs/cloud-messaging/manage-tokens),
// so one bad payload used to wipe the tokens of every recipient.
const DEAD_TOKEN_ERRORS = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token'
]);

/**
 * Tokens of a multicast that FCM reported as permanently invalid.
 * @param {Array<String>} tokens - Tokens used for the multicast (same order as responses)
 * @param {Object} sendResult - Result from sendNotificationToTokens (has .responses)
 * @returns {Array<String>}
 */
function findDeadTokens(tokens, sendResult) {
    const responses = sendResult && sendResult.responses;
    if (!responses || responses.length === 0) return [];
    const dead = [];
    responses.forEach((resp, idx) => {
        if (!resp.success && resp.error && DEAD_TOKEN_ERRORS.has(resp.error.code) && tokens[idx]) {
            dead.push(tokens[idx]);
        }
    });
    return dead;
}

/**
 * Remove FCM tokens that the API reported as permanently invalid from a user doc.
 * Keeps the user's token list clean so we don't keep sending to dead devices and
 * so success/failure counts stay meaningful.
 * @param {String} userId - User document ID
 * @param {Array<String>} tokens - Tokens used for the multicast (same order as responses)
 * @param {Object} sendResult - Result from sendNotificationToTokens (has .responses)
 * @returns {Promise<number>} Number of tokens pruned
 */
async function pruneInvalidTokens(userId, tokens, sendResult) {
    try {
        const deadTokens = findDeadTokens(tokens, sendResult);
        if (deadTokens.length === 0) return 0;

        const db = getFirestore();
        await db.collection('users').doc(userId).update({
            tokens: admin.firestore.FieldValue.arrayRemove(...deadTokens)
        });

        console.log(`🧽 [TOKENS] Pruned ${deadTokens.length} dead token(s) for user ${userId}`);
        return deadTokens.length;
    } catch (error) {
        console.error(`[TOKENS] Failed to prune invalid tokens for ${userId}:`, error.message);
        return 0;
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

        // FCM refuses a message whose payload is over 4096 B (the whole multicast
        // fails with messaging/invalid-argument). The detailed text is already
        // capped, but title + body + ids are not, so the final data object is
        // trimmed as a whole (detailedBody first, then body).
        const message = {
            data: fitFcmDataPayload({
                title: notification.title,
                body: notification.body,
                icon: notification.icon || '/icon-192.png',
                ...(notification.data || {})
            }),
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

// ───────────────────────────────────────────────────────────────────────────
// Watch index — denormalized fields so we can query watchers instead of scanning
// the whole users collection on every run.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Derive denormalized index fields from a watchedTimetables array.
 * - watchedKeys: ["Class_4A_Actual", ...] → query watchers with array-contains
 * - hasReminders: true if any watched timetable has a lesson reminder enabled
 * - watchedTypes: ["Class", "Room"] → the admin statistics count users per
 *   timetable type with count() (array-contains) instead of reading every user
 * @param {Array} watchedTimetables
 * @returns {{ watchedKeys: string[], hasReminders: boolean, watchedTypes: string[] }}
 */
function deriveWatchIndex(watchedTimetables) {
    const list = Array.isArray(watchedTimetables) ? watchedTimetables : [];
    const valid = list.filter(t => t && t.type && t.id && t.scheduleType);
    const watchedKeys = valid.map(t => `${t.type}_${t.id}_${t.scheduleType}`);
    const watchedTypes = [...new Set(valid.map(t => String(t.type)))].sort();
    const hasReminders = list.some(t => {
        const r = t && t.notificationTypes && t.notificationTypes.reminders;
        return !!(r && (r.next_lesson_room || r.next_lesson_teacher || r.next_lesson_subject));
    });
    return { watchedKeys, hasReminders, watchedTypes };
}

const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

let watchIndexMigrated = false;

/**
 * One-time backfill of the denormalized watch-index fields onto existing user
 * docs, so the indexed queries below are correct even for users created before
 * these fields existed. Tracked by a flag doc; after it's set this costs a single
 * doc read per process. Safe to call before every query.
 */
async function ensureWatchIndexMigrated() {
    if (watchIndexMigrated) return;

    const db = getFirestore();
    try {
        // V2 adds watchedTypes (admin statistics); V1 docs get it on this pass.
        const flagRef = db.collection('system').doc('migrations');
        const flag = await flagRef.get();
        if (flag.exists && flag.data().watchIndexV2) {
            watchIndexMigrated = true;
            return;
        }

        console.log('🔧 [MIGRATION] Backfilling watch index on user docs...');
        const usersSnap = await db.collection('users').get();
        let batch = db.batch();
        let ops = 0, updated = 0;

        for (const doc of usersSnap.docs) {
            const data = doc.data();
            const { watchedKeys, hasReminders, watchedTypes } = deriveWatchIndex(data.preferences && data.preferences.watchedTimetables);
            if (sameList(data.watchedKeys || [], watchedKeys) && data.hasReminders === hasReminders
                && sameList(data.watchedTypes, watchedTypes)) continue;

            batch.update(doc.ref, { watchedKeys, hasReminders, watchedTypes });
            ops++; updated++;
            if (ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; }
        }
        if (ops > 0) await batch.commit();

        await flagRef.set({ watchIndexV1: true, watchIndexV2: true, watchIndexAt: new Date().toISOString() }, { merge: true });
        watchIndexMigrated = true;
        console.log(`✅ [MIGRATION] Watch index backfilled (${updated} user docs updated)`);
    } catch (error) {
        // Don't set the flag — retry next run. Queries may miss un-migrated docs
        // until this succeeds, so log loudly but don't crash the job.
        console.error('[MIGRATION] Watch index backfill failed:', error.message);
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
        await ensureWatchIndexMigrated();

        // Query only users watching this timetable (indexed array-contains) instead
        // of scanning the whole collection. Fall back to a scan if the query fails.
        const watchKey = `${timetable.type}_${timetable.id}_${timetable.scheduleType}`;
        let usersSnapshot;
        try {
            usersSnapshot = await db.collection('users')
                .where('watchedKeys', 'array-contains', watchKey)
                .get();
        } catch (queryError) {
            console.warn('watchedKeys query failed, falling back to full scan:', queryError.message);
            usersSnapshot = await db.collection('users').get();
        }

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
// Detector change types that no switch of its own covers. 'type_change' is a
// lesson turning into cancelled/absent, which is what the "Odpadlé hodiny"
// switch means to the user - without this mapping those (the most important
// notifications there are) matched no preference and were silently dropped.
const PREFERENCE_KEY_BY_CHANGE_TYPE = {
    type_change: 'lesson_removed',
};

const DEFAULT_ENABLED_CHANGES = ['lesson_removed', 'substitution', 'room_change'];

function preferenceKeyForChange(changeType) {
    return PREFERENCE_KEY_BY_CHANGE_TYPE[changeType] || changeType;
}

function filterChangesByPreferences(changes, notificationTypes) {
    if (!notificationTypes || !notificationTypes.changes) {
        // No preferences set, send all change notifications (default behavior)
        return changes;
    }

    const userPrefs = notificationTypes.changes;

    return changes.filter(change => {
        const typeKey = preferenceKeyForChange(change.type);
        const isEnabled = userPrefs[typeKey];

        // Preference never stored (older user doc): fall back to the important ones.
        if (isEnabled === undefined) {
            return DEFAULT_ENABLED_CHANGES.includes(typeKey);
        }

        return isEnabled;
    });
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

        // Hodina bez skupiny / celá třída projde vždy, jinak porovnání normalizovaných skupin
        const passes = matchesGroupFilters(change.lesson.group, groupFilters);
        console.log(`[FILTER CHANGE] ${passes ? '✅ PASS' : '❌ FAIL'}: ${change.lesson.subject || change.type}, group: "${change.lesson.group || ''}"`);
        return passes;
    });
}

const SCHEDULE_TYPE_LABELS = { Actual: 'AKTUÁLNÍ', Next: 'PŘÍŠTÍ', Permanent: 'STÁLÝ' };

/**
 * Push payload for the changes of one timetable.
 * FCM data values must be strings. timetableType / timetableId / scheduleType
 * are what the service worker builds the notification tag from
 * ('change_' + type + '_' + id + '_' + scheduleType), so a newer change of one
 * timetable replaces its older notification but never another timetable's.
 * @param {{type: string, id: string, name: string, scheduleType: string}} timetable
 * @param {Array} filteredChanges - changes this user should hear about
 */
function buildChangeNotification(timetable, filteredChanges) {
    const summary = createChangeSummary(filteredChanges);
    const detailedSummary = createDetailedChangeSummary(filteredChanges);
    // Format schedule type in CAPSLOCK for title
    const scheduleTypeLabel = SCHEDULE_TYPE_LABELS[timetable.scheduleType] || String(timetable.scheduleType || '');
    const first = filteredChanges[0];

    return {
        title: `${timetable.name} ${scheduleTypeLabel}: Změny v rozvrhu`,
        body: summary,
        data: {
            type: 'timetable_change',
            timetableType: String(timetable.type),
            timetableId: String(timetable.id),
            scheduleType: String(timetable.scheduleType),
            changeCount: String(filteredChanges.length),
            // Day of the first change so the client can deep-link to it.
            day: String(first && first.day != null ? first.day : ''),
            timestamp: new Date().toISOString(),
            detailedBody: detailedSummary
        },
        icon: '/icon-192.png'
    };
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
            // Atomically claim this change document so concurrent runs (the every-5-min
            // workflow, the post-prefetch step and any in-process cron) can't all send
            // the same notification. Whoever flips sent:false→true wins; the rest skip.
            let changeData;
            try {
                changeData = await db.runTransaction(async (tx) => {
                    const fresh = await tx.get(changeDoc.ref);
                    if (!fresh.exists) return null;
                    const data = fresh.data();
                    if (data.sent) return null; // already claimed by another run
                    tx.update(changeDoc.ref, { sent: true, sentAt: new Date().toISOString() });
                    return data;
                });
            } catch (txError) {
                console.error(`Failed to claim change ${changeDoc.id}:`, txError.message);
                continue;
            }

            if (!changeData) {
                // Lost the race or doc vanished — another processor is handling it.
                continue;
            }

            const timetable = changeData.timetable;
            const changes = changeData.changes;

            // Get users watching this timetable
            const watchingUsers = await getUsersWatchingTimetable(timetable);

            if (watchingUsers.length === 0) {
                console.log(`⏭️  Skipping ${timetable.name} - no users watching`);
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

                    const notification = buildChangeNotification(timetable, filteredChanges);

                    const result = await sendNotificationToTokens(user.tokens, notification);
                    totalSent += result.successCount;

                    // Drop any tokens FCM reported as permanently invalid.
                    await pruneInvalidTokens(user.userId, user.tokens, result);
                } catch (error) {
                    console.error(`Failed to send to user ${user.userId}:`, error.message);
                }
            }

            // Record delivery stats (already marked sent during the claim above).
            await changeDoc.ref.update({
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

        // Old changes, filtered on a single field so Firestore's automatic
        // single-field index is enough. Combining sent == true with a range on
        // sentAt needs a composite index that was never created, so this whole
        // cleanup failed every night and the collection kept growing.
        const snapshot = await db.collection('changes')
            .where('sentAt', '<', cutoffISO)
            .get();

        const staleDocs = snapshot.docs.filter(doc => doc.data().sent === true);

        if (staleDocs.length === 0) {
            console.log(`   No old changes to clean up`);
            return { deleted: 0, errors: 0 };
        }

        console.log(`   Found ${staleDocs.length} old changes to delete`);

        // Delete in batches (Firestore batch limit is 500)
        const batchSize = 500;
        let totalDeleted = 0;
        let totalErrors = 0;

        for (let i = 0; i < staleDocs.length; i += batchSize) {
            const batch = db.batch();
            const batchDocs = staleDocs.slice(i, i + batchSize);

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
    DEAD_TOKEN_ERRORS,
    findDeadTokens,
    buildChangeNotification,
    filterChangesByPreferences,
    preferenceKeyForChange,
    sendNotificationToTokens,
    getUsersWatchingTimetable,
    processPendingChanges,
    cleanupOldChanges,
    pruneInvalidTokens,
    deriveWatchIndex,
    ensureWatchIndexMigrated,
};
