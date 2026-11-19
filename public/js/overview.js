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
import { nowState, dayTimeline, slotGroups, progressPct, minutesUntil } from './next-lesson.js';
import {
    icon, KINDS, statusHtml, daySlots, startMin, endMin, fmtMin, hourRange, minutesOfDay, DAY_NAMES, DAY_SHORT,
    addDays, czDate, czWeekdayIn, weekTitle, weekMonday, dayChangeEntries, changesSentence, groupText, classOf,
    teacherShort, joinCz, weekOffset, slotSentence,
} from './rozvrh-core.js';
import { czPlural } from './changes-core.js';
import { rasterHours, freeRoomsAt, defaultRoomSlots, parseHiddenRooms } from './rooms-core.js';

const $ = (id) => document.getElementById(id);

const model = {
    key: '',          // type|id|pondělí, pro který jsou data načtená ('' = načíst znovu)
    dataKey: '',      // type|id, kterému patří data v `actual` (i když se mají načíst znovu)
    actual: null,     // lekce aktuálního týdne
    sched: 'actual',  // ze kterého dokumentu `actual` je (po výpadku sběru může být tento týden v Next)
    stale: '',        // '' | 'past' (minulý týden) | 'old' (starší) | 'other': data nejsou z tohoto týdne
    next: null,       // lekce příštího týdne (když je potřeba)
    loading: null,    // Promise načítání
    signature: '',    // co je teď / další (změna → překreslit pás a týden)
    rooms: null,      // { count, names, when }
};

const SESSION_DATE = () => getMondayOfWeek(0).toISOString().split('T')[0];

function cleanLessons(data) {
    return (data || []).filter(l => !(l.type === 'absent' && /^[a-zá-ž]{2,3}\s\d{1,2}\.\d{1,2}\.?$/i.test(l.subject || '') && !l.teacher));
}

/** Klíč vybraného rozvrhu; pondělí je v něm proto, aby se v novém týdnu načetlo znovu. */
const dataKeyOf = () => `${state.selectedType}|${getDropdownValue()}`;
const keyOf = () => `${dataKeyOf()}|${SESSION_DATE()}`;

async function loadData(force = false) {
    const type = state.selectedType;
    const id = getDropdownValue();
    if (!id) return false;
    const key = keyOf();
    if (!force && model.key === key && model.actual) return true;
    if (model.loading && model.loadingKey === key) return model.loading;

    model.loadingKey = key;
    model.loading = (async () => {
        try {
            const fetchNext = async () => {
                try { return cleanLessons(await fetchTimetable(type, id, 'next', SESSION_DATE())); } catch { return null; }
            };
            let actual = cleanLessons(await fetchTimetable(type, id, 'actual', SESSION_DATE()));
            let next = null;
            let sched = 'actual';
            let stale = '';
            // Datum dat: dokument Actual může být z minulého týdne (výpadek sběru přes
            // víkend, okno po půlnoci, stará kopie offline). Tento týden je pak v Next;
            // když ani tam není, přehled to řekne a nic nevydává za dnešek.
            const offset = weekOffset(actual);
            if (offset !== null && offset !== 0) {
                const other = await fetchNext();
                if (other && weekOffset(other) === 0) {
                    actual = other;
                    sched = 'next';
                } else {
                    stale = offset === -1 ? 'past' : offset < -1 ? 'old' : 'other';
                }
            } else {
                const st = nowState(actual);
                if (st.kind === 'weekend' || !st.next || st.next.nextWeek) next = await fetchNext();
            }
            if (keyOf() !== key) return false; // vybral se jiný rozvrh
            model.key = key;
            model.dataKey = `${type}|${id}`;
            model.actual = actual;
            model.sched = sched;
            model.stale = stale;
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
const uniq = (list) => [...new Set(list.filter(Boolean))];
const hoursLabel = (ev) => (ev.from === ev.to ? `${ev.from}. hodina` : `${ev.from}.–${ev.to}. hodina`);

/**
 * Předmět slotu. U dělené hodiny s různými předměty má každý předmět svou
 * skupinu („1. sk Matematika, 2. sk Fyzika“), aby se předmět jedné skupiny
 * nevztahoval na učebnu druhé.
 */
function subjText(slot) {
    const g = slotGroups(slot);
    const subjects = uniq(g.live.map(x => x.lesson.subject));
    if (subjects.length <= 1) return subjects[0] || '';
    return g.live.map(x => [x.group, x.lesson.subject].filter(Boolean).join(' ')).join(', ');
}

/** „1. sk odpadá“ / „1. sk: Exkurze“ pro skupiny, které hodinu nemají (jinak ''). */
function offText(slot) {
    const g = slotGroups(slot);
    if (!g.split) return '';
    return joinCz(g.off.map(x => (x.lesson.type === 'absent' && x.lesson.subject
        ? [x.group, x.lesson.subject].filter(Boolean).join(': ')
        : [x.group, 'odpadá'].filter(Boolean).join(' '))));
}

/** Krátký popis hodiny pro věty („Fyzika v U11“, u učebny „Fyzika, 2.A“). */
function lessonPhrase(slot) {
    const g = slotGroups(slot);
    if (!g.live.length) return '';
    const room = state.selectedType === 'Room';
    const one = (subject, places, group) => {
        const where = places.length ? (room ? `, ${joinCz(places)}` : ` v ${joinCz(places)}`) : '';
        return `${subject}${where}${group ? ` (${group})` : ''}`;
    };
    const subjects = uniq(g.live.map(x => x.lesson.subject));
    const off = offText(slot);
    // Skupiny se vypisují, když se liší předmětem nebo když některé hodina odpadá
    const text = g.split && (subjects.length > 1 || off)
        ? joinCz(g.live.map(x => one(x.lesson.subject, uniq([placeOf(x.lesson)]), x.group)))
        : one(subjects[0] || '', uniq(g.live.map(x => placeOf(x.lesson))), '');
    return off ? `${text}, ${off}` : text;
}

/** Obří text: učebna / třída, u dělené hodiny vedle sebe se skupinou. */
function bigHtml(slot) {
    const g = slotGroups(slot);
    const places = g.live.map(x => ({ place: placeOf(x.lesson), group: x.group }));
    const distinct = uniq(places.map(p => p.place));
    // Skupina u učebny: když jsou učebny různé, nebo když jiné skupině hodina odpadá
    if (g.split && (distinct.length > 1 || g.off.length)) {
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

/**
 * Ze kterého týdne zastaralá data jsou: „z minulého týdne (2.–6. listopadu)“,
 * u starších jen datum týdne („z týdne 2.–6. listopadu“).
 */
function staleText() {
    const mon = weekMonday(model.actual, null);
    const range = mon ? weekTitle(mon).replace(/^Týden /, '') : '';
    if (model.stale === 'old' && range) return `z týdne ${range}`;
    return `${model.stale === 'past' ? 'z minulého týdne' : 'z jiného týdne'}${range ? ` (${range})` : ''}`;
}

/** Popisek dlaždice Změn u zastaralých dat: „minulý týden“, „v týdnu 2.–6. 11.“. */
function staleWeekLabel() {
    if (model.stale === 'past') return 'minulý týden';
    const mon = model.stale === 'old' ? weekMonday(model.actual, null) : null;
    if (!mon) return 'v zobrazeném týdnu';
    const fri = addDays(mon, 4);
    const from = mon.getMonth() === fri.getMonth() ? `${mon.getDate()}.` : `${mon.getDate()}. ${mon.getMonth() + 1}.`;
    return `v týdnu ${from}–${fri.getDate()}. ${fri.getMonth() + 1}.`;
}

/** Stav místo nowState, když data nejsou z tohoto týdne: žádné „teď“ ani „dnes“. */
const STALE_STATE = { kind: 'stale', today: -1, current: null, cancelledNow: null, next: null, lastToday: false, event: null, dayOff: null };

/* ── hrdina ─────────────────────────────────────────────────────────────── */

function heroHtml(st, now) {
    const parts = { eyebrow: '', subj: '', big: '', off: '', left: '', next: '' };
    const nextLine = (n) => `Další: ${whenText(n, now, { short: true })} ${lessonPhrase(n)}`;
    switch (st.kind) {
        case 'lesson': {
            const c = st.current;
            parts.eyebrow = `Teď, ${c.hour}. hodina`;
            parts.subj = [subjText(c), whoLine(c.items)].filter(Boolean).join(', ');
            parts.big = bigHtml(c);
            parts.off = offText(c);
            parts.left = `zbývá ${minutesUntil(c.end, now)} min`;
            if (st.next && st.next.dayOffset === 0) {
                const when = whenText(st.next, now);
                // „Další Fyzika v U11 za 30 min“, ale „Další v 12:35 Anglický jazyk v U11“
                parts.next = when.startsWith('za ') ? `Další ${lessonPhrase(st.next)} ${when}` : `Další ${when} ${lessonPhrase(st.next)}`;
            }
            else parts.next = 'Poslední hodina dne';
            break;
        }
        case 'break':
        case 'before': {
            const n = st.next;
            // Akce místo výuky má jméno („1.–3. hodina: Exkurze“), není to „odpadá“ ani volno
            parts.eyebrow = st.event ? `${hoursLabel(st.event)}: ${st.event.name}`
                : st.cancelledNow ? `${st.cancelledNow.hour}. hodina odpadá`
                    : (st.kind === 'before' ? `Dnes od ${fmtMin(n.start)}` : 'Přestávka');
            parts.subj = [subjText(n), whoLine(n.items)].filter(Boolean).join(', ');
            parts.big = bigHtml(n);
            parts.off = offText(n);
            const mins = minutesUntil(n.start, now);
            parts.left = mins <= 90 ? `začíná za ${mins} min` : `začíná v ${fmtMin(n.start)}`;
            parts.next = `${n.hour}. hodina, ${hourRange(n.hour)}`;
            break;
        }
        case 'noneToday':
            if (st.dayOff === 'event') {
                parts.eyebrow = 'Dnes místo výuky';
                parts.subj = `${st.event.name}, ${hoursLabel(st.event)}`;
                parts.big = '<span class="ov-big">Akce</span>';
            } else {
                parts.eyebrow = st.dayOff === 'cancelled' ? 'Dnes všechny hodiny odpadají' : 'Dnes bez výuky';
                parts.big = '<span class="ov-big">Volno</span>';
            }
            parts.next = st.next ? nextLine(st.next) : '';
            break;
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
        case 'stale':
            parts.eyebrow = 'Rozvrh není aktuální';
            parts.subj = `Data jsou ${staleText()}`;
            parts.next = 'Nový týden se zatím nepodařilo načíst. Co je teď a dnes, se z těchto dat nedá poznat.';
            break;
        default:
            parts.eyebrow = 'Tento týden';
            parts.big = '<span class="ov-big">Volno</span>';
            parts.next = 'V rozvrhu teď nejsou žádné hodiny.';
    }
    return `<p class="ov-eyebrow">${esc(parts.eyebrow)}</p>
        ${parts.subj ? `<p class="ov-subj">${esc(parts.subj)}</p>` : ''}
        ${parts.big ? `<p class="ov-bigline">${parts.big}</p>` : ''}
        ${parts.off ? `<p class="ov-next ov-off">${esc(parts.off)}</p>` : ''}
        ${parts.left ? `<p class="ov-left">${esc(parts.left)}</p>` : ''}
        ${parts.next ? `<p class="ov-next">${esc(parts.next)}</p>` : ''}`;
}

/* ── karta „teď“ v panelu (počítač) ─────────────────────────────────────── */

function nowCardHtml(st, now) {
    const k = (text) => `<h2 class="now-k" id="nowCardTitle">${icon('clock')}<span>${esc(text)}</span></h2>`;
    const nx = (n, lead) => {
        if (!n) return '';
        // Předmět tučně, pokud jím věta začíná (u skupin s různými předměty ne)
        const phrase = lessonPhrase(n);
        const subj = subjText(n);
        const body = subj && phrase.startsWith(subj) ? `<strong>${esc(subj)}</strong>${esc(phrase.slice(subj.length))}` : esc(phrase);
        return `<p class="now-nx">${esc(lead)} ${esc(whenText(n, now, { short: true }))} ${body}</p>`;
    };
    const off = (slot) => { const t = offText(slot); return t ? `<p class="now-nx now-off">${esc(t)}</p>` : ''; };
    // Učebny se skupinou tam, kde ji ukazuje i hrdina (různé učebny, odpadlá skupina)
    const bigText = (slot) => {
        const g = slotGroups(slot);
        const places = uniq(g.live.map(x => placeOf(x.lesson)));
        if (g.split && (places.length > 1 || g.off.length)) return g.live.map(x => [placeOf(x.lesson) || '?', x.group ? `(${x.group})` : ''].filter(Boolean).join(' ')).join(', ');
        return places.join(' ') || '–';
    };
    if (st.kind === 'lesson') {
        const c = st.current;
        return `${k(`teď, ${c.hour}. hodina`)}
            <p class="now-s">${esc(subjText(c))}</p>
            <p class="now-big">${esc(bigText(c))}</p>
            ${off(c)}
            <div class="now-prog" aria-hidden="true"><i style="width:${progressPct(c.start, c.end, now).toFixed(1)}%"></i></div>
            <p class="now-left">zbývá ${minutesUntil(c.end, now)} min</p>
            ${st.next && st.next.dayOffset === 0 ? nx(st.next, 'Další') : '<p class="now-nx">Poslední hodina dne</p>'}`;
    }
    if (st.kind === 'break' || st.kind === 'before') {
        const n = st.next;
        return `${k(st.event ? `${hoursLabel(st.event)}: ${st.event.name}` : (st.kind === 'before' ? 'dnes začíná' : 'přestávka'))}
            <p class="now-s">${esc(subjText(n))}</p>
            <p class="now-big">${esc(bigText(n))}</p>
            ${off(n)}
            <p class="now-left">${n.hour}. hodina ${esc(whenText(n, now))}</p>`;
    }
    if (st.kind === 'noneToday' && st.dayOff === 'event') {
        return `${k('dnes místo výuky')}
            <p class="now-s">${esc(`${st.event.name}, ${hoursLabel(st.event)}`)}</p>
            <p class="now-big now-big--word">Akce</p>
            ${nx(st.next, 'Další')}`;
    }
    if (st.kind === 'after' || st.kind === 'weekend' || st.kind === 'noneToday') {
        const title = st.kind === 'weekend' ? 'víkend'
            : st.kind === 'after' ? 'dnes už nic'
                : (st.dayOff === 'cancelled' ? 'dnes vše odpadá' : 'dnes bez výuky');
        return `${k(title)}
            <p class="now-big now-big--word">Volno</p>
            ${nx(st.next, 'Další')}`;
    }
    if (st.kind === 'stale') {
        return `${k('rozvrh není aktuální')}
            <p class="now-nx">Data jsou ${esc(staleText())}. Nový týden se zatím nepodařilo načíst.</p>`;
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
        // Zkratka i učebny ze stejných (živých) položek; odpadlá skupina sem svou učebnu nedává
        const shown = live.length ? live : items;
        const first = shown[0].lesson;
        const subjects = uniq(shown.map(it => abbreviateSubject(it.lesson.subject)));
        const split = items.length > 1;
        // Jedné skupině odpadá: u učebny je vidět, které skupiny se hodina týká
        const partial = split && live.length > 0 && live.length < items.length;
        const places = uniq(shown.map(it => [partial ? groupText(it.lesson.group) : '', placeOf(it.lesson)].filter(Boolean).join(' ')));
        const past = e != null && m >= e;
        const k = KINDS[kind];
        model.stripRefs.push({ items, hour, cur: !!cur });
        html += `<li><button type="button" class="ov-h lesson${cur ? ' cur' : ''}${cancelled ? ' is-cancelled' : ''}${past ? ' is-past' : ''}${split ? ' is-split' : ''}" data-strip="${ref++}"${first.changed || cancelled || partial ? ' data-changed="true"' : ''}>
            <span class="t">${cur ? 'Teď' : fmtMin(s)}</span>
            <span class="a">${esc(subjects.join(' / '))}</span>
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
    const sentence = st.kind === 'noneToday' && st.dayOff === 'event' ? `Dnes je místo výuky akce: ${st.event.name} (${hoursLabel(st.event)}).`
        : st.kind === 'noneToday' && st.dayOff === 'cancelled' ? 'Dnes všechny hodiny odpadají.'
            : changesSentence(dayChangeEntries(dayLessons), 'Dnes');
    return `<section class="ov-mod g-veil g-mod" aria-labelledby="ovTodayTitle">
        <h2 class="vh" id="ovTodayTitle">Dnešní hodiny</h2>
        <p class="ov-sum">${icon('info')}<span>${esc(sentence)}</span></p>
        ${stripHtml(st, now)}
    </section>`;
}

/* ── modul Týden ────────────────────────────────────────────────────────── */

function weekRowsHtml(st, now) {
    const weekend = st.today < 0 && !model.stale;
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

/**
 * Změny týdne, který přehled ukazuje v modulu Týden: o víkendu příští týden,
 * jinak tento; u zastaralých dat jejich týden (a odznak u Změn se schová).
 * @returns {{ data: Array, count: number, label: string, stale: boolean }}
 */
function weekChanges(now = new Date()) {
    const upcoming = getTodayIndex(now) < 0 && !model.stale && !!model.next;
    const data = (upcoming ? model.next : model.actual) || [];
    let count = 0;
    for (let d = 0; d < 5; d++) count += dayChangeEntries(data.filter(l => l.day === d)).length;
    const label = model.stale ? staleWeekLabel() : (upcoming ? 'příští týden' : 'tento týden');
    return { data, count, label, stale: !!model.stale };
}

function tilesHtml(st, now) {
    const today = st.today;
    const { data: all, count: week, label } = weekChanges(now);
    const todayCount = today >= 0 ? dayChangeEntries(all.filter(l => l.day === today)).length : 0;
    const link = changesLink();
    const rooms = model.rooms;
    const roomsFoot = rooms
        ? (rooms.count ? `${rooms.when} ${joinCz(rooms.names.slice(0, 3))}${rooms.count > 3 ? ` a další ${rooms.count - 3}` : ''}` : `${rooms.when} žádná`)
        : 'podle rozvrhu';
    return `<div class="ov-tiles">
        <a class="ov-tile g-veil" href="${esc(link.href)}" data-go="changes">
            <span class="g-mod-head">${icon('repeat-2')}Změny</span>
            <span class="ov-tile-big">${today >= 0 ? todayCount : week}</span>
            <span class="ov-tile-foot">${today >= 0 ? `dnes, tento týden ${week}` : label}</span>
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

const HERO_LABEL = '<h2 class="vh" id="ovHeroLabel">Teď</h2>';

function renderHero(st, now) {
    const hero = $('ovHero');
    // i s nadpisem, na který odkazuje aria-labelledby sekce
    if (hero) hero.innerHTML = `${HERO_LABEL}${heroHtml(st, now)}`;
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
            ${HERO_LABEL}
            ${heroHtml(st, now)}
        </section>
        ${todayHtml(st, now)}
        ${weekRowsHtml(st, now)}
        ${tilesHtml(st, now)}`;
    const card = $('nowCard');
    if (card) { card.innerHTML = nowCardHtml(st, now); card.hidden = false; }

    // Název hodiny pro čtečku: jedna věta se stejnými slovy jako obrazovka
    // (i se zkratkou předmětu a „teď“, které jsou na tlačítku vidět);
    // u dělené hodiny nejdřív skupiny, které ji mají, pak ty, kterým odpadá
    ov.querySelectorAll('.ov-h[data-strip]').forEach(btn => {
        const ref = model.stripRefs[Number(btn.dataset.strip)];
        if (ref && ref.items[0]) addLessonDescription(btn, slotSentence(ref.items, { shorts: true, now: ref.cur }));
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
    // Když se nový rozvrh nenačetl, přehled se obnoví hned: nesmí pod novým jménem
    // zůstat rozvrh předchozí (úspěšné načtení přehled obnoví samo)
    document.addEventListener('timetableloaded', (e) => {
        model.key = '';
        if (e.detail && e.detail.error) tickOverview();
    });
    // Načítá se jiný rozvrh: starý přehled hned pryč, ať není ani chvíli pod novým jménem
    document.addEventListener('timetableloading', () => {
        if (!model.dataKey || model.dataKey === dataKeyOf()) return;
        invalidateOverview();
        ov.innerHTML = skeletonHtml();
    });
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
                openDay(getTodayIndex(), { schedule: model.sched, from: strip });
            } else {
                const { showLessonModal } = await import('./modal.js');
                showLessonModal(ref.items[0].lesson, { data: model.actual });
            }
            return;
        }
        const row = e.target.closest('.wr[data-day]');
        if (row) {
            const { openDay } = await import('./shell.js');
            openDay(Number(row.dataset.day), { schedule: row.dataset.next === 'true' ? 'next' : model.sched, from: row });
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
    const key = keyOf();
    // Data jiného rozvrhu se zahodí hned: kdyby se nový nenačetl, zůstal by pod
    // jeho jménem starý přehled (hrdina, pás hodin i týden)
    if (model.dataKey && model.dataKey !== dataKeyOf()) invalidateOverview();
    const fresh = force || model.key !== key || !model.actual;
    if (fresh) {
        if (ov && (!model.actual || !ov.querySelector('.ov-hero'))) ov.innerHTML = skeletonHtml();
        const ok = await loadData(force);
        if (!ok) {
            if (keyOf() !== key) return; // mezitím se vybral jiný rozvrh, vykreslí ho jeho vlastní obnovení
            if (!model.actual) {
                if (ov) ov.innerHTML = `<div class="g-empty g-veil ov-error">${icon('wifi-off')}<strong>Přehled teď nejde načíst</strong><span>Zkontroluj připojení a zkus to znovu.</span></div>`;
                const card = $('nowCard');
                if (card) { card.innerHTML = ''; card.hidden = true; }
                updateNavCounts();
            }
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
    const st = model.stale ? STALE_STATE : nowState(model.actual, { now, nextWeek: model.next });
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
    // Stejný týden jako modul Týden a dlaždice; počet ze zastaralých dat se neukazuje
    const { count, label, stale } = weekChanges();
    const week = stale ? 0 : count;
    badge.textContent = week ? String(week) : '';
    badge.hidden = !week;
    if (sr) sr.textContent = week ? `, ${czPlural(week, ['změna', 'změny', 'změn'])} v rozvrhu ${label}` : '';
}

/** Nový rozvrh nebo obnovená data: přehled načte aktuální týden znovu. */
export function invalidateOverview() {
    model.key = '';
    model.dataKey = '';
    model.actual = null;
    model.next = null;
    model.sched = 'actual';
    model.stale = '';
    model.signature = '';
}

export { statusHtml };
