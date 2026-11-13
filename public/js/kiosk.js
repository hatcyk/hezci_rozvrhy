/**
 * Kiosk (?kiosk=changes): the changes board on a hallway TV.
 * Big type and a clock, the list scrolls by itself when it does not fit
 * (screen by screen with prefers-reduced-motion), new data arrive live through
 * Firestore onSnapshot, the screen is kept on with the Screen Wake Lock API
 * where it exists, and the page reloads at night to pick up a new version.
 * No notification prompts and no panels: nobody operates the screen.
 */

import { watchAggregate, fetchBackendStatus } from './api.js';
import { boardDayOptions, pickBoardDate, boardEntries, groupByClass, dayLabel, czPlural, freshnessText } from './changes-core.js';
import { briefHtml, afterHtml, hourHtml } from './changes-render.js';
import { KIOSK_SWITCH_AT, msUntilNightlyReload, lessonNowText, clockText, nextScroll } from './kiosk-core.js';
import { esc, setPressed } from './utils.js';

const $ = (id) => document.getElementById(id);
const aggs = { Actual: null, Next: null };
let status = null;
let shownDate = null;
let paused = false;
let wakeLock = null;
let lastHtml = '';

const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function render() {
    const now = new Date();
    const options = boardDayOptions({ Actual: aggs.Actual && aggs.Actual.data, Next: aggs.Next && aggs.Next.data }, now);
    const date = pickBoardDate(options, now, { switchAt: KIOSK_SWITCH_AT });
    shownDate = date;
    const option = options.find(o => o.date === date);
    const entries = boardEntries(option);
    const groups = groupByClass(entries);

    $('kioskDay').textContent = date ? `${dayLabel(date, now)} · ${entries.length ? czPlural(entries.length, ['změna', 'změny', 'změn']) : 'bez změn'}` : '';

    let html;
    if (!aggs.Actual && !aggs.Next) {
        html = '<p class="kiosk-empty">Načítám změny…</p>';
    } else if (!option) {
        html = '<p class="kiosk-empty">Přehled změn zatím není k dispozici.</p>';
    } else if (groups.length === 0) {
        const when = dayLabel(date, now, { relative: true }).split(',')[0];
        const lead = when === 'dnes' || when === 'zítra' ? when.charAt(0).toUpperCase() + when.slice(1) : 'Tento den';
        html = `<p class="kiosk-empty">${lead} žádné změny v rozvrhu.</p>`;
    } else {
        html = `<div class="k-grid">${groups.map(g => `
            <section class="k-class">
                <h2 class="k-class-name">${esc(g.className)}</h2>
                <ul class="k-rows">${g.entries.map(e => `
                    <li class="k-row k-row--${esc(e.kind)}">
                        <span class="k-hour">${hourHtml(e)}</span>
                        <span class="k-what">
                            ${e.before ? `<span class="k-before"><span class="sr-only">původně </span>${briefHtml(e.before, { strike: true })}</span><span class="k-arrow" aria-hidden="true">→</span>` : ''}
                            <span class="k-after"><span class="sr-only">nyní </span>${afterHtml(e)}</span>
                        </span>
                    </li>`).join('')}
                </ul>
            </section>`).join('')}</div>`;
    }
    // Live updates arrive often with the same content: do not reset the scroll for nothing
    if (html !== lastHtml) {
        $('kioskBoard').innerHTML = html;
        lastHtml = html;
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
        el.textContent = 'Displej může zhasnout – prohlížeč neumí Wake Lock, vypněte úsporný režim televize.';
        return;
    }
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        el.textContent = 'Displej zůstává zapnutý';
        wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (err) {
        // NotAllowedError: page hidden, battery saver or blocked by policy
        el.textContent = `Displej může zhasnout (${err && err.name ? err.name : 'Wake Lock odmítnut'})`;
    }
}

/* ── auto-scroll ─────────────────────────────────────────────────────── */

function startAutoScroll() {
    const board = $('kioskBoard');
    let pos = 0;
    let last = performance.now();
    let holdUntil = last + 6000;

    const userScrolled = () => {
        pos = board.scrollTop;
        holdUntil = performance.now() + 30000; // someone reads / scrolls by hand
    };
    ['wheel', 'touchstart', 'keydown'].forEach(t => board.addEventListener(t, userScrolled, { passive: true }));

    const frame = (t) => {
        const max = board.scrollHeight - board.clientHeight;
        if (max <= 0) {
            pos = 0;
        } else if (!paused && !document.hidden && t >= holdUntil) {
            if (Math.abs(board.scrollTop - pos) > 2) pos = board.scrollTop; // content changed under us
            const mode = reduceMotion() ? 'paged' : 'smooth';
            const step = nextScroll({ top: pos, max, viewport: board.clientHeight, mode, dtMs: Math.min(t - last, 100) });
            pos = step.top;
            board.scrollTop = pos;
            if (step.wait) holdUntil = t + step.wait;
        }
        last = t;
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    // WCAG 2.2.2: moving content that starts by itself can be paused
    $('kioskPause').addEventListener('click', () => {
        paused = !paused;
        setPressed([$('kioskPause')], () => paused);
        $('kioskPauseText').textContent = paused ? 'Spustit posouvání' : 'Pozastavit posouvání';
    });
}

/** Start the kiosk (main.js after Firebase sign-in). */
export function startKiosk() {
    document.documentElement.dataset.kiosk = 'changes';
    const view = $('kioskView');
    view.hidden = false;
    document.title = 'Změny v rozvrhu – Lepší Rozvrh';

    watchAggregate('changes_Actual', (v) => { aggs.Actual = v; render(); });
    watchAggregate('changes_Next', (v) => { aggs.Next = v; render(); });
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

    startAutoScroll();
    render();
}
