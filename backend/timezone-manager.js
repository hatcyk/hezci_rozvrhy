/**
 * Timezone Manager Module
 * Provides proper Prague timezone handling with DST support
 */

const { toZonedTime, formatInTimeZone } = require('date-fns-tz');

// Prague timezone constant
const PRAGUE_TIMEZONE = 'Europe/Prague';

/**
 * Get current time in Prague timezone with proper DST handling.
 * NOTE: the result is a "wall clock" Date - its local getters (getHours, ...)
 * read Prague time, but its toISOString() is NOT the real UTC instant. Use
 * new Date().toISOString() for timestamps.
 * @param {Date} [mockTime] - Optional mock time for testing (in UTC)
 * @returns {Date} Date object in Prague timezone
 */
function getPragueTime(mockTime = null) {
    const utcTime = mockTime || new Date();
    return toZonedTime(utcTime, PRAGUE_TIMEZONE);
}

/**
 * Offset of Europe/Prague from UTC at the given instant, in hours (1 or 2).
 * Computed from the tz database for Prague, not from the server's own zone:
 * the old getTimezoneOffset() on the zoned Date reported the server's offset,
 * so on Vercel/GitHub (UTC) isDST was always false.
 * @param {Date} [instant]
 * @returns {number}
 */
function getPragueUtcOffsetHours(instant = new Date()) {
    // Read from the formatted offset ("+02:00"): date-fns-tz 3.2.0
    // getTimezoneOffset() still reports the old offset for the first hour
    // after each switch (checked for 2026-03-29 01:00-02:00 UTC and
    // 2026-10-25 01:00-02:00 UTC), formatInTimeZone() gets it right.
    const [, sign, hh, mm] = formatInTimeZone(instant, PRAGUE_TIMEZONE, 'xxx').match(/^([+-])(\d{2}):(\d{2})$/);
    return (sign === '-' ? -1 : 1) * (Number(hh) + Number(mm) / 60);
}

/**
 * Prague wall-clock time as "yyyy-MM-dd HH:mm:ss" (for logs and API responses).
 * @param {Date} [instant]
 */
function formatPragueTime(instant = new Date(), pattern = 'yyyy-MM-dd HH:mm:ss') {
    return formatInTimeZone(instant, PRAGUE_TIMEZONE, pattern);
}

/**
 * Get comprehensive Prague time information
 * @param {Date} [mockTime] - Optional mock time for testing (in UTC)
 * @returns {Object} Time information object
 */
function getPragueTimeInfo(mockTime = null) {
    const instant = mockTime || new Date();
    const pragueTime = getPragueTime(instant);

    // Prague is UTC+1 in winter (CET) and UTC+2 in summer (CEST).
    const offsetHours = getPragueUtcOffsetHours(instant);
    const isDST = offsetHours === 2;

    // Wall-clock fields straight from the tz database, so they do not depend on
    // the server's own zone (a zoned Date's getters can be off by an hour when
    // the server zone has its own DST switch on a different date).
    const [hour, minute, second, isoWeekday] = formatPragueTime(instant, 'H m s i').split(' ').map(Number);
    const dayOfWeek = isoWeekday % 7; // 0=Sunday, 1=Monday, ..., 6=Saturday

    return {
        time: pragueTime,
        formatted: formatPragueTime(instant, 'yyyy-MM-dd HH:mm:ss'),
        formattedTime: formatPragueTime(instant, 'HH:mm:ss'),
        formattedDate: formatPragueTime(instant, 'yyyy-MM-dd'),
        hour,
        minute,
        second,
        dayOfWeek,
        dayIndex: dayOfWeek === 0 || dayOfWeek === 6 ? -1 : dayOfWeek - 1, // 0=Monday, 4=Friday, -1=weekend
        timeInMinutes: hour * 60 + minute,
        timezone: PRAGUE_TIMEZONE,
        utcOffset: offsetHours,
        isDST: isDST,
    };
}

/**
 * Check if given time is weekend
 * @param {Date} [mockTime] - Optional mock time for testing (in UTC)
 * @returns {Boolean} True if weekend
 */
function isWeekend(mockTime = null) {
    const timeInfo = getPragueTimeInfo(mockTime);
    return timeInfo.dayIndex === -1;
}

module.exports = {
    PRAGUE_TIMEZONE,
    getPragueTime,
    getPragueTimeInfo,
    getPragueUtcOffsetHours,
    formatPragueTime,
    isWeekend,
};
