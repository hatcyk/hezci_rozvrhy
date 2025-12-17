/**
 * Schedule Calculator Module
 * Calculates notification windows for lessons
 */

/**
 * Get notification configuration from environment or defaults
 * @returns {Object} Configuration object
 */
function getNotificationConfig() {
    return {
        // Target notification time (minutes before lesson starts)
        minutesBefore: parseInt(process.env.LESSON_REMINDER_MINUTES_BEFORE) || 5,

        // Window start (how early can we send? minutes before lesson)
        windowStartMinutes: parseInt(process.env.LESSON_REMINDER_WINDOW_START) || 15,

        // Window end (how late can we send? minutes before lesson)
        windowEndMinutes: parseInt(process.env.LESSON_REMINDER_WINDOW_END) || 1,

        // Feature flag
        enabled: process.env.LESSON_REMINDER_ENABLED !== 'false',

        // Debug mode
        debug: process.env.LESSON_REMINDER_DEBUG === 'true'
    };
}

/**
 * Calculate notification window for a single lesson
 * @param {Object} lesson - Lesson object with { hour, start: [h, m], end: [h, m], label }
 * @param {Number} currentTimeInMinutes - Current time in minutes since midnight
 * @param {Object} config - Notification configuration
 * @returns {Object} Window information
 */
function calculateLessonWindow(lesson, currentTimeInMinutes, config) {
    const [startH, startM] = lesson.start;
    const lessonStartInMinutes = startH * 60 + startM;

    // Calculate window boundaries
    const windowStart = lessonStartInMinutes - config.windowStartMinutes; // e.g., 8:00 - 15 min = 7:45
    const windowEnd = lessonStartInMinutes - config.windowEndMinutes;     // e.g., 8:00 - 1 min = 7:59
    const targetTime = lessonStartInMinutes - config.minutesBefore;        // e.g., 8:00 - 5 min = 7:55

    // Check if current time is in window
    const inWindow = currentTimeInMinutes >= windowStart && currentTimeInMinutes <= windowEnd;

    // Calculate minutes until lesson starts
    const minutesUntilLesson = lessonStartInMinutes - currentTimeInMinutes;

    // Determine status
    let status;
    if (currentTimeInMinutes < windowStart) {
        status = 'too_early';
    } else if (currentTimeInMinutes > windowEnd) {
        status = 'too_late';
    } else {
        status = 'in_window';
    }

    return {
        hour: lesson.hour,
        label: lesson.label,
        lessonStart: lessonStartInMinutes,
        lessonStartFormatted: `${startH.toString().padStart(2, '0')}:${startM.toString().padStart(2, '0')}`,
        windowStart: windowStart,
        windowEnd: windowEnd,
        targetTime: targetTime,
        windowStartFormatted: formatMinutesToTime(windowStart),
        windowEndFormatted: formatMinutesToTime(windowEnd),
        targetTimeFormatted: formatMinutesToTime(targetTime),
        inWindow: inWindow,
        status: status,
        minutesUntilLesson: minutesUntilLesson
    };
}

/**
 * Calculate notification windows for all lessons
 * @param {Number} currentTimeInMinutes - Current time in minutes since midnight
 * @param {Array} lessonTimes - Array of lesson time objects
 * @param {Object} [customConfig] - Optional custom configuration
 * @returns {Array} Array of window objects
 */
function calculateNotificationWindows(currentTimeInMinutes, lessonTimes, customConfig = null) {
    const config = customConfig || getNotificationConfig();

    return lessonTimes.map(lesson =>
        calculateLessonWindow(lesson, currentTimeInMinutes, config)
    );
}

/**
 * Find lessons that need notifications right now
 * @param {Array} windows - Array of window objects from calculateNotificationWindows
 * @returns {Array} Filtered array of lessons in notification window
 */
function findLessonsToNotify(windows) {
    return windows.filter(window => window.inWindow);
}

/**
 * Format minutes since midnight to HH:MM string
 * @param {Number} minutes - Minutes since midnight
 * @returns {String} Formatted time (HH:MM)
 */
function formatMinutesToTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Get detailed status for debugging
 * @param {Number} currentTimeInMinutes - Current time in minutes since midnight
 * @param {Array} lessonTimes - Array of lesson time objects
 * @param {Object} [customConfig] - Optional custom configuration
 * @returns {Object} Detailed status object
 */
function getScheduleStatus(currentTimeInMinutes, lessonTimes, customConfig = null) {
    const config = customConfig || getNotificationConfig();
    const windows = calculateNotificationWindows(currentTimeInMinutes, lessonTimes, config);
    const toNotify = findLessonsToNotify(windows);

    return {
        currentTime: formatMinutesToTime(currentTimeInMinutes),
        currentTimeInMinutes: currentTimeInMinutes,
        config: config,
        totalLessons: lessonTimes.length,
        windows: windows,
        lessonsInWindow: toNotify,
        lessonsToNotifyCount: toNotify.length,
        nextLesson: windows.find(w => w.minutesUntilLesson > 0) || null
    };
}

module.exports = {
    getNotificationConfig,
    calculateLessonWindow,
    calculateNotificationWindows,
    findLessonsToNotify,
    formatMinutesToTime,
    getScheduleStatus
};
