/**
 * Request body validation shared by the user routes.
 *
 * Everything here ends up in the user's Firestore document and is read back by
 * the notification jobs, so malformed input is rejected before it is stored
 * (the 50 kB express.json limit only caps the size, not the shape).
 */

const TIMETABLE_TYPES = new Set(['Class', 'Teacher', 'Room']);
const SCHEDULE_TYPES = new Set(['Actual', 'Next', 'Permanent']);

const MAX_WATCHED = 200;     // 3 schedule types × all timetables a person plausibly follows
const MAX_FAVORITES = 50;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 200;
const MAX_GROUP_FILTERS = 30;
const MAX_FCM_TOKEN_LENGTH = 4096;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isShortString = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;

function validateFcmToken(token) {
    if (!isShortString(token, MAX_FCM_TOKEN_LENGTH)) return 'token must be a non-empty string';
    return null;
}

function validateWatchedTimetables(list) {
    if (!Array.isArray(list)) return 'watchedTimetables must be an array';
    if (list.length > MAX_WATCHED) return `Too many watched timetables (max ${MAX_WATCHED})`;
    for (const item of list) {
        if (!isPlainObject(item)) return 'Invalid watchedTimetables item';
        if (!TIMETABLE_TYPES.has(item.type)) return 'Invalid watchedTimetables item type';
        if (!isShortString(item.id, MAX_ID_LENGTH)) return 'Invalid watchedTimetables item id';
        if (!SCHEDULE_TYPES.has(item.scheduleType)) return 'Invalid watchedTimetables item scheduleType';
        if (item.name !== undefined && item.name !== null && (typeof item.name !== 'string' || item.name.length > MAX_NAME_LENGTH)) {
            return 'Invalid watchedTimetables item name';
        }
        if (item.groupFilters !== undefined && item.groupFilters !== null) {
            if (!Array.isArray(item.groupFilters) || item.groupFilters.length > MAX_GROUP_FILTERS ||
                !item.groupFilters.every(g => typeof g === 'string' && g.length <= MAX_ID_LENGTH)) {
                return 'Invalid watchedTimetables item groupFilters';
            }
        }
        if (item.notificationTypes !== undefined && item.notificationTypes !== null && !isPlainObject(item.notificationTypes)) {
            return 'Invalid watchedTimetables item notificationTypes';
        }
    }
    return null;
}

function validateFavorites(list) {
    if (!Array.isArray(list)) return 'favoriteTimetables must be an array';
    if (list.length > MAX_FAVORITES) return `Too many favorites (max ${MAX_FAVORITES})`;
    for (const item of list) {
        if (!isPlainObject(item) || !TIMETABLE_TYPES.has(item.type) || !isShortString(item.id, MAX_ID_LENGTH)) {
            return 'Invalid favoriteTimetables item format';
        }
    }
    return null;
}

module.exports = {
    TIMETABLE_TYPES,
    SCHEDULE_TYPES,
    MAX_WATCHED,
    MAX_FAVORITES,
    validateFcmToken,
    validateWatchedTimetables,
    validateFavorites,
    isPlainObject,
};
