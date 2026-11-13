/**
 * "Společné volno": slots of the week in which all selected teachers and/or
 * classes have no lesson - e.g. to agree on a consultation or a meeting.
 * Pure function over the timetables timetables/{Type}_{id}_{Actual|Next|Permanent};
 * tested in Node (test/client-views.test.js).
 */

import { lessonTimes } from './constants.js';

export const MIN_ENTITIES = 2;
export const MAX_ENTITIES = 6;

/**
 * A lesson keeps its people busy unless it was cancelled. "absent" stays busy:
 * on a class timetable it is an event of the class (excursion), on a teacher's
 * timetable the teacher is away - nobody is available in either case.
 */
const keepsBusy = (lesson) => lesson && lesson.type !== 'removed';

/**
 * @param {Array<{ id: string, label: string, lessons: Array }>} entities
 * @param {{ days?: number[], hours?: number[] }} [opts] - default hours: from the first to the
 *        last lesson of any selected timetable (1–6 when there are none)
 * @returns {{ days: number[], hours: number[], rows: Array<{ day, cells: Array<{ hour, free, ideal, busy: string[], away: string[] }> }> }}
 *   free  = nobody has a lesson; ideal = free and everybody is at school that day
 *   (the slot lies between their first and last lesson), away = who has no lesson
 *   around the slot and may not be at school at all
 */
export function commonFreeSlots(entities, { days = [0, 1, 2, 3, 4], hours } = {}) {
    const list = (entities || []).filter(e => e && Array.isArray(e.lessons));
    const busy = list.map(e => {
        const map = new Map(); // day -> Set(hour)
        for (const l of e.lessons) {
            if (!keepsBusy(l) || !Number.isInteger(l.day) || !Number.isInteger(l.hour)) continue;
            if (!map.has(l.day)) map.set(l.day, new Set());
            map.get(l.day).add(l.hour);
        }
        return map;
    });

    let hourList = hours;
    if (!hourList) {
        const all = busy.flatMap(m => [...m.values()].flatMap(s => [...s]));
        const min = all.length ? Math.min(...all) : 1;
        const max = all.length ? Math.max(...all) : 6;
        hourList = lessonTimes.map(t => t.hour).filter(h => h >= min && h <= max);
    }

    const rows = days.map(day => ({
        day,
        cells: hourList.map(hour => {
            const busyNames = [];
            const awayNames = [];
            list.forEach((e, i) => {
                const set = busy[i].get(day);
                if (set && set.has(hour)) { busyNames.push(e.label); return; }
                if (!set || set.size === 0) { awayNames.push(e.label); return; }
                const first = Math.min(...set);
                const last = Math.max(...set);
                if (hour < first || hour > last) awayNames.push(e.label);
            });
            const free = busyNames.length === 0 && list.length > 0;
            return { hour, free, ideal: free && awayNames.length === 0, busy: busyNames, away: awayNames };
        }),
    }));

    return { days, hours: hourList, rows };
}

/**
 * Free slots as ranges per day: [{ day, ranges: [{ from, to, ideal }] }].
 * A range breaks where "ideal" changes, so "everybody is at school" ranges stay apart.
 */
export function freeRanges(result) {
    return result.rows.map(row => {
        const ranges = [];
        for (const cell of row.cells) {
            const last = ranges[ranges.length - 1];
            if (!cell.free) continue;
            if (last && last.to === prevHour(result.hours, cell.hour) && last.ideal === cell.ideal) {
                last.to = cell.hour;
            } else {
                ranges.push({ from: cell.hour, to: cell.hour, ideal: cell.ideal });
            }
        }
        return { day: row.day, ranges };
    });
}

function prevHour(hours, hour) {
    const i = hours.indexOf(hour);
    return i > 0 ? hours[i - 1] : undefined;
}

/** "3.–4. hodina (9:45–11:35)" */
export function rangeLabel({ from, to }) {
    const a = lessonTimes.find(t => t.hour === from);
    const b = lessonTimes.find(t => t.hour === to);
    const hoursText = from === to ? `${from}. hodina` : `${from}.–${to}. hodina`;
    if (!a || !b) return hoursText;
    const fmt = ([h, m]) => `${h}:${String(m).padStart(2, '0')}`;
    return `${hoursText} (${fmt(a.start)}–${fmt(b.end)})`;
}

/**
 * Selection in the URL: "Teacher:T1,Class:XX" → [{ type, id }], valid types only,
 * no duplicates, at most MAX_ENTITIES.
 */
export function parseEntityList(raw) {
    const out = [];
    for (const part of String(raw || '').split(',')) {
        const m = /^(Teacher|Class):(.+)$/.exec(part.trim());
        if (!m) continue;
        if (out.some(e => e.type === m[1] && e.id === m[2])) continue;
        out.push({ type: m[1], id: m[2] });
        if (out.length === MAX_ENTITIES) break;
    }
    return out;
}

export function formatEntityList(list) {
    return list.map(e => `${e.type}:${e.id}`).join(',');
}
