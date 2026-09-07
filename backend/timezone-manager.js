/**
 * Timezone Manager Module
 * Provides proper Prague timezone handling with DST support
 */

const { toZonedTime, format } = require('date-fns-tz');

// Prague timezone constant
const PRAGUE_TIMEZONE = 'Europe/Prague';

/**
 * Get current time in Prague timezone with proper DST handling
 * @param {Date} [mockTime] - Optional mock time for testing (in UTC)
 * @returns {Date} Date object in Prague timezone
 */
function getPragueTime(mockTime = null) {
    const utcTime = mockTime || new Date();
    return toZonedTime(utcTime, PRAGUE_TIMEZONE);
}

/**
 * Get comprehensive Prague time information
 * @param {Date} [mockTime] - Optional mock time for testing (in UTC)
 * @returns {Object} Time information object
 */
function getPragueTimeInfo(mockTime = null) {
    const pragueTime = getPragueTime(mockTime);

    // Get offset to determine if DST is active
    // Prague is UTC+1 in winter, UTC+2 in summer
    const offsetMinutes = pragueTime.getTimezoneOffset();
    const offsetHours = -offsetMinutes / 60; // Negative because getTimezoneOffset returns negative for east of UTC
    const isDST = offsetHours === 2; // DST when offset is +2

    return {
        time: pragueTime,
        formatted: format(pragueTime, 'yyyy-MM-dd HH:mm:ss', { timeZone: PRAGUE_TIMEZONE }),
        formattedTime: format(pragueTime, 'HH:mm:ss', { timeZone: PRAGUE_TIMEZONE }),
        formattedDate: format(pragueTime, 'yyyy-MM-dd', { timeZone: PRAGUE_TIMEZONE }),
        hour: pragueTime.getHours(),
        minute: pragueTime.getMinutes(),
        second: pragueTime.getSeconds(),
        dayOfWeek: pragueTime.getDay(), // 0=Sunday, 1=Monday, ..., 6=Saturday
        dayIndex: pragueTime.getDay() === 0 || pragueTime.getDay() === 6 ? -1 : pragueTime.getDay() - 1, // 0=Monday, 4=Friday, -1=weekend
        timeInMinutes: pragueTime.getHours() * 60 + pragueTime.getMinutes(),
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
    getPragueTime,
    getPragueTimeInfo,
    isWeekend,
};
