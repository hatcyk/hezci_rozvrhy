/**
 * Lesson Reminder Module
 * Sends notifications to users 5 minutes before their lessons start
 *
 * NEW IMPLEMENTATION (2025-12-05):
 * - Proper Prague timezone with DST support
 * - Wide notification window (15 min to 1 min before lesson)
 * - Firestore-based deduplication
 * - Simple, reliable logic
 */

const { getFirestore } = require('./firebase-admin-init');
const { sendNotificationToTokens, pruneInvalidTokens, ensureWatchIndexMigrated } = require('./fcm');
const { getPragueTime, getPragueTimeInfo, isWeekend } = require('./timezone-manager');
const { calculateNotificationWindows, findLessonsToNotify, getNotificationConfig, intFromEnv } = require('./schedule-calculator');
const { claimReminder, finishReminder } = require('./notification-tracker');
const { matchesGroupFilters } = require('./bakalari-parser');

// Lesson times (same table as /public/js/constants.js), shared with the iCal export.
const { lessonTimes } = require('./lesson-times');

// Subject abbreviations (from /public/js/constants.js - key ones)
const subjectAbbreviations = {
    'Informační a komunikační technologie': 'IKT',
    'Programové vybavení': 'PV',
    'Databázové systémy': 'DBS',
    'Programování': 'PRG',
    'Hardware': 'HW',
    'Operační systémy': 'OS',
    'Kybernetická bezpečnost': 'KBS',
    'Datové sítě': 'DTS',
    'Počítačové sítě a síťová zařízení': 'PSZ',
    'Grafická tvorba': 'GTV',
    'CAD systémy': 'CAD',
    'Webové aplikace': 'WA',
    'Mobilní aplikace': 'MA',
    'Telekomunikace a sítě': 'TKS',
    'Elektrická měření': 'EM',
    'Elektronika': 'ELN',
    'Elektrotechnika': 'ELT',
    'Základy elektrotechniky': 'ZEL',
    'Automatizace': 'AUT',
    'Mikroprocesorová technika': 'MPT',
    'Digitální technika': 'DT',
    'Číslicová technika': 'ČT',
    'Tělesná výchova': 'TV',
    'Matematika': 'MAT',
    'Anglický jazyk': 'AJ',
    'Německý jazyk': 'NJ',
    'Český jazyk a literatura': 'ČJ',
    'Občanská nauka': 'OBN',
    'Základy práva': 'ZP',
    'Dějepis': 'DEJ',
    'Fyzika': 'FYZ',
    'Chemie': 'CHE',
    'Biologie': 'BIO',
    'Biologie, ekologie a chemie': 'BECH',
    'Ekologie a chemie': 'ECH',
    'Ekologie': 'EKOL',
    'Zeměpis': 'ZEM',
    'Virtualizace': 'VIR',
    'Webdesign': 'WD',
    'Třídnická hodina': 'TH',
    'Ekonomika': 'EKO',
    'Ekonomika a finance': 'EF',
    'Ekonomika dopravy': 'ED',
    'Účetnictví': 'ÚČE',
    'Účetnictví na počítači': 'ÚNP',
    'Daně': 'DAN',
    'Obchodní psychologie': 'OP',
    'Praxe': 'PRX',
    'Učební praxe': 'UP',
    'Technické kreslení': 'TK',
    'Technická dokumentace': 'TD',
    'Technologie': 'TCH',
    'Strojnictví': 'STR',
    'Konstruování': 'KON',
    'Logistika': 'LOG',
    'Logistika a zasilatelství': 'LZ',
    'Doprava a přeprava': 'DP',
    'Dopravní zeměpis': 'DZ',
    'Dopravní telematika': 'DTel',
    'Dějiny dopravy': 'DD',
    'Moderní trendy v dopravě': 'MTD',
    'Městská a regionální hromadná doprava': 'MRHD',
    'Zabezpečovací systémy': 'ZS',
    'Úvod do automatizace': 'ÚA',
    'Bezpečnost v digitálním prostředí': 'BDP',
    'Konverzace v anglickém jazyce': 'Konv. AJ',
    'Seminář z matematiky': 'Sem. MAT',
    'Seminář z fyziky': 'Sem. FYZ',
    'Seminář k profilové maturitě': 'Sem. PM',
    'Seminář k maturitní zkoušce': 'Sem. MZ',
    'Projektování': 'PRJ',
    'Maturitní projekt': 'MP',
    'Sociální a profesní komunikace': 'SPK'
};

/**
 * Abbreviate subject name
 * @param {String} subjectName - Full subject name
 * @returns {String} Abbreviated name
 */
function abbreviateSubject(subjectName) {
    if (!subjectName) return '';

    // Check if there's a direct mapping
    if (subjectAbbreviations[subjectName]) {
        return subjectAbbreviations[subjectName];
    }

    // If subject name is longer than 20 characters, try to shorten it
    if (subjectName.length > 20) {
        // Try to extract acronym from capital letters
        const capitals = subjectName.match(/[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g);
        if (capitals && capitals.length > 1) {
            return capitals.join('');
        }
        // Otherwise truncate with ellipsis
        return subjectName.substring(0, 18) + '...';
    }

    return subjectName;
}

/**
 * Get all users who have lesson reminders enabled
 * @returns {Promise<Array>} Array of { userId, tokens, watchedTimetables }
 */
async function getUsersWithLessonReminders() {
    try {
        const db = getFirestore();
        await ensureWatchIndexMigrated();

        // Only fetch users who have at least one lesson reminder enabled (indexed),
        // instead of scanning the whole users collection every minute.
        let usersSnapshot;
        try {
            usersSnapshot = await db.collection('users').where('hasReminders', '==', true).get();
        } catch (queryError) {
            console.warn('hasReminders query failed, falling back to full scan:', queryError.message);
            usersSnapshot = await db.collection('users').get();
        }

        const usersWithReminders = [];

        usersSnapshot.forEach(userDoc => {
            const userData = userDoc.data();
            const preferences = userData.preferences;
            const userId = userDoc.id;

            // Check if user has any lesson reminders enabled in any watched timetable
            const watchedTimetables = preferences?.watchedTimetables || [];
            const hasAnyReminders = watchedTimetables.some(timetable => {
                const reminders = timetable.notificationTypes?.reminders || {};
                return reminders.next_lesson_room || reminders.next_lesson_teacher || reminders.next_lesson_subject;
            });

            if (hasAnyReminders && userData.tokens && userData.tokens.length > 0) {
                usersWithReminders.push({
                    userId: userDoc.id,
                    tokens: userData.tokens,
                    watchedTimetables: watchedTimetables
                });
            }
        });

        return usersWithReminders;

    } catch (error) {
        console.error('❌ [ERROR] Failed to get users with lesson reminders:', error.message);
        throw error;
    }
}

/**
 * Is `dayIndex` (on `todayDate`, 'YYYY-MM-DD') a day off in a snapshot's `daysOff`
 * ({day, date, name} entries written by prefetch)? An entry with a date only
 * counts on that date, so last week's holiday in a not-yet-switched "Actual"
 * snapshot does not silence this week's lessons.
 */
function isDayOff(daysOff, dayIndex, todayDate = null) {
    return (Array.isArray(daysOff) ? daysOff : []).some(entry => entry
        && entry.day === dayIndex
        && (!entry.date || !todayDate || entry.date === todayDate));
}

/**
 * Get today's timetable data for a watched timetable
 * @param {Object} watchedTimetable - { type, id, scheduleType }
 * @param {Number} todayIndex - Day index (0-4)
 * @param {Map} cache - Cache for timetable data
 * @param {String|null} [todayDate] - 'YYYY-MM-DD' (Prague) for the day-off check
 * @returns {Promise<Array>} Array of lessons for today ([] on a day off)
 */
async function getTodaysTimetableForUser(watchedTimetable, todayIndex, cache = null, todayDate = null) {
    // Document key: Type_Id_Actual (use Actual for current schedule)
    const docKey = `${watchedTimetable.type}_${watchedTimetable.id}_Actual`;

    // The cache holds the pending read, so users processed in parallel that
    // watch the same timetable share one Firestore read.
    let snapshotPromise = cache && cache.get(docKey);
    if (!snapshotPromise) {
        snapshotPromise = (async () => {
            try {
                const db = getFirestore();
                const timetableDoc = await db.collection('timetables').doc(docKey).get();
                if (!timetableDoc.exists) return { lessons: [], daysOff: [] };
                const data = timetableDoc.data();
                return { lessons: data.data || [], daysOff: data.daysOff || [] };
            } catch (error) {
                console.error(`❌ Failed to get timetable for ${watchedTimetable.type}/${watchedTimetable.id}:`, error.message);
                return { lessons: [], daysOff: [] };
            }
        })();
        if (cache) cache.set(docKey, snapshotPromise);
    }

    const { lessons, daysOff } = await snapshotPromise;
    // Holidays / "ředitelské volno": no reminders, whatever lessons the
    // snapshot may still hold for that day.
    if (isDayOff(daysOff, todayIndex, todayDate)) return [];
    return lessons.filter(lesson => lesson.day === todayIndex);
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 * Users used to be processed one by one; with tens of users the HTTP run took
 * longer than cron-job.org's 30 s timeout.
 */
async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(runners);
    return results;
}

/**
 * Find lesson(s) in specific hour slot
 * @param {Array} lessons - Array of lessons
 * @param {Number} hourSlot - Hour slot number (0-12)
 * @returns {Array} Lessons in this slot (may be multiple for group divisions)
 */
function findLessonInSlot(lessons, hourSlot) {
    return lessons.filter(lesson => lesson.hour === hourSlot);
}

/**
 * Get correct Czech plural form for minutes
 * @param {Number} minutes - Number of minutes
 * @returns {String} Correct Czech word (minuta/minuty/minut)
 */
function getCzechMinutePlural(minutes) {
    if (minutes === 0) return 'minut';        // 0 minut
    if (minutes === 1) return 'minuta';       // 1 minuta
    if (minutes >= 2 && minutes <= 4) return 'minuty';  // 2-4 minuty
    return 'minut';                           // 5+ minut
}

/**
 * Format lesson notification
 * @param {Object} lesson - Lesson data
 * @param {String} startTime - Start time label (e.g., "8:00")
 * @param {Number} minutesUntilLesson - Actual minutes until lesson starts
 * @returns {Object} { title, body, data }
 */
function formatLessonNotification(lesson, startTime, minutesUntilLesson) {
    const subjectAbbr = abbreviateSubject(lesson.subject);
    const room = lesson.room || '?';
    const teacher = lesson.teacher || '?';

    // Calculate time text with proper Czech plural
    let timeText;
    if (minutesUntilLesson <= 0) {
        timeText = 'Právě začíná';  // Starting now
    } else {
        const pluralForm = getCzechMinutePlural(minutesUntilLesson);
        timeText = `Za ${minutesUntilLesson} ${pluralForm}`;
    }

    const title = `${timeText}: ${subjectAbbr}`;
    const body = `${room} • ${subjectAbbr} • ${teacher}`;

    return {
        title,
        body,
        data: {
            type: 'lesson_reminder',
            subject: lesson.subject,
            teacher: lesson.teacher,
            room: room,
            startTime: startTime,
            minutesUntilLesson: minutesUntilLesson.toString(),
            timestamp: new Date().toISOString()
        }
    };
}

/**
 * Lessons of one user in one hour slot, across all their watched timetables,
 * after removing cancelled lessons, other groups and girls' PE.
 * @returns {Promise<Array<{lesson: Object, source: Object}>>}
 */
async function findUserLessonsInSlot(user, dayIndex, hour, timetableCache, todayDate = null) {
    const userLessons = [];

    for (const watchedTimetable of user.watchedTimetables) {
        const todaysLessons = await getTodaysTimetableForUser(watchedTimetable, dayIndex, timetableCache, todayDate);
        // Lessons carry their date since S2. When the stored "Actual" week is
        // not this week yet (prefetch late on a Monday morning), day index 0
        // would otherwise remind about last Monday's lessons. Lessons without
        // a date (older snapshots) keep the old day-index behaviour.
        const lessonsInSlot = findLessonInSlot(todaysLessons, hour)
            .filter(lesson => !todayDate || lesson.date == null || lesson.date === todayDate);

        // Filter out removed/cancelled lessons
        const validLessons = lessonsInSlot.filter(lesson =>
            lesson.type !== 'removed' && lesson.subject && lesson.subject.trim() !== ''
        );

        // Filter by group preferences
        let groupFilters = watchedTimetable.groupFilters;
        if (!groupFilters && watchedTimetable.groupFilter) {
            groupFilters = [watchedTimetable.groupFilter];
        } else if (!groupFilters) {
            groupFilters = [];
        }

        // Whole-class lessons always pass; group lessons must match the
        // user's (normalized) group filters.
        const groupFilteredLessons = validLessons.filter(lesson =>
            matchesGroupFilters(lesson.group, groupFilters)
        );

        // Filter out "Dívčí tělocvik" lessons
        const filteredLessons = groupFilteredLessons.filter(lesson =>
            !lesson.subject || !lesson.subject.toLowerCase().includes('dívčí tělocvik')
        );

        // Each entry keeps the timetable it came from so the dedup record names
        // the right source (it used to always point at watchedTimetables[0]).
        filteredLessons.forEach(lesson => userLessons.push({ lesson, source: watchedTimetable }));
    }

    return userLessons;
}

/**
 * Main function: Check for upcoming lessons and send reminders
 * @param {Object} [options] - Optional parameters for testing
 * @param {Date} [options.mockTime] - Mock time for testing
 * @param {Boolean} [options.dryRun] - If true, don't actually send notifications
 * @returns {Promise<Object>} Result object
 */
async function sendLessonReminders(options = {}) {
    const { mockTime = null, dryRun = false } = options;

    try {
        // The flag used to be read into the config and then ignored.
        if (!getNotificationConfig().enabled) {
            console.log('⏭️  Lesson reminders disabled (LESSON_REMINDER_ENABLED)');
            return { sent: 0, reason: 'disabled' };
        }

        // 1. Get Prague time and check basic conditions
        const timeInfo = getPragueTimeInfo(mockTime);

        console.log(`\n⏰ [INIT] Starting lesson reminder check`);
        console.log(`   Prague time: ${timeInfo.formatted} (UTC+${timeInfo.utcOffset}, DST: ${timeInfo.isDST})`);
        console.log(`   Day index: ${timeInfo.dayIndex} (0 = Monday, -1 = weekend)`);

        // Check if weekend
        if (isWeekend(mockTime)) {
            console.log(`⏭️  Weekend - no lessons`);
            return { sent: 0, reason: 'weekend' };
        }

        // 2. Calculate notification windows for all lessons
        const windows = calculateNotificationWindows(timeInfo.timeInMinutes, lessonTimes);
        const lessonsToNotify = findLessonsToNotify(windows);

        console.log(`\n📅 [SCHEDULE] Calculated ${windows.length} lesson windows`);
        console.log(`   Lessons in notification window: ${lessonsToNotify.length}`);

        if (lessonsToNotify.length === 0) {
            // Log next upcoming lesson for debugging
            const nextLesson = windows.find(w => w.minutesUntilLesson > 0);
            if (nextLesson) {
                console.log(`   Next lesson: Hour ${nextLesson.hour} at ${nextLesson.lessonStartFormatted} (in ${nextLesson.minutesUntilLesson} min)`);
                console.log(`   Notification window: ${nextLesson.windowStartFormatted} - ${nextLesson.windowEndFormatted}`);
            }
            return { sent: 0, reason: 'no_lessons_in_window' };
        }

        // 3. Get all users with lesson reminders enabled
        const users = await getUsersWithLessonReminders();

        if (users.length === 0) {
            console.log(`\n⏭️  No users with lesson reminders enabled`);
            return { sent: 0, reason: 'no_users' };
        }

        console.log(`\n👥 [USERS] Found ${users.length} users with lesson reminders enabled`);

        // 4. For each lesson in notification window, send reminders to users
        let totalSent = 0;
        let totalUsers = 0;
        let totalSkipped = 0;
        let totalFailed = 0;

        const timetableCache = new Map();
        const concurrency = intFromEnv('LESSON_REMINDER_CONCURRENCY', 10) || 1;
        const startTime = Date.now();

        for (const lessonWindow of lessonsToNotify) {
            console.log(`\n📚 [LESSON] Processing hour ${lessonWindow.hour} (${lessonWindow.label})`);

            await mapWithConcurrency(users, concurrency, async (user) => {
                try {
                    const userLessons = await findUserLessonsInSlot(user, timeInfo.dayIndex, lessonWindow.hour, timetableCache, timeInfo.formattedDate);
                    if (userLessons.length === 0) return;

                    // Send notification for first lesson (if multiple, they're usually the same subject)
                    const { lesson, source: lessonSource } = userLessons[0];
                    const notification = formatLessonNotification(
                        lesson,
                        lessonWindow.lessonStartFormatted,
                        lessonWindow.minutesUntilLesson
                    );

                    if (dryRun) {
                        console.log(`🔍 [DRY RUN] Would send to user ${user.userId}: ${notification.title}`);
                        totalSent++;
                        totalUsers++;
                        return;
                    }

                    // Claim first (atomic create), send only if this run won it.
                    // Done after the timetable lookup (served from the in-run
                    // cache) so users without a lesson cost no Firestore write.
                    const claimed = await claimReminder(user.userId, timeInfo.formattedDate, lessonWindow.hour, {
                        lessonStartTime: lessonWindow.lessonStartFormatted,
                        timetableId: `${lessonSource.type}_${lessonSource.id}_Actual`,
                        lessonDetails: {
                            subject: lesson.subject,
                            room: lesson.room,
                            teacher: lesson.teacher
                        },
                        cronExecutionTime: new Date().toISOString(),
                        pragueTime: timeInfo.formattedTime
                    });
                    if (!claimed) {
                        totalSkipped++;
                        return;
                    }

                    try {
                        const result = await sendNotificationToTokens(user.tokens, notification);
                        totalSent += result.successCount;
                        totalUsers++;
                        console.log(`📨 [SEND] User ${user.userId}: ${notification.title} (${result.successCount}/${user.tokens.length})`);

                        // Drop any tokens FCM reported as permanently invalid.
                        await pruneInvalidTokens(user.userId, user.tokens, result);
                        await finishReminder(user.userId, timeInfo.formattedDate, lessonWindow.hour, {
                            status: result.successCount > 0 ? 'sent' : 'failed',
                            successCount: result.successCount
                        });
                    } catch (sendError) {
                        totalFailed++;
                        await finishReminder(user.userId, timeInfo.formattedDate, lessonWindow.hour, {
                            status: 'failed',
                            error: sendError.message
                        });
                        throw sendError;
                    }
                } catch (error) {
                    console.error(`❌ [ERROR] Failed to send reminder to user ${user.userId}:`, error.message);
                    // Continue with other users
                }
            });
        }

        const duration = Date.now() - startTime;

        console.log(`\n✅ [DONE] sent ${totalSent}, users ${totalUsers}, skipped ${totalSkipped}, failed ${totalFailed}, ` +
            `hours ${lessonsToNotify.map(l => l.hour).join(', ')}, ${duration}ms\n`);

        return {
            sent: totalSent,
            users: totalUsers,
            skipped: totalSkipped,
            failed: totalFailed,
            lessons: lessonsToNotify.map(l => l.hour),
            durationMs: duration,
            dryRun: dryRun
        };

    } catch (error) {
        console.error('❌ [ERROR] Failed to send lesson reminders:', error.message);
        console.error(error.stack);
        throw error;
    }
}

module.exports = {
    sendLessonReminders,
    getPragueTime,
    lessonTimes,
    mapWithConcurrency,
    isDayOff,
    getTodaysTimetableForUser,
};
