/**
 * Přehled (návrh G, vzor Apple Počasí): domov záložky Rozvrh na mobilu
 * a karta „teď“ v postranním panelu na počítači.
 *
 *  - hrdina: obří učebna (u učitele učebna, u učebny třída), předmět,
 *    „zbývá N min“ a další hodina; mimo vyučování „Další: zítra 8:00 …“;
 *  - modul Dnes: věta o změnách a vodorovný pás hodin;
 *  - modul Týden: řádky dnů s pruhem hodin a tečkou „teď“, řádek otevře Den;
 *  - dlaždice Změny a Volné učebny.
 *
 * Přehled je vždy o „teď“: čte aktuální týden (a o víkendu příští) bez
 * ohledu na přepínač Stálý / Aktuální / Příští v Dni.
 */

import { state } from './state.js';
import { fetchTimetable, fetchAggregate } from './api.js';
import { getDropdownValue } from './dropdown.js';
import { esc, getTodayIndex, getMondayOfWeek, abbreviateSubject, addLessonDescription } from './utils.js';
import { nowState, dayTimeline, progressPct, minutesUntil } from './next-lesson.js';
import {
    icon, KINDS, statusHtml, daySlots, startMin, endMin, fmtMin, hourRange, minutesOfDay, DAY_NAMES, DAY_SHORT,
    addDays, czDate, czWeekdayIn, weekTitle, weekMonday, dayChangeEntries, changesSentence, groupText, classOf,
    teacherShort, joinCz,
} from './rozvrh-core.js';
import { czPlural } from './changes-core.js';
import { rasterHours, freeRoomsAt, defaultRoomSlots, parseHiddenRooms } from './rooms-core.js';

const $ = (id) => document.getElementById(id);

const model = {
    key: '',          // type|id, pro který jsou data načtená
    actual: null,     // lekce aktuálního týdne
    next: null,       // lekce příštího týdne (když je potřeba)
    loading: null,    // Promise načítání
    signature: '',    // co je teď / další (změna → překreslit pás a týden)
    rooms: null,      // { count, names, when }
};

const SESSION_DATE = () => getMondayOfWeek(0).toISOString().split('T')[0];

function cleanLessons(data) {
    return (data || []).filter(l => !(l.type === 'absent' && /^[a-zá-ž]{2,3}\s\d{1,2}\.\d{1,2}\.?$/i.test(l.subject || '') && !l.teacher));
}

async function loadData(force = false) {
    const type = state.selectedType;
    const id = getDropdownValue();
    if (!id) return false;
    const key = `${type}|${id}`;
    if (!force && model.key === key && model.actual) return true;
    if (model.loading && model.loadingKey === key) return model.loading;

    model.loadingKey = key;
    model.loading = (async () => {
        try {
            const actual = cleanLessons(await fetchTimetable(type, id, 'actual', SESSION_DATE()));
            let next = null;
            const st = nowState(actual);
            if (st.kind === 'weekend' || !st.next || st.next.nextWeek) {
                try { next = cleanLessons(await fetchTimetable(type, id, 'next', SESSION_DATE())); } catch { next = null; }
            }
            if (`${state.selectedType}|${getDropdownValue()}` !== key) return false; // vybral se jiný rozvrh
            model.key = key;
            model.actual = actual;
            model.next = next;
            model.signature = '';
            return true;
        } catch (err) {
            console.warn('Overview data unavailable:', err?.message || err);
            return false;
        } finally {
            model.loading = null;
        }
    })();
    return model.loading;
}

/* ── texty ──────────────────────────────────────────────────────────────── */

const monday = () => getMondayOfWeek(0);

/** Datum dne `day` v týdnu (příští týden: +7). */
function dateOf(day, nextWeek) {
    const base = weekMonday(nextWeek ? model.next : model.actual, getMondayOfWeek(nextWeek ? 1 : 0));
    return addDays(base || monday(), day);
}

/** „za 30 min“, „v 9:45“, „zítra v 8:00“, „ve čtvrtek v 8:00“. */
function whenText(next, now, { short = false } = {}) {
    if (!next) return '';
    const t = fmtMin(next.start);
    if (next.dayOffset === 0) {
        const n = minutesUntil(next.start, now);
        return n <= 90 && !short ? `za ${n} min` : `v ${t}`;
    }
    if (next.dayOffset === 1) return `zítra v ${t}`;
    return `${czWeekdayIn(dateOf(next.day, next.nextWeek))} v ${t}`;
}

/** Hlavní místo hodiny: učebna (třída, vyučující) nebo třída (učebna). */
const placeOf = (lesson) => (state.selectedType === 'Room' ? classOf(lesson) : lesson.room) || '';
const subjOf = (items) => (items[0] ? items[0].lesson.subject || '' : '');

/** Krátký popis hodiny pro věty („Fyzika v U11“, u učebny „Fyzika, 2.A“). */
function lessonPhrase(items) {
    const l = items[0] && items[0].lesson;
    if (!l) return '';
    const places = [...new Set(items.map(it => placeOf(it.lesson)).filter(Boolean))];
    if (!places.length) return l.subject;
    if (state.selectedType === 'Room') return `${l.subject}, ${joinCz(places)}`;
    return `${l.subject} v ${joinCz(places)}`;
}

/** Obří text: učebna / třída, u dělené hodiny obě vedle sebe se skupinou. */
function bigHtml(items) {
    const places = items.map(it => ({ place: placeOf(it.lesson), group: groupText(it.lesson.group) }));
    const distinct = [...new Set(places.map(p => p.place))];
    if (items.length > 1 && distinct.length > 1) {
        return `<span class="ov-big ov-big--split">${places.map(p => `<span><span class="ov-big-room">${esc(p.place || '?')}</span>${p.group ? `<small>${esc(p.group)}</small>` : ''}</span>`).join('')}</span>`;
    }
    return `<span class="ov-big">${esc(distinct[0] || '–')}</span>`;
}

/** Podtitulek u vyučujícího a učebny: s kým / kdo. */
function whoLine(items) {
    const l = items[0] && items[0].lesson;
    if (!l) return '';
    if (state.selectedType === 'Teacher') return [...new Set(items.map(it => classOf(it.lesson)).filter(Boolean))].join(', ');
    if (state.selectedType === 'Room') return teacherShort(l.teacher, state.teacherAbbreviationMap);
    return '';
}

/* ── hrdina ─────────────────────────────────────────────────────────────── */

function heroHtml(st, now) {
    const parts = { eyebrow: '', subj: '', big: '', left: '', next: '' };
    const nextLine = (n) => `Další: ${whenText(n, now, { short: true })} ${lessonPhrase(n.items)}`;
    switch (st.kind) {
        case 'lesson': {
            const c = st.current;
            parts.eyebrow = `Teď, ${c.hour}. hodina`;
            parts.subj = [subjOf(c.items), whoLine(c.items)].filter(Boolean).join(', ');
            parts.big = bigHtml(c.items);
            parts.left = `zbývá ${minutesUntil(c.end, now)} min`;
            if (st.next && st.next.dayOffset === 0) {
                const when = whenText(st.next, now);
                // „Další Fyzika v U11 za 30 min“, ale „Další v 12:35 Anglický jazyk v U11“
                parts.next = when.startsWith('za ') ? `Další ${lessonPhrase(st.next.items)} ${when}` : `Další ${when} ${lessonPhrase(st.next.items)}`;
            }
            else parts.next = 'Poslední hodina dne';
            break;
        }
        case 'break':
        case 'before': {
            const n = st.next;
            parts.eyebrow = st.cancelledNow ? `${st.cancelledNow.hour}. hodina odpadá` : (st.kind === 'before' ? `Dnes od ${fmtMin(n.start)}` : 'Přestávka');
            parts.subj = [subjOf(n.items), whoLine(n.items)].filter(Boolean).join(', ');
            parts.big = bigHtml(n.items);
            const mins = minutesUntil(n.start, now);
            parts.left = mins <= 90 ? `začíná za ${mins} min` : `začíná v ${fmtMin(n.start)}`;
            parts.next = `${n.hour}. hodina, ${hourRange(n.hour)}`;
            break;
        }
        case 'after':
            parts.eyebrow = 'Dnešní výuka skončila';
            parts.big = '<span class="ov-big">Volno</span>';
            parts.next = st.next ? nextLine(st.next) : '';
            break;
        case 'weekend':
            parts.eyebrow = 'Víkend';
            parts.big = '<span class="ov-big">Volno</span>';
            parts.next = st.next ? nextLine(st.next) : '';
            break;
        default:
            parts.eyebrow = 'Tento týden';
            parts.big = '<span class="ov-big">Volno</span>';
            parts.next = 'V rozvrhu teď nejsou žádné hodiny.';
    }
    return `<p class="ov-eyebrow">${esc(parts.eyebrow)}</p>
        ${parts.subj ? `<p class="ov-subj">${esc(parts.subj)}</p>` : ''}
        <p class="ov-bigline">${parts.big}</p>
        ${parts.left ? `<p class="ov-left">${esc(parts.left)}</p>` : ''}
        ${parts.next ? `<p class="ov-next">${esc(parts.next)}</p>` : ''}`;
}

/* ── karta „teď“ v panelu (počítač) ─────────────────────────────────────── */

function nowCardHtml(st, now) {
    const k = (text) => `<h2 class="now-k" id="nowCardTitle">${icon('clock')}<span>${esc(text)}</span></h2>`;
    const nx = (n, lead) => (n ? `<p class="now-nx">${esc(lead)} ${esc(whenText(n, now, { short: true }))} <strong>${esc(subjOf(n.items))}</strong>${placeOf(n.items[0].lesson) ? ` ${state.selectedType === 'Room' ? 's' : 'v'} ${esc(joinCz([...new Set(n.items.map(it => placeOf(it.lesson)).filter(Boolean))]))}` : ''}</p>` : '');
    if (st.kind === 'lesson') {
        const c = st.current;
        const places = [...new Set(c.items.map(it => placeOf(it.lesson)).filter(Boolean))];
        return `${k(`teď, ${c.hour}. hodina`)}
            <p class="now-s">${esc(subjOf(c.items))}</p>
            <p class="now-big">${esc(places.join(' ') || '–')}</p>
            <div class="now-prog" aria-hidden="true"><i style="width:${progressPct(c.start, c.end, now).toFixed(1)}%"></i></div>
            <p class="now-left">zbývá ${minutesUntil(c.end, now)} min</p>
            ${st.next && st.next.dayOffset === 0 ? nx(st.next, 'Další') : '<p class="now-nx">Poslední hodina dne</p>'}`;
    }
    if (st.kind === 'break' || st.kind === 'before') {
        const n = st.next;
        const places = [...new Set(n.items.map(it => placeOf(it.lesson)).filter(Boolean))];
        return `${k(st.kind === 'before' ? 'dnes začíná' : 'přestávka')}
            <p class="now-s">${esc(subjOf(n.items))}</p>
            <p class="now-big">${esc(places.join(' ') || '–')}</p>
            <p class="now-left">${n.hour}. hodina ${esc(whenText(n, now))}</p>`;
    }
    if (st.kind === 'after' || st.kind === 'weekend') {
        return `${k(st.kind === 'weekend' ? 'víkend' : 'dnes už nic')}
            <p class="now-big now-big--word">Volno</p>
            ${nx(st.next, 'Další')}`;
    }
    return `${k('tento týden')}<p class="now-big now-big--word">Volno</p>`;
}

/* ── modul Dnes ─────────────────────────────────────────────────────────── */

function stripHtml(st, now) {
    const day = st.today;
    const slots = daySlots(model.actual, day);
    if (!slots.size) return '';
    const m = minutesOfDay(now);
    let html = '';
    let ref = 0;
    model.stripRefs = [];
    for (const [hour, items] of slots) {
        const s = startMin(hour);
        const e = endMin(hour);
        const cur = st.current && st.current.hour === hour;
        const live = items.filter(it => it.kind !== 'cancel');
        const cancelled = !live.length;
        const kindItem = items.find(it => it.kind) || null;
        const kind = cancelled ? 'cancel' : (kindItem ? kindItem.kind : '');
        const first = (live[0] || items[0]).lesson;
        const places = [...new Set(items.map(it => placeOf(it.lesson)).filter(Boolean))];
        const split = items.length > 1;
        const past = e != null && m >= e;
        const k = KINDS[kind];
        model.stripRefs.push({ items, hour });
        html += `<li><button type="button" class="ov-h lesson${cur ? ' cur' : ''}${cancelled ? ' is-cancelled' : ''}${past ? ' is-past' : ''}${split ? ' is-split' : ''}" data-strip="${ref++}"${first.changed || cancelled ? ' data-changed="true"' : ''}>
            <span class="t">${cur ? 'Teď' : fmtMin(s)}</span>
            <span class="a">${esc(abbreviateSubject(first.subject))}</span>
            <span class="r${places.join(', ').length > 5 ? ' r--long' : ''}">${esc(places.join(', ') || '–')}</span>
            <span class="s">${k ? icon(k.icon, `ico-${k.bar}`) : ''}</span>
        </button></li>`;
    }
    return `<ul class="ov-strip" role="list" id="ovStrip">${html}</ul>`;
}

function todayHtml(st, now) {
    if (st.today < 0) return '';
    const dayLessons = (model.actual || []).filter(l => l.day === st.today);
    if (!dayLessons.length) {
        return `<section class="ov-mod g-veil g-mod" aria-labelledby="ovTodayTitle">
            <h2 class="g-mod-head" id="ovTodayTitle">${icon('calendar')}Dnes</h2>
            <p class="ov-sum">${icon('info')}<span>Dnes nemáš žádnou hodinu.</span></p></section>`;
    }
    const sentence = changesSentence(dayChangeEntries(dayLessons), 'Dnes');
    return `<section class="ov-mod g-veil g-mod" aria-labelledby="ovTodayTitle">
        <h2 class="vh" id="ovTodayTitle">Dnešní hodiny</h2>
        <p class="ov-sum">${icon('info')}<span>${esc(sentence)}</span></p>
        ${stripHtml(st, now)}
    </section>`;
}

/* ── modul Týden ────────────────────────────────────────────────────────── */

function weekRowsHtml(st, now) {
    const weekend = st.today < 0;
    const data = weekend && model.next ? model.next : model.actual;
    const nextWeek = weekend && !!model.next;
    const mon = weekMonday(data, getMondayOfWeek(nextWeek ? 1 : 0));
    const m = minutesOfDay(now);
    let rows = '';
    for (let d = 0; d < 5; d++) {
        const tl = dayTimeline(data, d);
        const date = mon ? addDays(mon, d) : null;
        const today = !nextWeek && d === st.today;
        const label = today ? 'Dnes' : DAY_SHORT[d];
        const changes = dayChangeEntries((data || []).filter(l => l.day === d)).length;
        const chg = changes ? `<span class="wr-ic">${icon('repeat-2')}<span>${changes}</span><span class="vh"> ${czPlural(changes, ['změna', 'změny', 'změn']).replace(/^\d+ /, '')}</span></span>` : '<span class="wr-ic"></span>';
        const full = `${DAY_NAMES[d]}${date ? ` ${czDate(date)}` : ''}`;
        if (!tl.length) {
            rows += `<li><button type="button" class="wr${today ? ' today' : ''}" data-day="${d}" data-next="${nextWeek}" title="${esc(full)}">
                <span class="wr-d">${label}</span>${chg}<span class="wr-none">žádná výuka</span></button></li>`;
            continue;
        }
        const start = tl[0].start;
        const end = tl[tl.length - 1].end;
        let bar = '';
        let prevEnd = start;
        for (const slot of tl) {
            if (slot.start > prevEnd) bar += `<span class="wr-gap" style="flex:${slot.start - prevEnd}"></span>`;
            const kinds = slot.all.map(it => it.kind).filter(Boolean);
            const k = slot.cancelled ? 'cancel' : (kinds.find(x => x !== 'cancel') || '');
            bar += `<i class="${k ? `k-${KINDS[k].bar}${k === 'cancel' ? ' k-x' : ''}` : ''}" style="flex:${slot.end - slot.start}"></i>`;
            prevEnd = slot.end;
        }
        const showDot = today && m >= start && m <= end;
        const dot = showDot ? `<span class="wr-dot" style="--at:${(((m - start) / (end - start)) * 100).toFixed(1)}%"></span>` : '';
        const lessons = tl.filter(s => !s.cancelled).length;
        rows += `<li><button type="button" class="wr${today ? ' today' : ''}" data-day="${d}" data-next="${nextWeek}" title="${esc(full)}">
            <span class="wr-d">${label}</span>${chg}
            <span class="vh">, ${esc(full)}, ${czPlural(lessons, ['hodina', 'hodiny', 'hodin'])}, od</span>
            <span class="wr-t1">${fmtMin(start)}</span><span class="vh"> do</span>
            <span class="wr-bar" aria-hidden="true">${bar}${dot}</span>
            <span class="wr-t2">${fmtMin(end)}</span>
        </button></li>`;
    }
    const title = weekTitle(mon);
    return `<section class="ov-mod g-veil g-mod ov-week" aria-labelledby="ovWeekTitle">
        <h2 class="g-mod-head" id="ovWeekTitle">${icon('calendar-days')}${esc(title)}</h2>
        <ul class="ov-weekrows" role="list">${rows}</ul>
    </section>`;
}

/* ── dlaždice ───────────────────────────────────────────────────────────── */

function changesLink() {
    const id = getDropdownValue();
    if (state.selectedType === 'Class' && id) return { href: `/?view=changes&class=${encodeURIComponent(id)}`, params: { class: id } };
    if (state.selectedType === 'Teacher' && id) return { href: `/?view=changes&teacher=${encodeURIComponent(id)}`, params: { teacher: id } };
    return { href: '/?view=changes', params: {} };
}

function tilesHtml(st) {
    const today = st.today;
    const all = model.actual || [];
    const todayCount = today >= 0 ? dayChangeEntries(all.filter(l => l.day === today)).length : 0;
    let week = 0;
    for (let d = 0; d < 5; d++) week += dayChangeEntries(all.filter(l => l.day === d)).length;
    const link = changesLink();
    const rooms = model.rooms;
    const roomsFoot = rooms
        ? (rooms.count ? `${rooms.when} ${joinCz(rooms.names.slice(0, 3))}${rooms.count > 3 ? ` a další ${rooms.count - 3}` : ''}` : `${rooms.when} žádná`)
        : 'podle rozvrhu';
    return `<div class="ov-tiles">
        <a class="ov-tile g-veil" href="${esc(link.href)}" data-go="changes">
            <span class="g-mod-head">${icon('repeat-2')}Změny</span>
            <span class="ov-tile-big">${today >= 0 ? todayCount : week}</span>
            <span class="ov-tile-foot">${today >= 0 ? `dnes, tento týden ${week}` : 'tento týden'}</span>
        </a>
        <a class="ov-tile g-veil" href="/?view=rooms" data-go="rooms">
            <span class="g-mod-head">${icon('door-open')}Volné učebny</span>
            <span class="ov-tile-big">${rooms ? rooms.count : '–'}</span>
            <span class="ov-tile-foot">${esc(roomsFoot)}</span>
        </a>
    </div>`;
}

async function loadRooms(now = new Date()) {
    try {
        const actual = await fetchAggregate('freeRooms_Actual');
        const agg = actual && actual.data;
        if (!agg) { model.rooms = null; return; }
        const { primary } = defaultRoomSlots(now, rasterHours(agg));
        if (!primary) { model.rooms = null; return; }
        let src = agg;
        if (primary.week === 'Next') {
            const next = await fetchAggregate('freeRooms_Next').catch(() => null);
            src = next && next.data;
        }
        let hidden = [];
        try { hidden = parseHiddenRooms(localStorage.getItem('hiddenRooms')); } catch { /* ignore */ }
        const res = freeRoomsAt(src, primary.day, primary.hour, hidden);
        if (!res.known) { model.rooms = null; return; }
        const t = startMin(primary.hour);
        const when = primary.when === 'now' ? 'teď'
            : primary.when === 'upcoming' ? `v ${fmtMin(t)}`
                : `${primary.week === 'Next' ? 'v pondělí' : 'zítra'} v ${fmtMin(t)}`;
        const names = res.rooms.map(r => r.name).sort((a, b) => a.localeCompare(b, 'cs', { numeric: true }));
        model.rooms = { count: names.length, names, when };
    } catch {
        model.rooms = null;
    }
}

/* ── kostra při načítání ───────────────────────────────────────────────── */

function skeletonHtml() {
    return `<div class="ov-hero ov-hero--skel" aria-hidden="true">
            <span class="g-skel sk-line" style="--w:30%"></span><span class="g-skel sk-line" style="--w:45%"></span>
            <span class="g-skel ov-skel-big"></span><span class="g-skel sk-line" style="--w:35%"></span></div>
        <div class="ov-mod g-veil g-mod ov-skel" aria-hidden="true"><span class="g-skel sk-line" style="--w:85%"></span><span class="g-skel sk-line" style="--w:60%"></span><span class="ov-skel-strip">${'<span class="g-skel"></span>'.repeat(5)}</span></div>
        <div class="ov-mod g-veil g-mod ov-skel" aria-hidden="true">${'<span class="g-skel sk-line"></span>'.repeat(5)}</div>`;
}

/* ── vykreslení ─────────────────────────────────────────────────────────── */

function renderHero(st, now) {
    const hero = $('ovHero');
    if (hero) hero.innerHTML = heroHtml(st, now);
    const card = $('nowCard');
    if (card) {
        card.innerHTML = nowCardHtml(st, now);
        card.hidden = false;
    }
}

function renderAll(st, now, { keepScroll = true } = {}) {
    const ov = $('overview');
    if (!ov) return;
    const strip = $('ovStrip');
    const scroll = strip && keepScroll ? strip.scrollLeft : null;
    ov.innerHTML = `<section class="ov-hero" id="ovHero" aria-labelledby="ovHeroLabel">
            <h2 class="vh" id="ovHeroLabel">Teď</h2>
            ${heroHtml(st, now)}
        </section>
        ${todayHtml(st, now)}
        ${weekRowsHtml(st, now)}
        ${tilesHtml(st)}`;
    const card = $('nowCard');
    if (card) { card.innerHTML = nowCardHtml(st, now); card.hidden = false; }

    // Popisy hodin pro čtečku (celý název, vyučující, stav)
    ov.querySelectorAll('.ov-h[data-strip]').forEach(btn => {
        const ref = model.stripRefs[Number(btn.dataset.strip)];
        if (ref && ref.items[0]) addLessonDescription(btn, ref.items.length > 1 ? { ...ref.items[0].lesson, group: null, subject: `${ref.items[0].lesson.subject}, dělená hodina` } : ref.items[0].lesson);
    });

    // Pás hodin: aktuální hodina vidět (nebo poslední pozice)
    const newStrip = $('ovStrip');
    if (newStrip) {
        if (scroll !== null) newStrip.scrollLeft = scroll;
        else {
            const cur = newStrip.querySelector('.cur') || newStrip.querySelector('.ov-h:not(.is-past)');
            if (cur) newStrip.scrollLeft = Math.max(0, cur.parentElement.offsetLeft - 8);
        }
    }
}

let wired = false;
function wire() {
    if (wired) return;
    const ov = $('overview');
    if (!ov) return;
    wired = true;
    // Nově načtený rozvrh (výběr, obnovení dat): přehled si aktuální týden načte znovu
    document.addEventListener('timetableloaded', () => { model.key = ''; });
    // Zúžení okna na mobil: přehled (a dlaždice učeben) hned, ne až za 15 s
    const mq = window.matchMedia && window.matchMedia('(max-width: 1079px)');
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (mq.matches) tickOverview(); });
    ov.addEventListener('click', async (e) => {
        const strip = e.target.closest('.ov-h[data-strip]');
        if (strip) {
            const ref = model.stripRefs && model.stripRefs[Number(strip.dataset.strip)];
            if (!ref) return;
            if (ref.items.length > 1) {
                const { openDay } = await import('./shell.js');
                openDay(getTodayIndex(), { schedule: 'actual', from: strip });
            } else {
                const { showLessonModal } = await import('./modal.js');
                showLessonModal(ref.items[0].lesson, { data: model.actual });
            }
            return;
        }
        const row = e.target.closest('.wr[data-day]');
        if (row) {
            const { openDay } = await import('./shell.js');
            openDay(Number(row.dataset.day), { schedule: row.dataset.next === 'true' ? 'next' : 'actual', from: row });
            return;
        }
        const tile = e.target.closest('a[data-go]');
        if (tile && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            const { showView } = await import('./view-router.js');
            showView(tile.dataset.go, tile.dataset.go === 'changes' ? changesLink().params : {});
        }
    });
}

/**
 * Obnoví přehled a kartu „teď“. Při změně dat (jiný rozvrh, nové načtení)
 * vykreslí všechno, jinak jen hrdinu, kartu, tečku týdne a čáry „teď“.
 */
export async function tickOverview({ force = false } = {}) {
    wire();
    const now = new Date();
    const ov = $('overview');
    const type = state.selectedType;
    const id = getDropdownValue();
    if (!id) return;
    const key = `${type}|${id}`;
    const fresh = force || model.key !== key || !model.actual;
    if (fresh) {
        if (ov && !ov.querySelector('.ov-hero')) ov.innerHTML = skeletonHtml();
        const ok = await loadData(force);
        if (!ok) {
            if (ov && !model.actual) ov.innerHTML = `<div class="g-empty g-veil ov-error">${icon('wifi-off')}<strong>Přehled teď nejde načíst</strong><span>Zkontroluj připojení a zkus to znovu, nebo si otevři den v pásu týdne.</span></div>`;
            return;
        }
    }
    // Dlaždice volných učeben je jen v přehledu (mobil): agregát se čte až tam
    const mobile = !!window.matchMedia && window.matchMedia('(max-width: 1079px)').matches;
    if (mobile && (fresh || !model.roomsAt || Date.now() - model.roomsAt > 5 * 60 * 1000)) {
        model.roomsAt = Date.now();
        await loadRooms(now);
        if (!fresh) model.signature = ''; // dlaždice se překreslí
    }
    const st = nowState(model.actual, { now, nextWeek: model.next });
    const sig = `${st.kind}|${st.current ? st.current.hour : ''}|${st.next ? `${st.next.day}-${st.next.hour}` : ''}|${Math.floor(minutesOfDay(now) / 5)}`;
    const focusInside = ov && ov.contains(document.activeElement) && document.activeElement !== ov;
    if (fresh || (sig !== model.signature && !focusInside) || !$('ovHero')) {
        renderAll(st, now, { keepScroll: !fresh });
        model.signature = sig;
    } else {
        renderHero(st, now);
    }
    import('./layout-renderers.js').then(m => m.updateNowLines(now)).catch(() => {});
    updateNavCounts();
}

/** Počet změn týdne u odkazu Změny (lišta i panel). */
export function updateNavCounts() {
    const badge = $('navChangesCount');
    const sr = $('navChangesCountSr');
    if (!badge) return;
    const all = model.actual || [];
    let week = 0;
    for (let d = 0; d < 5; d++) week += dayChangeEntries(all.filter(l => l.day === d)).length;
    badge.textContent = week ? String(week) : '';
    badge.hidden = !week;
    if (sr) sr.textContent = week ? `, ${czPlural(week, ['změna', 'změny', 'změn'])} v rozvrhu tento týden` : '';
}

/** Nový rozvrh nebo obnovená data: přehled načte aktuální týden znovu. */
export function invalidateOverview() {
    model.key = '';
    model.actual = null;
    model.next = null;
}

export { statusHtml };
