/**
 * Lesson time-status updater
 *
 * Renderers stamp every slot that carries a time-based highlight with
 * data-day / data-hour / data-time-status (the value is the class variant
 * from TIME_STATUS_CLASSES: '' for cards, 'agenda' for agenda rows). This module periodically
 * recomputes current-time / upcoming / past for those elements and toggles
 * only the classes that actually changed, so a lesson ending never triggers a
 * full timetable re-render.
 */

import { state } from './state.js';
import { getLessonTimeStatus, TIME_STATUS_CLASSES } from './utils.js';

const REFRESH_INTERVAL_MS = 30 * 1000;
let intervalId = null;

/**
 * Apply the correct time-status class to each element and report how many changed.
 * @param {Iterable<Element>} elements - elements with data-day/data-hour/data-time-status
 * @param {Date} [now]
 * @returns {Number} number of elements whose classes changed
 */
export function applyLessonTimeClasses(elements, now = new Date()) {
    let changed = 0;

    for (const el of elements) {
        const day = Number(el.dataset.day);
        const hour = Number(el.dataset.hour);
        if (Number.isNaN(day) || Number.isNaN(hour)) continue;

        const classes = TIME_STATUS_CLASSES[el.dataset.timeStatus || ''] || TIME_STATUS_CLASSES[''];
        const wanted = getLessonTimeStatus(day, hour, now);

        let touched = false;
        for (const [status, cls] of Object.entries(classes)) {
            const shouldHave = status === wanted;
            if (el.classList.contains(cls) !== shouldHave) {
                el.classList.toggle(cls, shouldHave);
                touched = true;
            }
        }
        if (touched) changed++;
    }

    return changed;
}

/** Recompute time-status classes for everything currently rendered. */
export function refreshLessonTimeClasses(now = new Date()) {
    // Highlights are only rendered for the current week; other schedule types
    // carry no data-time-status elements, so this is a cheap no-op there.
    if (state.selectedScheduleType !== 'actual') return 0;
    return applyLessonTimeClasses(document.querySelectorAll('[data-time-status]'), now);
}

/** Start periodic updates (idle while the tab is hidden). Safe to call once. */
export function initLessonStatusUpdates() {
    if (intervalId) return;

    intervalId = setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        refreshLessonTimeClasses();
    }, REFRESH_INTERVAL_MS);

    // Catch up right away when the tab comes back (mobile browsers suspend timers).
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshLessonTimeClasses();
    });
    window.addEventListener('focus', () => refreshLessonTimeClasses());
    window.addEventListener('pageshow', () => refreshLessonTimeClasses());
}
