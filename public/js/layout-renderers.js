/**
 * Layout Renderers (návrh G „Obloha“)
 *
 *  - Den: časová osa ve skutečném měřítku (lessonTimes), přestávky jsou
 *    mezery, zlatá čára „teď“, dělené hodiny vedle sebe (vzor den.html);
 *  - Týden: pět sloupců s časovou osou od první použité hodiny (desktop.html);
 *  - Seznam: řádky hodin (čas, předmět, vyučující, učebna, stav);
 *  - Karty: jedna hodina na kartu, vodorovné scroll-snap listování.
 *
 * Každá hodina je nativní <button class="lesson"> (Enter i mezerník otevřou
 * detail, čtečka slyší celý popis). Bloky jsou plné (--blk), stav nese ikona
 * + slovo a barevný proužek; obsah leží na závoji (g-veil), bez rozostření.
 */

import { state } from './state.js';
import { showLessonModal } from './modal.js';
import { updateLayoutPreference } from './layout-manager.js';
import { esc, abbreviateSubject, addLessonDescription, getLessonTimeClass, getTodayIndex } from './utils.js';
import {
    icon, KINDS, statusHtml, daySlots, slotLessons, timeRange, axisHours, startMin, endMin, fmtMin, hourRange,
    minutesOfDay, DAY_NAMES, DAY_SHORT, addDays, czDate, groupText, teacherShort, classOf, dayChangeEntries,
    lessonSentence, isThisWeek,
} from './rozvrh-core.js';
import { removalReason, czPlural } from './changes-core.js';

// AbortControllers for cleanup of event listeners
let swipeController = null;
let navigationController = null;
let daySwipeController = null;
/** Lekce vykreslených tlačítek (data-ref = index). */
let lessonRefs = [];
let itemRefs = []; // položky slotLessons ke stejným indexům (název pro čtečku)

/**
 * Cleanup all event listeners from previous layouts
 */
export function cleanupLayoutEventListeners() {
    for (const c of [swipeController, navigationController, daySwipeController]) if (c) c.abort();
    swipeController = null;
    navigationController = null;
    daySwipeController = null;
}

/** Cíl vykreslení: #timetable uvnitř .timetable-container. */
function target() {
    if (typeof document === 'undefined') return null;
    return document.getElementById('timetable') || document.querySelector('.timetable-container');
}

/** Pondělí zobrazeného týdne (bez importu timetable.js kvůli cyklu). */
function mondayOfShown() {
    if (state.selectedScheduleType === 'permanent') return null;
    const dated = (state.currentTimetableData || []).find(l => l && l.date && /^\d{4}-\d{2}-\d{2}$/.test(l.date));
    if (dated) {
        const [y, m, d] = dated.date.split('-').map(Number);
        return addDays(new Date(y, m - 1, d), -dated.day);
    }
    const now = new Date();
    const dow = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow) + (state.selectedScheduleType === 'next' ? 7 : 0));
    monday.setHours(0, 0, 0, 0);
    return monday;
}

// „Dnes“, čára „teď“ a zašednutí proběhlých hodin jen u týdne, do kterého
// dnešek opravdu patří: rozhoduje datum dat, ne přepínač Aktuální / Příští
// (dokument Actual může být po výpadku sběru ještě z minulého týdne).
const tracksTime = () => isThisWeek(mondayOfShown());
const isToday = (day) => day === getTodayIndex() && tracksTime();

/* ── obsah bloku hodiny ────────────────────────────────────────────────── */

/**
 * Co se o hodině ukáže podle druhu rozvrhu: u třídy učebna a vyučující,
 * u vyučujícího učebna a třída, u učebny třída a vyučující.
 */
function lessonParts(item) {
    const l = item.lesson;
    const type = state.selectedType;
    const cls = classOf(l);
    const teacher = teacherShort(l.teacher, state.teacherAbbreviationMap);
    const subject = l.subject || 'Neznámý předmět';
    let place = l.room || '';
    let who = teacher;
    if (type === 'Room') { place = cls; who = teacher; }
    else if (type === 'Teacher') { who = cls; }
    if (l.type === 'absent') { place = ''; who = ''; }
    const group = groupText(l.group);
    let note = '';
    if (item.before && item.kind === 'sub') {
        const b = item.before;
        const sameSubject = (b.subject || '') === (l.subject || '');
        const bt = teacherShort(b.teacher, state.teacherAbbreviationMap);
        note = `původně ${[sameSubject ? '' : abbreviateSubject(b.subject), bt].filter(Boolean).join(', ')}`;
    } else if (item.kind === 'cancel') {
        const reason = removalReason((l.changeInfo && l.changeInfo.description) || '');
        note = reason ? reason.charAt(0).toLowerCase() + reason.slice(1) : '';
    } else if (item.kind === 'room') {
        const m = /:\s*([^→]+?)\s*→\s*(.+)$/.exec((l.changeInfo && l.changeInfo.description) || '');
        if (m && m[1].trim() !== m[2].trim()) note = `původně ${m[1].trim()}`;
    }
    return { subject, short: abbreviateSubject(subject), place, who, group, note };
}

/**
 * Co blok ukazuje zkráceně: název pro čtečku tyto podoby obsahuje, aby šlo
 * tlačítko hlasem oslovit tím, co je vidět (WCAG 2.5.3 Label in Name).
 */
function shownParts(item) {
    const p = lessonParts(item);
    const teacher = state.selectedType !== 'Teacher' ? p.who : '';
    return { short: p.short, teacher, note: p.note };
}

/** Třídy a atributy bloku: proužek stavu, odpadlá hodina, čas (lesson-status.js). */
function lessonAttrs(item, day, base) {
    const l = item.lesson;
    const cancelled = item.kind === 'cancel' || item.kind === 'extra' && l.type === 'absent';
    const cls = [base, 'lesson', 'g-bar'];
    if (item.kind && KINDS[item.kind]) cls.push(`g-bar--${KINDS[item.kind].bar}`, `is-${item.kind}`);
    if (cancelled) cls.push('is-cancelled');
    let attrs = '';
    if (!cancelled && tracksTime()) {
        const timeClass = getLessonTimeClass(day, l.hour);
        if (timeClass) cls.push(timeClass);
        attrs += ` data-day="${day}" data-hour="${l.hour}" data-time-status=""`;
    }
    if (l.changed || l.type === 'removed' || l.type === 'absent') attrs += ' data-changed="true"';
    const ref = lessonRefs.push(l) - 1;
    itemRefs[ref] = item;
    attrs += ` data-ref="${ref}"`;
    return { cls: cls.join(' '), attrs };
}

/** Řádek se stavem: skupina, ikona + slovo, vyučující / třída. */
function metaLine(item, p, { withStatus = true } = {}) {
    const bits = [];
    if (p.group) bits.push(`<span class="ev-g">${esc(p.group)}</span>`);
    if (withStatus && item.kind) bits.push(statusHtml(item.kind));
    if (p.who) bits.push(`<span class="ev-w">${esc(p.who)}</span>`);
    return bits.join('');
}

/** Blok hodiny na časové ose (Den i Týden). */
function eventHtml(item, day, range, i, n, { compact = false } = {}) {
    const l = item.lesson;
    const p = lessonParts(item);
    const s = startMin(l.hour);
    const e = endMin(l.hour);
    const { cls, attrs } = lessonAttrs(item, day, 'ev');
    const title = compact || n > 1 || p.short === p.subject
        ? esc(n > 1 ? p.short : p.subject)
        : `<span class="fl">${esc(p.subject)}</span><span class="sh">${esc(p.short)}</span>`;
    const style = `--m:${s - range.start};--d:${e - s};--i:${i};--n:${n}`;
    return `<button type="button" class="${cls}${n > 1 ? ' is-split' : ''}" style="${style}"${attrs}>`
        + `<span class="ev-l1"><span class="ev-s">${title}</span>${p.place ? `<span class="ev-r">${esc(p.place)}</span>` : ''}</span>`
        + `<span class="ev-l2">${metaLine(item, p)}</span>`
        + (p.note ? `<span class="ev-l3">${esc(p.note)}</span>` : '')
        + '</button>';
}

/** Bloky jednoho dne. */
function dayEvents(slots, day, range, opts) {
    let html = '';
    for (const items of slots.values()) {
        items.forEach((item, i) => { html += eventHtml(item, day, range, i, items.length, opts); });
    }
    return html;
}

const gridLines = (range) => axisHours(range)
    .map(m => `<span class="tl-gl" style="--m:${m - range.start}" aria-hidden="true"></span>`).join('');

/** Zlatá čára „teď“ (pozici drží updateNowLines). */
const nowLine = (range, withPill) => `<span class="nowline" data-start="${range.start}" data-end="${range.end}" aria-hidden="true" hidden>${withPill ? '<span class="now-pill"></span>' : ''}</span>`;

function emptyHtml(title, text) {
    return `<div class="g-empty tt-empty g-veil">${icon('calendar')}<strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
}

function whoName() {
    const el = typeof document !== 'undefined' ? document.getElementById('valueDropdownLabel') : null;
    const name = el ? el.textContent.trim() : '';
    return state.selectedType === 'Class' && name ? `Třída ${name}` : (name || 'Tento rozvrh');
}

/** Kliknutí na hodinu otevře detail (delegace, jeden posluchač na vykreslení). */
function bindLessons(root) {
    if (!root || !root.querySelectorAll) return;
    if (navigationController) navigationController.abort();
    navigationController = new AbortController();
    const data = state.currentTimetableData;
    root.querySelectorAll('.lesson[data-ref]').forEach((btn) => {
        const lesson = lessonRefs[Number(btn.dataset.ref)];
        if (!lesson) return;
        const item = itemRefs[Number(btn.dataset.ref)] || { lesson, kind: '', before: null };
        addLessonDescription(btn, lessonSentence(item, shownParts(item)));
    });
    root.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.lesson[data-ref]');
        if (!btn || !root.contains(btn)) return;
        const lesson = lessonRefs[Number(btn.dataset.ref)];
        if (lesson) showLessonModal(lesson, { data, anchor: btn });
    }, { signal: navigationController.signal });
}

/* ── Den ───────────────────────────────────────────────────────────────── */

/**
 * Render Day Layout: one day as a real-time-scale timeline.
 */
export function renderDayLayout() {
    const root = target();
    if (!root) return;
    lessonRefs = [];
    itemRefs = [];

    const day = state.selectedDayIndex ?? 0;
    const slots = daySlots(state.currentTimetableData, day);
    const monday = mondayOfShown();
    const dayLabel = monday ? `${DAY_NAMES[day]} ${czDate(addDays(monday, day))}` : DAY_NAMES[day];

    if (!slots.size) {
        root.innerHTML = emptyHtml('Žádná výuka', `${whoName()} má ${monday ? `v den ${dayLabel}` : 'v tento den'} volno. Vyber jiný den v pásu nahoře.`);
        initDaySwipeNavigation('horizontal');
        return;
    }

    const range = timeRange([...slots.keys()]);
    const today = isToday(day);
    root.innerHTML = `<section class="tl g-veil${today ? ' is-today' : ''}" style="--range:${range.range}" aria-label="${esc(dayLabel)}">
        <div class="tl-axis" aria-hidden="true">
            ${axisHours(range).map(m => `<span class="tl-hl" style="--m:${m - range.start}">${fmtMin(m)}</span>`).join('')}
        </div>
        <div class="tl-body">
            ${gridLines(range)}
            ${dayEvents(slots, day, range)}
            ${today ? nowLine(range, true) : ''}
        </div>
    </section>`;

    bindLessons(root);
    updateNowLines();
    initDaySwipeNavigation('horizontal');
}

/** @deprecated Agenda and the single-day table became Den. */
export const renderAgendaLayout = renderDayLayout;
/** @deprecated */
export const renderSingleDayLayout = renderDayLayout;

/* ── Týden ─────────────────────────────────────────────────────────────── */

/**
 * Render Week Layout: five columns with a shared time axis (from the first
 * used lesson of the week, 0. hodina 7:10 included when used).
 */
export function renderWeekLayout() {
    const root = target();
    if (!root) return;
    lessonRefs = [];
    itemRefs = [];

    const data = state.currentTimetableData || [];
    const perDay = [0, 1, 2, 3, 4].map(d => daySlots(data, d));
    const hours = [...new Set(data.map(l => l.hour))];
    const range = timeRange(hours);
    if (!range) {
        root.innerHTML = emptyHtml('Žádná výuka', `${whoName()} nemá v tomto týdnu žádné hodiny. Zkus příští týden nebo stálý rozvrh.`);
        return;
    }
    const monday = mondayOfShown();

    const heads = perDay.map((slots, d) => {
        const date = monday ? addDays(monday, d) : null;
        const changes = dayChangeEntries(data.filter(l => l.day === d)).length;
        const today = isToday(d);
        return `<button type="button" class="wg-dh${today ? ' today' : ''}" data-day="${d}" title="Otevřít den ${esc(DAY_NAMES[d].toLowerCase())}"${today ? ' aria-current="date"' : ''}>
            <span class="wg-dn">${DAY_SHORT[d]}</span>${date ? `<span class="wg-date">${date.getDate()}</span>` : ''}
            ${changes ? `<small class="wg-chg">${icon('repeat-2')}${changes}<span class="vh"> ${czPlural(changes, ['změna', 'změny', 'změn']).replace(/^\d+ /, '')}</span></small>` : ''}
        </button>`;
    }).join('');

    const cols = perDay.map((slots, d) => {
        const date = monday ? addDays(monday, d) : null;
        const label = date ? `${DAY_NAMES[d]} ${czDate(date)}` : DAY_NAMES[d];
        const today = isToday(d);
        return `<section class="wg-col${today ? ' today' : ''}" aria-label="${esc(label)}">
            ${gridLines(range)}
            ${slots.size ? dayEvents(slots, d, range, { compact: false }) : '<p class="wg-free">volno</p>'}
            ${today ? nowLine(range, false) : ''}
        </section>`;
    }).join('');

    root.innerHTML = `<div class="wg g-veil" style="--range:${range.range}">
        <div class="wg-head"><span class="wg-corner" aria-hidden="true"></span>${heads}</div>
        <div class="wg-body">
            <div class="wg-axis" aria-hidden="true">
                ${axisHours(range).map(m => `<span class="tl-hl" style="--m:${m - range.start}">${fmtMin(m)}</span>`).join('')}
                ${perDay.some((_, d) => isToday(d)) ? `<span class="now-pill axis-now" data-start="${range.start}" data-end="${range.end}" hidden></span>` : ''}
            </div>
            ${cols}
        </div>
    </div>`;

    bindLessons(root);
    // Hlavička dne otevře rozvržení Den pro ten den (jako v Kalendáři)
    root.querySelectorAll('.wg-dh').forEach(btn => btn.addEventListener('click', async () => {
        const d = Number(btn.dataset.day);
        const { switchLayout } = await import('./layout-manager.js');
        state.selectedDayIndex = d;
        await switchLayout('day');
        const { createDaySelector } = await import('./timetable.js');
        createDaySelector();
    }, { signal: navigationController.signal }));
    updateNowLines();
}

/* ── teď ───────────────────────────────────────────────────────────────── */

/**
 * Zlatá čára „teď“ a štítek s časem na ose. Volá se po vykreslení a
 * periodicky (next-lesson.js); mimo rozsah dne se čára schová.
 */
export function updateNowLines(now = new Date()) {
    if (typeof document === 'undefined') return;
    const m = minutesOfDay(now);
    const label = fmtMin(Math.floor(m));
    document.querySelectorAll('.nowline, .axis-now').forEach(el => {
        const start = Number(el.dataset.start);
        const end = Number(el.dataset.end);
        const inside = m >= start && m <= end;
        el.hidden = !inside;
        if (!inside) return;
        el.style.setProperty('--m', String(m - start));
        const pill = el.classList.contains('axis-now') ? el : el.querySelector('.now-pill');
        if (pill) pill.textContent = label;
    });
}

/* ── Seznam ────────────────────────────────────────────────────────────── */

function listRowHtml(item, day, showTime) {
    const l = item.lesson;
    const p = lessonParts(item);
    const { cls, attrs } = lessonAttrs(item, day, 'ls-row');
    const s = startMin(l.hour);
    const e = endMin(l.hour);
    return `<li class="ls-item"><button type="button" class="${cls}"${attrs}>
        <span class="ls-time${showTime ? '' : ' is-cont'}"><span class="ls-t1">${s != null ? fmtMin(s) : `${l.hour}.`}</span><span>${e != null ? fmtMin(e) : ''}</span></span>
        <span class="ls-main">
            <span class="ls-l1"><span class="ls-s">${esc(p.subject)}</span>${p.place ? `<span class="ls-r">${esc(p.place)}</span>` : ''}</span>
            <span class="ls-l2">${metaLine(item, p)}</span>
            ${p.note ? `<span class="ls-l3">${esc(p.note)}</span>` : ''}
        </span>
    </button></li>`;
}

/**
 * Render Compact List Layout: the day's lessons as grouped rows.
 */
export function renderCompactListLayout() {
    const root = target();
    if (!root) return;
    lessonRefs = [];
    itemRefs = [];

    const day = state.selectedDayIndex ?? 0;
    const slots = daySlots(state.currentTimetableData, day);
    const monday = mondayOfShown();
    const dayLabel = monday ? `${DAY_NAMES[day]} ${czDate(addDays(monday, day))}` : DAY_NAMES[day];

    if (!slots.size) {
        root.innerHTML = emptyHtml('Žádná výuka', `${whoName()} má v tento den volno. Vyber jiný den v pásu nahoře.`);
        initDaySwipeNavigation('horizontal');
        return;
    }

    const hours = [...slots.keys()];
    let rows = '';
    for (let h = Math.min(...hours); h <= Math.max(...hours); h++) {
        const items = slots.get(h);
        if (!items || !items.length) {
            const s = startMin(h);
            rows += `<li class="ls-item"><div class="ls-row ls-free"><span class="ls-time"><span class="ls-t1">${s != null ? fmtMin(s) : `${h}.`}</span><span>${endMin(h) != null ? fmtMin(endMin(h)) : ''}</span></span><span class="ls-main"><span class="ls-s">Volno</span><span class="ls-l2">${h}. hodina</span></span></div></li>`;
            continue;
        }
        items.forEach((item, i) => { rows += listRowHtml(item, day, i === 0); });
    }
    root.innerHTML = `<section class="ls g-veil" aria-label="${esc(dayLabel)}"><ul class="ls-list" role="list">${rows}</ul></section>`;

    bindLessons(root);
    // Vždy od začátku dne: zapamatovaný posun z jiného dne skrýval první hodiny
    root.scrollTop = 0;
    initDaySwipeNavigation('horizontal');
}

/* ── Karty ─────────────────────────────────────────────────────────────── */

function cardLessonHtml(item, day, split) {
    const l = item.lesson;
    const p = lessonParts(item);
    const { cls, attrs } = lessonAttrs(item, day, split ? 'card-half' : 'card-main');
    return `<button type="button" class="${cls}"${attrs}>
        ${p.group ? `<span class="card-g">${esc(p.group)}</span>` : ''}
        <span class="card-s">${esc(split ? p.short : p.subject)}</span>
        ${p.place ? `<span class="card-r">${esc(p.place)}</span>` : ''}
        ${item.kind ? statusHtml(item.kind, { cls: 'card-st' }) : ''}
        ${p.who ? `<span class="card-w">${esc(p.who)}</span>` : ''}
        ${p.note ? `<span class="card-n">${esc(p.note)}</span>` : ''}
    </button>`;
}

/**
 * Render Card View Layout: one lesson per card, horizontal scroll-snap.
 */
export function renderCardLayout() {
    const root = target();
    if (!root) return;
    lessonRefs = [];
    itemRefs = [];

    const day = state.selectedDayIndex ?? 0;
    const slots = daySlots(state.currentTimetableData, day);

    if (!slots.size) {
        if (swipeController) { swipeController.abort(); swipeController = null; }
        root.innerHTML = emptyHtml('Žádná výuka', `${whoName()} má v tento den volno. Vyber jiný den v pásu nahoře.`);
        return;
    }

    const hours = [...slots.keys()];
    const list = [];
    for (let h = Math.min(...hours); h <= Math.max(...hours); h++) list.push(h);

    const prefs = (state.layoutPreferences && state.layoutPreferences['card-view']) || {};
    const index = Math.max(0, Math.min(prefs.cardIndex || 0, list.length - 1));

    const cards = list.map((h, i) => {
        const items = slots.get(h) || [];
        const head = `<span class="card-head"><span class="card-h">${h}. hodina</span><span class="card-t">${esc(hourRange(h))}</span></span>`;
        if (!items.length) {
            return `<li class="card card--free g-veil" data-card-index="${i}">${head}<span class="card-free">${icon('sun')}<span>Volno</span></span></li>`;
        }
        const body = items.length === 1
            ? cardLessonHtml(items[0], day, false)
            : `<span class="card-split">${items.map(it => cardLessonHtml(it, day, true)).join('')}</span>`;
        return `<li class="card g-veil" data-card-index="${i}">${head}${body}</li>`;
    }).join('');

    root.innerHTML = `<div class="cards">
        <ul class="cards-track" role="list" id="cardsTrack">${cards}</ul>
        <div class="cards-nav">
            <button type="button" class="g-circle sh-ctl" id="cardPrevBtn" aria-label="Předchozí hodina">${icon('chevron-left')}</button>
            <span class="cards-dots" aria-hidden="true">${list.map((_, i) => `<span class="card-dot${i === index ? ' active' : ''}"></span>`).join('')}</span>
            <span class="vh" id="cardPos" aria-live="polite"></span>
            <button type="button" class="g-circle sh-ctl" id="cardNextBtn" aria-label="Další hodina">${icon('chevron-right')}</button>
        </div>
    </div>`;

    bindLessons(root);
    initCardScroller(list.length, index);
}

function initCardScroller(total, index) {
    const track = typeof document !== 'undefined' ? document.getElementById('cardsTrack') : null;
    if (!track) return;
    if (swipeController) swipeController.abort();
    swipeController = new AbortController();
    const signal = swipeController.signal;
    const cards = [...track.children];
    const prev = document.getElementById('cardPrevBtn');
    const next = document.getElementById('cardNextBtn');
    const pos = document.getElementById('cardPos');

    const sync = (i) => {
        updateLayoutPreference('card-view', { cardIndex: i });
        document.querySelectorAll('.card-dot').forEach((d, k) => d.classList.toggle('active', k === i));
        if (prev) prev.disabled = i <= 0;
        if (next) next.disabled = i >= total - 1;
    };
    const go = (i, smooth = true) => {
        const card = cards[Math.max(0, Math.min(total - 1, i))];
        if (!card) return;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        track.scrollTo({ left: card.offsetLeft - track.offsetLeft - (track.clientWidth - card.offsetWidth) / 2, behavior: smooth && !reduce ? 'smooth' : 'auto' });
    };
    const current = () => {
        const mid = track.scrollLeft + track.clientWidth / 2;
        let best = 0;
        let dist = Infinity;
        cards.forEach((c, k) => {
            const center = c.offsetLeft - track.offsetLeft + c.offsetWidth / 2;
            if (Math.abs(center - mid) < dist) { dist = Math.abs(center - mid); best = k; }
        });
        return best;
    };

    if (prev) prev.addEventListener('click', () => { const i = current() - 1; go(i); if (pos) pos.textContent = `${i + 1}. karta z ${total}`; }, { signal });
    if (next) next.addEventListener('click', () => { const i = current() + 1; go(i); if (pos) pos.textContent = `${i + 1}. karta z ${total}`; }, { signal });
    let t = null;
    track.addEventListener('scroll', () => {
        clearTimeout(t);
        t = setTimeout(() => sync(current()), 80);
    }, { passive: true, signal });
    // Fokus na kartě mimo obraz ji posune do středu
    track.addEventListener('focusin', (e) => {
        const card = e.target.closest('.card');
        if (card) go(Number(card.dataset.cardIndex));
    }, { signal });

    sync(index);
    requestAnimationFrame(() => go(index, false));
}

/**
 * Show the card that contains `el` (used by the deep-link highlight).
 * @returns {boolean} true when a card was found
 */
export function showCardContaining(el) {
    const card = el && el.closest ? el.closest('.card') : null;
    const track = typeof document !== 'undefined' ? document.getElementById('cardsTrack') : null;
    if (!card || !track) return false;
    track.scrollTo({ left: card.offsetLeft - track.offsetLeft - (track.clientWidth - card.offsetWidth) / 2, behavior: 'auto' });
    return true;
}

/* ── přejetí prstem mezi dny ───────────────────────────────────────────── */

/**
 * Initialize day swipe navigation
 * @param {string} direction - 'horizontal' (Den, Seznam)
 */
function initDaySwipeNavigation(direction = 'horizontal') {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('timetableHost');
    if (!container || !container.addEventListener) return;

    if (daySwipeController) daySwipeController.abort();
    daySwipeController = new AbortController();
    const signal = daySwipeController.signal;

    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let swipeEnabled = true;

    // Přejetí mění den jen když obsah nejde posouvat stejným směrem
    const axisIsScrollable = () => (direction === 'vertical'
        ? container.scrollHeight > container.clientHeight + 1
        : container.scrollWidth > container.clientWidth + 1);

    container.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isDragging = true;
        swipeEnabled = !axisIsScrollable();
    }, { passive: true, signal });

    container.addEventListener('touchend', async (e) => {
        if (!isDragging) return;
        isDragging = false;
        if (!swipeEnabled) return;
        const diffX = startX - e.changedTouches[0].clientX;
        const diffY = startY - e.changedTouches[0].clientY;
        if (Math.abs(diffX) > 60 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
            const newDay = Math.max(0, Math.min(4, (state.selectedDayIndex ?? 0) + (diffX > 0 ? 1 : -1)));
            if (newDay === state.selectedDayIndex) return;
            const { selectDay } = await import('./timetable.js');
            selectDay(newDay);
        }
    }, { passive: true, signal });
}

export { slotLessons };
