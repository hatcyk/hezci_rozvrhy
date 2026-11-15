/**
 * Rám aplikace (návrh G): obrazovky Přehled / Den na mobilu, lišta pohledu
 * na počítači, nabídka „⋯“, nadpisy a odkaz „Přeskočit na obsah“.
 *
 * Mobil: záložka Rozvrh začíná Přehledem (overview.js); řádek týdne nebo pás
 * hodin otevře Den (časová osa / seznam / karty podle Nastavení). Den je
 * záznam v historii, takže systémové Zpět (Android) vrátí na Přehled.
 *
 * Počítač: Přehled není; lišta má Den / Týden, Stálý / Aktuální / Příští,
 * Dnes, ‹ ›, „Jen změny“, „⋯“, zvonek a nastavení.
 */

import { state, updateState } from './state.js';
import { dom } from './dom.js';
import { setPressed, getTodayIndex } from './utils.js';
import { DAY_NAMES, czDate, addDays, weekTitle } from './rozvrh-core.js';

const MOBILE_QUERY = '(max-width: 1079px)';
const $ = (id) => document.getElementById(id);
const isMobile = () => !!window.matchMedia && window.matchMedia(MOBILE_QUERY).matches;
const reducedMotion = () => !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── přechody ──────────────────────────────────────────────────────────── */

/**
 * Změna obrazovky s View Transitions (kde je prohlížeč umí a pohyb není
 * omezený). view-transition-name dostane jen nadpis a jen na dobu přechodu,
 * nikdy skleněný prvek (pojmenovaný prvek by ztratil rozostření).
 * @param {() => (void|Promise<void>)} update
 * @param {Element|null} [from] - prvek, ze kterého se nadpis „přelije“
 */
async function transition(update, from = null) {
    if (typeof document.startViewTransition !== 'function' || reducedMotion()) {
        await update();
        return;
    }
    const title = $('ttTitle');
    const source = from && from.querySelector ? (from.querySelector('.wr-d') || null) : null;
    if (source) source.style.viewTransitionName = 'day-title';
    const vt = document.startViewTransition(async () => {
        if (source) source.style.viewTransitionName = '';
        await update();
        if (source && title) title.style.viewTransitionName = 'day-title';
    });
    try { await vt.finished; } catch { /* přeskočený přechod */ }
    if (title) title.style.viewTransitionName = '';
    if (source) source.style.viewTransitionName = '';
}

/* ── obrazovky (mobil) ─────────────────────────────────────────────────── */

/**
 * @param {'overview'|'day'} screen
 * @param {{ focus?: Element|string|null }} [opts]
 */
export function setScreen(screen, { focus = null } = {}) {
    updateState('screen', screen);
    document.documentElement.dataset.screen = screen;
    updateTitles();
    if (focus) {
        const el = typeof focus === 'string' ? document.querySelector(focus) : focus;
        if (el && el.focus) el.focus({ preventScroll: false });
    }
}

/** Obrazovka podle záznamu historie (Zpět / Vpřed). */
export function syncScreenFromHistory() {
    const screen = history.state && history.state.screen === 'day' ? 'day' : 'overview';
    if (screen === state.screen) return;
    const day = state.selectedDayIndex;
    transition(() => setScreen(screen)).then(() => {
        if (screen === 'overview') {
            const row = document.querySelector(`#overview .wr[data-day="${day}"]`);
            if (row) row.focus({ preventScroll: true });
        }
    });
}

async function loadSchedule(schedule) {
    if (state.selectedScheduleType === schedule) return false;
    updateState('selectedScheduleType', schedule);
    setPressed(dom.scheduleTypeButtons, b => b.dataset.schedule === schedule);
    const { loadTimetable } = await import('./timetable.js');
    await loadTimetable();
    return true;
}

/**
 * Otevře Den (z řádku týdne nebo z pásu hodin v přehledu).
 * @param {number} day
 * @param {{ schedule?: 'actual'|'next', from?: Element|null }} [opts]
 */
export async function openDay(day, { schedule = 'actual', from = null } = {}) {
    updateState('selectedDayIndex', day);
    const needsLoad = state.selectedScheduleType !== schedule;
    if (!isMobile()) {
        const { switchLayout } = await import('./layout-manager.js');
        if (needsLoad) await loadSchedule(schedule);
        await switchLayout('day');
        return;
    }
    const focusBefore = document.activeElement;
    // Záznam v historii hned (ne až po přechodu), aby Zpět nikdy neodešlo ze stránky
    if (!history.state || history.state.screen !== 'day') {
        history.pushState({ view: 'timetable', screen: 'day' }, '', location.pathname + location.search);
    }
    const { createDaySelector } = await import('./timetable.js');
    const { applyLayout } = await import('./layout-manager.js');
    // Rychlé Zpět během načítání: záznam Dne už v historii není, Den se neotevře
    // (jinak by zůstal zobrazený bez záznamu a další Zpět by odešlo z aplikace)
    const stillWanted = () => !!history.state && history.state.screen === 'day';
    if (!stillWanted()) return;
    await transition(async () => {
        if (!stillWanted()) return;
        setScreen('day');
        if (!needsLoad) {
            createDaySelector();
            await applyLayout();
        }
    }, from);
    if (!stillWanted()) {
        if (state.screen === 'day') setScreen('overview');
        return;
    }
    if (needsLoad) await loadSchedule(schedule);
    // Fokus na nadpis dne – jen když ho uživatel mezitím nepřesunul jinam
    const title = $('ttTitle');
    const active = document.activeElement;
    if (title && (active === focusBefore || active === document.body || !active || !active.isConnected || active.closest('#overview'))) {
        title.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
}

/**
 * Den otevřený odkazem (notifikace, „Rozvrh“ u třídy ve Změnách, učebna ve
 * Volných učebnách): na mobilu dostane vlastní záznam v historii nad
 * přehledem, takže systémové Zpět vrátí na Přehled stejně jako u dne
 * otevřeného z přehledu.
 */
export function showDayScreen() {
    if (isMobile() && !(history.state && history.state.screen === 'day')) {
        history.pushState({ view: 'timetable', screen: 'day' }, '', location.pathname + location.search);
    }
    setScreen('day');
}

/** Zpět na přehled (tlačítko ‹, opětovné klepnutí na záložku Rozvrh). */
export async function backToOverview() {
    if (state.screen !== 'day') return;
    const day = state.selectedDayIndex;
    if (history.state && history.state.screen === 'day') {
        history.back(); // popstate → view-router → syncScreenFromHistory()
        return;
    }
    await transition(() => setScreen('overview'));
    const row = document.querySelector(`#overview .wr[data-day="${day}"]`);
    if (row) row.focus({ preventScroll: true });
}

/* ── nadpisy ───────────────────────────────────────────────────────────── */

function who() {
    const label = ($('valueDropdownLabel') || {}).textContent || '';
    if (state.selectedType === 'Class') return `třída ${label}`;
    if (state.selectedType === 'Room') return `učebna ${label}`;
    return label;
}

async function shownMondaySafe() {
    const { shownMonday } = await import('./timetable.js');
    return shownMonday();
}

export async function updateTitles() {
    const title = $('ttTitle');
    const sub = $('ttSub');
    if (!title) return;
    const monday = await shownMondaySafe();
    const d = state.selectedDayIndex ?? 0;
    const date = monday ? addDays(monday, d) : null;
    const layout = state.layoutMode;
    let t;
    let s = '';
    if (isMobile()) {
        if (state.screen === 'day') {
            t = DAY_NAMES[d];
            s = `${date ? czDate(date) : 'stálý rozvrh'}, ${who()}`;
        } else {
            t = `Rozvrh, ${who()}`;
        }
    } else if (layout === 'day') {
        t = date ? `${DAY_NAMES[d]} ${czDate(date)}` : `${DAY_NAMES[d]}, stálý rozvrh`;
    } else {
        t = weekTitle(monday);
    }
    title.textContent = t;
    if (sub) sub.textContent = s;
    updateToolbar();
}

/* ── lišta pohledu (počítač) ───────────────────────────────────────────── */

function updateToolbar() {
    const layout = state.layoutMode;
    setPressed(document.querySelectorAll('#layoutSeg [data-layout]'), b => b.dataset.layout === layout);
    const prev = $('prevBtn');
    const next = $('nextBtn');
    if (!prev || !next) return;
    const sched = state.selectedScheduleType;
    const d = state.selectedDayIndex ?? 0;
    if (layout === 'day') {
        prev.setAttribute('aria-label', 'Předchozí den');
        next.setAttribute('aria-label', 'Další den');
        prev.disabled = d === 0 && sched !== 'next';
        next.disabled = d === 4 && sched !== 'actual';
    } else {
        prev.setAttribute('aria-label', 'Předchozí týden');
        next.setAttribute('aria-label', 'Další týden');
        prev.disabled = sched !== 'next';
        next.disabled = sched !== 'actual';
    }
    prev.title = prev.getAttribute('aria-label');
    next.title = next.getAttribute('aria-label');
}

async function step(dir) {
    const { selectDay } = await import('./timetable.js');
    const sched = state.selectedScheduleType;
    if (state.layoutMode === 'day') {
        const d = (state.selectedDayIndex ?? 0) + dir;
        if (d >= 0 && d <= 4) { await selectDay(d); return; }
        if (dir < 0 && sched === 'next') { updateState('selectedDayIndex', 4); await loadSchedule('actual'); }
        if (dir > 0 && sched === 'actual') { updateState('selectedDayIndex', 0); await loadSchedule('next'); }
        return;
    }
    if (dir < 0 && sched === 'next') await loadSchedule('actual');
    if (dir > 0 && sched === 'actual') await loadSchedule('next');
}

async function goToday() {
    const t = getTodayIndex();
    const { selectDay } = await import('./timetable.js');
    // O víkendu je „dnes“ nejbližší školní den: pondělí příštího týdne, stejný
    // týden, jaký aplikace o víkendu vybírá sama a jaký ukazuje modul Týden
    const day = t >= 0 ? t : 0;
    updateState('selectedDayIndex', day);
    const loaded = await loadSchedule(t >= 0 ? 'actual' : 'next');
    if (!loaded) await selectDay(day);
    // Na časové ose rovnou k čáře „teď“
    const line = document.querySelector('.nowline:not([hidden])');
    if (line) line.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/* ── nabídka „⋯“ ───────────────────────────────────────────────────────── */

function initMoreMenu() {
    const btn = $('moreBtn');
    const menu = $('moreMenu');
    if (!btn || !menu) return;
    const items = () => [...menu.querySelectorAll('[role="menuitem"]')].filter(i => i.offsetParent !== null && !i.disabled);
    const open = (focusLast = false) => {
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        const list = items();
        (focusLast ? list[list.length - 1] : list[0])?.focus();
    };
    const close = (focusBtn = true) => {
        if (menu.hidden) return;
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        if (focusBtn) btn.focus();
    };
    btn.addEventListener('click', () => (menu.hidden ? open() : close()));
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); open(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); open(true); }
    });
    menu.addEventListener('keydown', (e) => {
        const list = items();
        const i = list.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
        else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
        else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'Tab') { e.preventDefault(); close(); }
    });
    // Zachytávací fáze: nabídka se zavře a fokus se vrátí na „⋯“ dřív, než
    // položka otevře panel – zavřený panel pak vrátí fokus na „⋯“, ne do prázdna
    menu.addEventListener('click', (e) => {
        if (e.target.closest('[role="menuitem"]')) close(true);
    }, true);
    document.addEventListener('pointerdown', (e) => {
        if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close(false);
    });
    $('notifMenuBtn')?.addEventListener('click', () => $('notificationBell')?.click());
}

/* ── umístění ovládání ─────────────────────────────────────────────────── */

/** Stálý / Aktuální / Příští + „Jen změny“: na počítači v liště, na mobilu pod pásem týdne. */
function placeControls() {
    const controls = $('ttControls');
    if (!controls) return;
    const slot = isMobile() ? $('paneToolsSlot') : $('ttTools');
    if (!slot || controls.parentElement === slot) return;
    if (slot.id === 'ttTools') slot.insertBefore(controls, $('layoutSeg') ? $('layoutSeg').nextSibling : slot.firstChild);
    else slot.appendChild(controls);
}

/* ── inicializace ──────────────────────────────────────────────────────── */

export function initShell() {
    document.documentElement.dataset.screen = state.screen || 'overview';
    placeControls();
    if (window.matchMedia) {
        const mq = window.matchMedia(MOBILE_QUERY);
        const onChange = () => { placeControls(); updateTitles(); };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
    }

    initMoreMenu();

    $('backBtn')?.addEventListener('click', backToOverview);
    $('todayBtn')?.addEventListener('click', goToday);
    $('prevBtn')?.addEventListener('click', () => step(-1));
    $('nextBtn')?.addEventListener('click', () => step(1));
    document.querySelectorAll('#layoutSeg [data-layout]').forEach(b => b.addEventListener('click', async () => {
        const { switchLayout } = await import('./layout-manager.js');
        await switchLayout(b.dataset.layout);
    }));

    // Přeskočit na obsah: na právě zobrazený pohled
    $('skipLink')?.addEventListener('click', (e) => {
        const main = document.querySelector('.app-container main:not([hidden])');
        if (!main) return;
        e.preventDefault();
        if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
        main.focus();
    });

    document.addEventListener('layoutapplied', () => updateTitles());
    document.addEventListener('timetableloaded', () => updateTitles());

    // Nadpis Dne je cíl fokusu po otevření dne
    const title = $('ttTitle');
    if (title) title.tabIndex = -1;
    updateTitles();
}
