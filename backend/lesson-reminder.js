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
const { sendNotificationToTokens } = require('./fcm');
const { getPragueTime, getPragueTimeInfo, isWeekend } = require('./timezone-manager');
const { calculateNotificationWindows, findLessonsToNotify, formatMinutesToTime } = require('./schedule-calculator');
const { hasNotificationBeenSent, recordNotificationSent } = require('./notification-tracker');

// Lesson times (from /public/js/constants.js)
const lessonTimes = [
    { hour: 0, start: [7, 10], end: [7, 55], label: '7:10-7:55' },
    { hour: 1, start: [8, 0], end: [8, 45], label: '8:00-8:45' },
    { hour: 2, start: [8, 50], end: [9, 35], label: '8:50-9:35' },
    { hour: 3, start: [9, 45], end: [10, 30], label: '9:45-10:30' },
    { hour: 4, start: [10, 50], end: [11, 35], label: '10:50-11:35' },
    { hour: 5, start: [11, 40], end: [12, 25], label: '11:40-12:25' },
    { hour: 6, start: [12, 35], end: [13, 20], label: '12:35-13:20' },
    { hour: 7, start: [13, 25], end: [14, 10], label: '13:25-14:10' },
    { hour: 8, start: [14, 20], end: [15, 5], label: '14:20-15:05' },
    { hour: 9, start: [15, 10], end: [15, 55], label: '15:10-15:55' },
    { hour: 10, start: [16, 0], end: [16, 45], label: '16:00-16:45' },
    { hour: 11, start: [16, 50], end: [17, 35], label: '16:50-17:35' },
    { hour: 12, start: [17, 40], end: [18, 25], label: '17:40-18:25' }
];

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
        const usersSnapshot = await db.collection('users').get();

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
 * Get today's timetable data for a watched timetable
 * @param {Object} watchedTimetable - { type, id, scheduleType }
 * @param {Number} todayIndex - Day index (0-4)
 * @param {Map} cache - Cache for timetable data
 * @returns {Promise<Array>} Array of lessons for today
 */
async function getTodaysTimetableForUser(watchedTimetable, todayIndex, cache = null) {
    try {
        // Document key: Type_Id_Actual (use Actual for current schedule)
        const docKey = `${watchedTimetable.type}_${watchedTimetable.id}_Actual`;

        // Check cache first
        if (cache && cache.has(docKey)) {
            const cachedData = cache.get(docKey);
            return cachedData.filter(lesson => lesson.day === todayIndex);
        }

        const db = getFirestore();
        const timetableDoc = await db.collection('timetables').doc(docKey).get();

        if (!timetableDoc.exists) {
            if (cache) cache.set(docKey, []);
            return [];
        }

        const timetableData = timetableDoc.data();
        const allLessons = timetableData.data || [];

        // Store in cache
        if (cache) {
            cache.set(docKey, allLessons);
        }

        // Filter for today's lessons
        return allLessons.filter(lesson => lesson.day === todayIndex);

    } catch (error) {
        console.error(`❌ Failed to get timetable for ${watchedTimetable.type}/${watchedTimetable.id}:`, error.message);
        return [];
    }
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
 * Standardize group name to normalized format
 * @param {String} groupName - Raw group name from Bakalari
 * @returns {String} Standardized name (e.g., "1.sk", "2.sk", "celá")
 */
function standardizeGroupName(groupName) {
    if (!groupName) return '';

    const lower = groupName.toLowerCase().trim();

    // "celá třída"
    if (lower.includes('celá') || lower === 'cela') {
        return 'celá';
    }

    // Extract number: "1. sk", "skupina 1", "1.skupina" → "1.sk"
    const groupMatch = lower.match(/(\d+)[\.\s]*(?:skupina|sk)?|(?:skupina|sk)[\.\s]*(\d+)/);
    if (groupMatch) {
        const groupNum = groupMatch[1] || groupMatch[2];
        return `${groupNum}.sk`;
    }

    return groupName;
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
 * Main function: Check for upcoming lessons and send reminders
 * @param {Object} [options] - Optional parameters for testing
 * @param {Date} [options.mockTime] - Mock time for testing
 * @param {Boolean} [options.dryRun] - If true, don't actually send notifications
 * @returns {Promise<Object>} Result object
 */
async function sendLessonReminders(options = {}) {
    const { mockTime = null, dryRun = false } = options;

    try {
        // 1. Get Prague time and check basic conditions
        const timeInfo = getPragueTimeInfo(mockTime);

        console.log(`\n⏰ [INIT] Starting lesson reminder check`);
        console.log(`   Prague time: ${timeInfo.formatted} (UTC${timeInfo.isDST ? '+2' : '+1'}, DST: ${timeInfo.isDST})`);
        console.log(`   Day: ${timeInfo.dayOfWeek === 1 ? 'Monday' : timeInfo.dayOfWeek === 2 ? 'Tuesday' : timeInfo.dayOfWeek === 3 ? 'Wednesday' : timeInfo.dayOfWeek === 4 ? 'Thursday' : timeInfo.dayOfWeek === 5 ? 'Friday' : timeInfo.dayOfWeek === 6 ? 'Saturday' : 'Sunday'} (index: ${timeInfo.dayIndex})`);

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

        // Log lessons to notify
        lessonsToNotify.forEach(lesson => {
            console.log(`\n🔍 [WINDOW] Lesson hour ${lesson.hour} (${lesson.label})`);
            console.log(`   Window: ${lesson.windowStartFormatted} - ${lesson.windowEndFormatted}`);
            console.log(`   Target: ${lesson.targetTimeFormatted}`);
            console.log(`   Status: IN WINDOW ✅`);
        });

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

        // Cache for timetable data
        const timetableCache = new Map();

        const startTime = Date.now();

        for (const lessonWindow of lessonsToNotify) {
            console.log(`\n📚 [LESSON] Processing hour ${lessonWindow.hour} (${lessonWindow.label})`);

            for (const user of users) {
                try {
                    // Check if notification already sent (IDEMPOTENCY)
                    const alreadySent = await hasNotificationBeenSent(
                        user.userId,
                        timeInfo.formattedDate,
                        lessonWindow.hour
                    );

                    if (alreadySent) {
                        console.log(`🔐 [DEDUP] User ${user.userId} / hour ${lessonWindow.hour} - already sent, skipping`);
                        totalSkipped++;
                        continue;
                    }

                    console.log(`🔐 [DEDUP] User ${user.userId} / hour ${lessonWindow.hour} - not sent yet`);

                    // Get user's lessons for this hour
                    let userHasLesson = false;
                    const userLessons = [];

                    for (const watchedTimetable of user.watchedTimetables) {
                        const todaysLessons = await getTodaysTimetableForUser(
                            watchedTimetable,
                            timeInfo.dayIndex,
                            timetableCache
                        );
                        const lessonsInSlot = findLessonInSlot(todaysLessons, lessonWindow.hour);

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

                        const groupFilteredLessons = validLessons.filter(lesson => {
                            // Empty array or "all" - show all
                            if (groupFilters.length === 0 || groupFilters.includes('all')) {
                                return true;
                            }

                            // Lesson without group - show always (whole class)
                            const hasNoGroup = !lesson.group ||
                                (typeof lesson.group === 'string' && lesson.group.trim() === '');

                            if (hasNoGroup) {
                                return true;
                            }

                            // Compare standardized groups
                            const standardizedLessonGroup = standardizeGroupName(lesson.group);
                            return groupFilters.includes(standardizedLessonGroup);
                        });

                        // Filter out "Dívčí tělocvik" lessons
                        const filteredLessons = groupFilteredLessons.filter(lesson =>
                            !lesson.subject || !lesson.subject.toLowerCase().includes('dívčí tělocvik')
                        );

                        if (filteredLessons.length > 0) {
                            userHasLesson = true;
                            userLessons.push(...filteredLessons);
                        }
                    }

                    if (!userHasLesson || userLessons.length === 0) {
                        console.log(`   ⏭️  User ${user.userId} has no lesson in hour ${lessonWindow.hour}`);
                        continue;
                    }

                    // Send notification for first lesson (if multiple, they're usually the same subject)
                    const lesson = userLessons[0];

                    console.log(`📚 [TIMETABLE] User ${user.userId} has lesson: ${lesson.subject}`);
                    console.log(`   Room: ${lesson.room}, Teacher: ${lesson.teacher}`);

                    const notification = formatLessonNotification(
                        lesson,
                        lessonWindow.lessonStartFormatted,
                        lessonWindow.minutesUntilLesson
                    );

                    if (!dryRun) {
                        const result = await sendNotificationToTokens(user.tokens, notification);
                        totalSent += result.successCount;

                        console.log(`📨 [SEND] Sent to user ${user.userId}: ${notification.title}`);
                        console.log(`   Tokens: ${user.tokens.length}, Success: ${result.successCount}`);

                        // Record notification as sent
                        await recordNotificationSent(
                            user.userId,
                            timeInfo.formattedDate,
                            lessonWindow.hour,
                            {
                                lessonStartTime: lessonWindow.lessonStartFormatted,
                                timetableId: `${user.watchedTimetables[0].type}_${user.watchedTimetables[0].id}_Actual`,
                                lessonDetails: {
                                    subject: lesson.subject,
                                    room: lesson.room,
                                    teacher: lesson.teacher
                                },
                                cronExecutionTime: new Date().toISOString(),
                                pragueTime: timeInfo.formattedTime
                            }
                        );
                    } else {
                        console.log(`🔍 [DRY RUN] Would send to user ${user.userId}: ${notification.title}`);
                        totalSent++;
                    }

                    totalUsers++;

                } catch (error) {
                    console.error(`❌ [ERROR] Failed to send reminder to user ${user.userId}:`, error.message);
                    // Continue with other users
                }
            }
        }

        const duration = Date.now() - startTime;

        console.log(`\n✅ [DONE] Summary`);
        console.log(`   Total notifications sent: ${totalSent}`);
        console.log(`   Total users notified: ${totalUsers}`);
        console.log(`   Total skipped (already sent): ${totalSkipped}`);
        console.log(`   Lessons processed: ${lessonsToNotify.length} (hours: ${lessonsToNotify.map(l => l.hour).join(', ')})`);
        console.log(`   Duration: ${duration}ms\n`);

        return {
            sent: totalSent,
            users: totalUsers,
            skipped: totalSkipped,
            lessons: lessonsToNotify.map(l => l.hour),
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
    getPragueTimeInfo, // Re-export for compatibility
    lessonTimes
};
