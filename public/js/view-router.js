/**
 * Switching between the app views (timetable / changes / free rooms / common
 * free time) without reloading. The navigation is made of real links
 * (/?view=…), so they work with middle-click, long-press "open in new tab"
 * and without JavaScript; plain clicks are handled here with the History API
 * and the back button walks back through the views.
 */

import { parseRoute, routeUrl, VIEW_TITLES, VIEWS } from './view-route.js';

const APP_TITLE = 'Lepší Rozvrh';
const SECTION_IDS = {
    timetable: 'timetableView',
    changes: 'changesView',
    rooms: 'roomsView',
    common: 'commonView',
};

let current = null;
let currentParams = {};
const enterHandlers = {};

/** Register what a view does when it is shown: (params) => void|Promise. */
export function onViewEnter(view, handler) {
    enterHandlers[view] = handler;
}

export function getCurrentView() {
    return current;
}

export function getViewParams() {
    return { ...currentParams };
}

function applyChrome(view) {
    document.documentElement.dataset.view = view;
    for (const v of VIEWS) {
        const el = document.getElementById(SECTION_IDS[v]);
        // Only one <main> may be without `hidden` (HTML spec), the rest are hidden
        if (el) el.hidden = v !== view;
    }
    document.querySelectorAll('#viewNav a[data-view]').forEach(a => {
        if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
    });
    // A new "page" for screen readers and the tab / history list (WCAG 2.4.2)
    document.title = view === 'timetable' ? APP_TITLE : `${VIEW_TITLES[view]} – ${APP_TITLE}`;
}

/**
 * Show a view.
 * @param {string} view
 * @param {Object} [params] - view state that goes into the URL
 * @param {{ history?: 'push'|'replace'|'none', focus?: boolean }} [opts]
 */
export async function showView(view, params = {}, { history: mode = 'push', focus = true } = {}) {
    if (!VIEWS.includes(view)) view = 'timetable';
    const changed = view !== current;
    current = view;
    currentParams = { ...params };
    applyChrome(view);

    const url = routeUrl(view, params);
    if (mode === 'push' && url !== location.pathname + location.search) history.pushState({ view }, '', url);
    else if (mode === 'replace') history.replaceState({ view }, '', url);

    const handler = enterHandlers[view];
    if (handler) {
        try { await handler(params); } catch (err) { console.error(`View ${view} failed:`, err); }
    }

    // Move focus to the new content so keyboard and screen reader users are
    // not left on the navigation link with an unchanged reading position.
    if (focus && changed) {
        const target = view === 'timetable'
            ? document.getElementById('timetableView')
            : document.querySelector(`#${SECTION_IDS[view]} .view-title`);
        if (target) target.focus({ preventScroll: false });
    }
}

/**
 * Open a timetable from another view (a free room, a class on the board):
 * switch to the timetable view and apply it like a notification deep link.
 * @param {{ type, id, schedule?, day? }} link
 */
export async function openTimetable({ type, id, schedule = 'actual', day = null }) {
    await showView('timetable', {}, { history: 'push', focus: false });
    const { applyDeepLink } = await import('./deeplink.js');
    await applyDeepLink({ type, id, schedule, day, highlight: false });
    const main = document.getElementById('timetableView');
    if (main) main.focus({ preventScroll: true });
}

/** Keep the URL in step with filters inside a view (no new history entry). */
export function updateViewParams(params) {
    currentParams = { ...params };
    history.replaceState({ view: current }, '', routeUrl(current, params));
}

/** Wire the navigation links and the back / forward buttons. */
export function initViewRouter() {
    const nav = document.getElementById('viewNav');
    if (nav) {
        nav.addEventListener('click', (e) => {
            const a = e.target.closest('a[data-view]');
            if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            const view = a.dataset.view;
            // Same view again: keep its filters
            showView(view, view === current ? currentParams : {});
        });
    }

    window.addEventListener('popstate', () => {
        const route = parseRoute(location.search);
        if (route.kiosk) { location.reload(); return; }
        // A timetable deep link in history (/?type=…) is handled by the timetable itself
        showView(route.view, route.params, { history: 'none', focus: true });
    });
}
