/**
 * App views and their URLs (pure, tested in Node).
 *
 *   /                                  timetable (saved selection)
 *   /?type=Class&id=…                  timetable deep link (deeplink.js)
 *   /?view=changes&date=&class=&teacher=   school-wide changes
 *   /?view=rooms&date=&hour=           free rooms
 *   /?view=common&with=Teacher:T1,Class:XX&week=actual   common free time
 *   /?kiosk=changes                    full-screen board for a hallway TV
 *
 * Every view state lives in the URL, so a link can be shared or bookmarked
 * and the back button walks through views.
 */

import { parseViewParam } from './deeplink.js';

export const VIEWS = ['timetable', 'changes', 'rooms', 'common'];

export const VIEW_TITLES = {
    timetable: 'Rozvrh',
    changes: 'Změny v rozvrhu',
    rooms: 'Volné učebny',
    common: 'Společné volno',
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[\p{L}\p{N}._ -]{1,40}$/u;
const WEEKS = ['actual', 'next', 'permanent'];

const PARAMS = {
    timetable: [],
    changes: ['date', 'class', 'teacher'],
    rooms: ['date', 'hour'],
    common: ['with', 'week'],
};

function clean(key, value) {
    if (value === null || value === undefined || value === '') return null;
    const v = String(value);
    switch (key) {
        case 'date': return ISO.test(v) ? v : null;
        case 'hour': return /^\d{1,2}$/.test(v) && Number(v) <= 12 ? v : null;
        case 'week': return WEEKS.includes(v) ? v : null;
        case 'with': return v.length <= 400 ? v : null;
        default: return ID.test(v) ? v : null;
    }
}

/**
 * @param {string} [search]
 * @returns {{ kiosk: 'changes'|null, view: string, params: Object<string,string> }}
 */
export function parseRoute(search = (typeof window !== 'undefined' ? window.location.search : '')) {
    const q = new URLSearchParams(search);
    const kiosk = q.get('kiosk') === 'changes' ? 'changes' : null;
    const view = kiosk ? 'changes' : (parseViewParam(search) || 'timetable');
    const params = {};
    for (const key of PARAMS[view] || []) {
        const v = clean(key, q.get(key));
        if (v !== null) params[key] = v;
    }
    return { kiosk, view, params };
}

/** Relative URL of a view with its (valid, non-empty) parameters. */
export function routeUrl(view, params = {}) {
    if (!VIEWS.includes(view) || view === 'timetable') return '/';
    const q = new URLSearchParams({ view });
    for (const key of PARAMS[view]) {
        const v = clean(key, params[key]);
        if (v !== null) q.set(key, v);
    }
    return `/?${q.toString()}`;
}

/** Deep link of a timetable (opens type + id + week + day, see deeplink.js). */
export function timetableUrl({ type, id, schedule = 'actual', day = null }) {
    if (!type || !id) return '/';
    const q = new URLSearchParams({ type, id, schedule: schedule.charAt(0).toUpperCase() + schedule.slice(1) });
    if (Number.isInteger(day) && day >= 0 && day <= 4) q.set('day', String(day));
    return `/?${q.toString()}`;
}
