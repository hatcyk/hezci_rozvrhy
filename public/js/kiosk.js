/**
 * Kiosk (?kiosk=changes): the changes board on a hallway TV.
 * Big type and a clock; when the list does not fit it pages screen by screen
 * without animation (a page never starts in the middle of a row), new data
 * arrive live through Firestore onSnapshot, the screen is kept on with the
 * Screen Wake Lock API where it exists, and the page reloads at night to pick
 * up a new version. No notification prompts and no panels: nobody operates
 * the screen.
 *
 * Design G: always the night sky, solid panels (no glass: a TV runs for weeks
 * and blur costs a lot on cheap players), type sized by the screen height.
 */

import { watchAggregate, storedAggregate, fetchBackendStatus } from './api.js';
import { boardDayOptions, pickBoardDate, boardEntries, groupByClass, dayLabel, czPlural, freshnessText } from './changes-core.js';
import { briefHtml, afterHtml, hourHtml, kindTone } from './changes-render.js';
import { KIOSK_SWITCH_AT, KIOSK_LOAD_TIMEOUT_MS, msUntilNightlyReload, lessonNowText, clockText, nextScroll, emptyBoardState } from './kiosk-core.js';
import { esc, setPressed } from './utils.js';

const $ = (id) => document.getElementById(id);
const aggs = { Actual: null, Next: null };
/** Reading the aggregates failed / Firestore did not answer in time (the board says so instead of loading). */
const load = { failed: false, timedOut: false };
let status = null;
let shownDate = null;
let paused = false;
let wakeLock = null;
let lastHtml = '';
let stops = [0];

/** How long one screen stays, and the first one after loading. */
const PAGE_MS = 12000;
const FIRST_PAGE_MS = 8000;

function render() {
    const now = new Date();
    const options = boardDayOptions({ Actual: aggs.Actual && aggs.Actual.data, Next: aggs.Next && aggs.Next.data }, now);
    const date = pickBoardDate(options, now, { switchAt: KIOSK_SWITCH_AT });
    shownDate = date;
    const option = options.find(o => o.date === date);
    const entries = boardEntries(option);
    const groups = groupByClass(entries);

    $('kioskDay').textContent = date ? dayLabel(date, now) : '';
    $('kioskCount').textContent = date ? (entries.length ? czPlural(entries.length, ['změna', 'změny', 'změn']) : 'bez změn') : '';

    let html;
    const empty = option ? null : emptyBoardState(aggs, load);
    if (empty === 'loading') {
        html = '<p class="kiosk-empty">Načítám změny…</p>';
    } else if (empty === 'unavailable') {
        html = '<p class="kiosk-empty"><strong>Změny se teď nedaří načíst.</strong><span>Tabule to bude dál zkoušet sama.</span></p>';
    } else if (empty === 'missing') {
        html = '<p class="kiosk-empty"><strong>Přehled změn zatím není k dispozici.</strong><span>Objeví se po příštím stažení dat z Bakalářů.</span></p>';
    } else if (groups.length === 0) {
        const when = dayLabel(date, now, { relative: true }).split(',')[0];
        const lead = when === 'dnes' || when === 'zítra' ? when.charAt(0).toUpperCase() + when.slice(1) : 'Tento den';
        html = `<p class="kiosk-empty"><strong>${lead} žádné změny v rozvrhu.</strong><span>Všechny hodiny proběhnou podle rozvrhu.</span></p>`;
    } else {
        html = `<div class="k-list">${groups.map(g => `
            <section class="k-class">
                <h2 class="k-class-name">${esc(g.className)}</h2>
                <ul class="k-rows">${g.entries.map(e => `
                    <li class="k-row k-row--${esc(e.kind)} k-tone--${kindTone(e.kind)}">
                        <span class="k-hour">${hourHtml(e)}</span>
                        <span class="k-before">${e.before ? `<span class="sr-only">původně </span>${briefHtml(e.before, { strike: true })}` : ''}</span>
                        <span class="k-arrow" aria-hidden="true">${e.before ? '→' : ''}</span>
                        <span class="k-after"><span class="sr-only">nyní </span>${afterHtml(e)}</span>
                    </li>`).join('')}
                </ul>
            </section>`).join('')}</div>`;
    }
    // Live updates arrive often with the same content: do not reset the page for nothing
    if (html !== lastHtml) {
        $('kioskBoard').innerHTML = html;
        lastHtml = html;
        computeStops();
    }

    const src = option && (option.source === 'Next' ? aggs.Next : aggs.Actual);
    $('kioskFresh').textContent = freshnessText({
        lastSuccessAt: status && status.lastSuccessAt,
        generatedAt: src && src.data && src.data.generatedAt,
        fromCache: !!(src && src.fromCache),
        cacheAgeMs: src && src.cacheAgeMs,
    }, now);
}

function tick() {
    const now = new Date();
    const { time, date } = clockText(now);
    $('kioskTime').textContent = time;
    $('kioskTime').setAttribute('datetime', now.toISOString());
    $('kioskDate').textContent = date;
    $('kioskLesson').textContent = lessonNowText(now);
    // After the switch time / midnight the board moves on to the next school day
    const options = boardDayOptions({ Actual: aggs.Actual && aggs.Actual.data, Next: aggs.Next && aggs.Next.data }, now);
    if (pickBoardDate(options, now, { switchAt: KIOSK_SWITCH_AT }) !== shownDate) render();
}

async function refreshStatus() {
    status = await fetchBackendStatus();
    render();
}

/* ── keep the screen on ─────────────────────────────────────────────── */

async function requestWakeLock() {
    const el = $('kioskWake');
    if (!('wakeLock' in navigator)) {
        el.textContent = 'Displej může zhasnout, vypněte úsporný režim televize.';
        return;
    }
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        el.textContent = 'Displej zůstává zapnutý';
        wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (err) {
        // NotAllowedError: page hidden, battery saver or blocked by policy
        el.textContent = 'Displej může zhasnout, vypněte úsporný režim televize.';
        console.warn('Wake Lock:', err && err.name ? err.name : err);
    }
}

/* ── paging ──────────────────────────────────────────────────────────── */

/**
 * Scroll positions of the screens: each next screen starts at the first row
 * the previous one cut off (or did not reach), so no row is ever split.
 */
function computeStops() {
    const board = $('kioskBoard');
    const max = board.scrollHeight - board.clientHeight;
    const view = board.clientHeight;
    if (max <= 1 || view <= 0) { stops = [0]; updatePage(); return; }
    const base = board.getBoundingClientRect().top - board.scrollTop;
    const pad = parseFloat(getComputedStyle(board).paddingTop) || 0;
    const rows = [...board.querySelectorAll('.k-row')].map(r => {
        const b = r.getBoundingClientRect();
        return { top: b.top - base, bottom: b.bottom - base };
    });
    const out = [0];
    let cur = 0;
    for (let guard = 0; cur < max && guard < 200; guard++) {
        const limit = cur + view;
        const cut = rows.find(r => r.top > cur + pad + 1 && r.bottom > limit - 1);
        let next = cut ? cut.top - pad : cur + view - 40;
        if (next <= cur + 1) next = cur + view - 40; // a row taller than the screen
        next = Math.min(Math.round(next), max);
        out.push(next);
        cur = next;
    }
    stops = out;
    updatePage();
}

function currentPage() {
    const top = $('kioskBoard').scrollTop;
    let idx = 0;
    stops.forEach((s, i) => { if (top >= s - 2) idx = i; });
    return idx;
}

function updatePage() {
    const el = $('kioskPage');
    const page = currentPage();
    $('kioskBoard').classList.toggle('has-more', stops.length > 1 && page < stops.length - 1);
    if (el) el.textContent = stops.length > 1 ? `Strana ${page + 1} z ${stops.length}` : '';
}

function startPaging() {
    const board = $('kioskBoard');
    let holdUntil = performance.now() + FIRST_PAGE_MS;

    const userScrolled = () => {
        holdUntil = performance.now() + 30000; // someone reads / scrolls by hand
    };
    ['wheel', 'touchstart', 'keydown'].forEach(t => board.addEventListener(t, userScrolled, { passive: true }));
    board.addEventListener('scroll', updatePage, { passive: true });
    window.addEventListener('resize', () => { computeStops(); }, { passive: true });

    const frame = (t) => {
        const max = board.scrollHeight - board.clientHeight;
        if (max > 0 && !paused && !document.hidden && t >= holdUntil) {
            const top = board.scrollTop;
            let next;
            if (stops.length > 1) {
                const later = stops.find(s => s > top + 2);
                next = later === undefined ? 0 : later;
            } else {
                next = nextScroll({ top, max, viewport: board.clientHeight, mode: 'paged' }).top;
            }
            board.scrollTop = next;
            holdUntil = t + PAGE_MS;
            updatePage();
        }
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    // WCAG 2.2.2: moving content that starts by itself can be paused
    $('kioskPause').addEventListener('click', () => {
        paused = !paused;
        setPressed([$('kioskPause')], () => paused);
        $('kioskPauseText').textContent = paused ? 'Spustit posouvání' : 'Pozastavit posouvání';
        const ico = $('kioskPauseIcon');
        if (ico) ico.setAttribute('href', `icons.svg#${paused ? 'play' : 'pause'}`);
        if (!paused) holdUntil = performance.now() + PAGE_MS;
    });
}

/** Start the kiosk (main.js after Firebase sign-in). */
export function startKiosk() {
    document.documentElement.dataset.kiosk = 'changes';
    const view = $('kioskView');
    view.hidden = false;
    document.title = 'Změny v rozvrhu – Lepší Rozvrh';

    const failed = () => { load.failed = true; render(); };
    watchAggregate('changes_Actual', (v) => { aggs.Actual = v; render(); }, failed);
    watchAggregate('changes_Next', (v) => { aggs.Next = v; render(); }, failed);
    // A stuck connection answers neither with data nor with an error: show the stored copy, if any
    setTimeout(() => {
        load.timedOut = true;
        if (!aggs.Actual) aggs.Actual = storedAggregate('changes_Actual');
        if (!aggs.Next) aggs.Next = storedAggregate('changes_Next');
        render();
    }, KIOSK_LOAD_TIMEOUT_MS);
    refreshStatus();
    setInterval(() => { if (!document.hidden) refreshStatus(); }, 5 * 60 * 1000);

    tick();
    setInterval(tick, 10 * 1000);

    requestWakeLock();
    document.addEventListener('visibilitychange', () => {
        // The browser drops the lock whenever the page is hidden
        if (document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
    });

    const jitterMs = Math.floor(Math.random() * 15 * 60 * 1000);
    setTimeout(() => location.reload(), msUntilNightlyReload(new Date(), { hour: 3, jitterMs }));

    startPaging();
    render();
}
