/**
 * Pure helpers of the free-rooms view (?view=rooms) over the S3 aggregate
 * aggregates/freeRooms_{Actual|Next}: { weekStart, rooms: [{id,name}], free: { "<day>-<hour>": [roomId] } }.
 * Tested in Node (test/client-views.test.js).
 */

import { lessonTimes } from './constants.js';
import { getTodayIndex, getCurrentHour, getUpcomingHour } from './utils.js';

/** Lesson numbers the aggregate knows (its keys), ascending. */
export function rasterHours(agg) {
    if (!agg || !agg.free) return [];
    const hours = new Set();
    for (const key of Object.keys(agg.free)) {
        const hour = Number(key.split('-')[1]);
        if (Number.isInteger(hour)) hours.add(hour);
    }
    return [...hours].sort((a, b) => a - b);
}

/**
 * Free rooms in one slot, without the rooms the user hid as unsuitable.
 * `known: false` means the slot is not in the data (outside the raster):
 * "we don't know" must not look like "no room is free".
 * @returns {{ known: boolean, rooms: Array<{id,name}>, hiddenCount: number }}
 */
export function freeRoomsAt(agg, day, hour, hidden = []) {
    const ids = agg && agg.free ? agg.free[`${day}-${hour}`] : undefined;
    if (!Array.isArray(ids)) return { known: false, rooms: [], hiddenCount: 0 };
    const names = new Map((agg.rooms || []).map(r => [String(r.id), r.name || String(r.id)]));
    const hide = new Set((hidden || []).map(String));
    const rooms = ids.map(String).filter(id => !hide.has(id)).map(id => ({ id, name: names.get(id) || id }));
    return { known: true, rooms, hiddenCount: ids.length - rooms.length };
}

const firstTeachingHour = (hours) => (hours.includes(1) ? 1 : hours[0]);
const nextIn = (hours, hour) => hours.find(h => h > hour);

/**
 * Default slots of the view: what is free now and in the next lesson.
 * - during a lesson: that lesson + the next one,
 * - in a break / before school: the coming lesson + the one after,
 * - after school or at the weekend: the first lessons of the next school day.
 * `week` says which aggregate to read: 'Actual' (this week) or 'Next'.
 * @param {Date} now
 * @param {number[]} hours - raster of the aggregate (rasterHours)
 * @returns {{ primary: Slot|null, secondary: Slot|null }}
 *   Slot = { when: 'now'|'upcoming'|'nextDay'|'next', week: 'Actual'|'Next', day, hour }
 */
export function defaultRoomSlots(now = new Date(), hours = lessonTimes.map(t => t.hour)) {
    if (!hours || hours.length === 0) return { primary: null, secondary: null };
    const today = getTodayIndex(now);
    const slot = (when, week, day, hour) => (hour === undefined ? null : { when, week, day, hour });

    if (today >= 0) {
        const current = getCurrentHour(now);
        if (current !== -1 && hours.includes(current)) {
            return { primary: slot('now', 'Actual', today, current), secondary: slot('next', 'Actual', today, nextIn(hours, current)) };
        }
        const upcoming = getUpcomingHour(now);
        if (upcoming !== -1 && hours.includes(upcoming)) {
            return { primary: slot('upcoming', 'Actual', today, upcoming), secondary: slot('next', 'Actual', today, nextIn(hours, upcoming)) };
        }
    }
    // After school (or weekend): next school day
    const first = firstTeachingHour(hours);
    const nextDay = today >= 0 && today < 4
        ? { week: 'Actual', day: today + 1 }
        : { week: 'Next', day: 0 };
    return {
        primary: slot('nextDay', nextDay.week, nextDay.day, first),
        secondary: slot('next', nextDay.week, nextDay.day, nextIn(hours, first)),
    };
}

/** "3. hodina (9:45–10:30)" */
export function hourLabel(hour) {
    const t = lessonTimes.find(x => x.hour === hour);
    return t ? `${hour}. hodina (${t.label.replace('-', '–')})` : `${hour}. hodina`;
}

/** Hidden rooms are a plain id list in localStorage; anything else reads as empty. */
export function parseHiddenRooms(raw) {
    try {
        const list = JSON.parse(raw || '[]');
        return Array.isArray(list) ? [...new Set(list.map(String))] : [];
    } catch {
        return [];
    }
}

export function toggleHiddenRoom(list, id) {
    const s = String(id);
    return list.includes(s) ? list.filter(x => x !== s) : [...list, s];
}
