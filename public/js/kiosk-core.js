/**
 * Pure helpers of the hallway kiosk (?kiosk=changes); tested in Node.
 */

import { lessonTimes } from './constants.js';
import { getTodayIndex, getCurrentHour, getUpcomingHour } from './utils.js';

/** From this time the board shows the next school day (today's lessons are over). */
export const KIOSK_SWITCH_AT = [15, 0];

/**
 * Milliseconds until the nightly reload (default 3:00 + jitter). A screen that
 * runs for weeks would otherwise keep the bundle it booted with; the reload
 * goes through the network-first service worker and picks up a new deploy.
 * Jitter spreads several screens so they do not all hit the server at once.
 */
export function msUntilNightlyReload(now = new Date(), { hour = 3, jitterMs = 0 } = {}) {
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target - now + Math.max(0, jitterMs);
}

const hm = ([h, m]) => `${h}:${String(m).padStart(2, '0')}`;

/** "Probíhá 3. hodina (do 10:30)" / "Přestávka – 4. hodina začne v 10:50" / "Mimo vyučování" */
export function lessonNowText(now = new Date()) {
    if (getTodayIndex(now) === -1) return 'Víkend';
    const current = getCurrentHour(now);
    if (current !== -1) {
        const t = lessonTimes.find(x => x.hour === current);
        return `Probíhá ${current}. hodina (do ${hm(t.end)})`;
    }
    const upcoming = getUpcomingHour(now);
    if (upcoming !== -1) {
        const t = lessonTimes.find(x => x.hour === upcoming);
        const first = lessonTimes[0];
        const beforeSchool = now.getHours() * 60 + now.getMinutes() < first.start[0] * 60 + first.start[1];
        return beforeSchool
            ? `Před vyučováním – ${upcoming}. hodina začne v ${hm(t.start)}`
            : `Přestávka – ${upcoming}. hodina začne v ${hm(t.start)}`;
    }
    return 'Mimo vyučování';
}

/** "14:05" and "středa 4. listopadu 2026" for the kiosk clock. */
export function clockText(now = new Date()) {
    const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    let date;
    try {
        date = now.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
        date = `${now.getDate()}. ${now.getMonth() + 1}. ${now.getFullYear()}`;
    }
    return { time, date };
}

/**
 * Next offset of an auto-scrolling list. Continuous mode moves `speed` px per
 * second and pauses at both ends; paged mode (prefers-reduced-motion) jumps a
 * screen at a time without animation.
 * @returns {{ top: number, wait: number }} - new scrollTop and how long to hold it (ms)
 */
export function nextScroll({ top, max, viewport, mode, dtMs = 0, speed = 30, holdMs = 6000, pageMs = 12000 }) {
    if (max <= 0) return { top: 0, wait: holdMs };
    if (mode === 'paged') {
        if (top >= max - 1) return { top: 0, wait: pageMs };
        return { top: Math.min(max, top + Math.max(1, viewport - 40)), wait: pageMs };
    }
    if (top >= max) return { top: 0, wait: holdMs };
    const next = Math.min(max, top + (speed * dtMs) / 1000);
    return { top: next, wait: next >= max ? holdMs : 0 };
}
