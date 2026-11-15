/**
 * "Volné učebny" (?view=rooms): which rooms have no lesson now and in the
 * next lesson, from aggregates/freeRooms_Actual|Next (S3). Rooms that are
 * free by the timetable can still be booked for something else, so the view
 * says so, and rooms that are no use (gym, lab with a key…) can be hidden.
 */

import { fetchAggregate, fetchBackendStatus } from './api.js';
import { rasterHours, freeRoomsAt, defaultRoomSlots, hourLabel, parseHiddenRooms, toggleHiddenRoom } from './rooms-core.js';
import { dayLabel, isoDate, mondayIso, addDaysIso, freshnessText, czPlural } from './changes-core.js';
import { timetableUrl } from './view-route.js';
import { esc, setPressed } from './utils.js';
import { updateViewParams, openTimetable } from './view-router.js';
import { icon } from './changes-render.js';
import { lessonTimes } from './constants.js';

const HIDDEN_KEY = 'hiddenRooms';
const WHEN_LABEL = {
    now: 'Teď',
    upcoming: 'Nejbližší hodina',
    nextDay: 'Příští školní den',
    next: 'Další hodina',
    picked: 'Vybraná hodina',
};
/** Start of the sentence on top ("Teď volné: 3"). */
const LEAD_LABEL = {
    now: 'Teď volné',
    upcoming: 'Příští hodinu volné',
    nextDay: 'Příští školní den volné',
    picked: 'Volné',
};

let model = null;
let pick = null; // { week, day, hour } chosen by the user, null = by the clock
let wired = false;
let loadSeq = 0;
const $ = (id) => document.getElementById(id);

function readHidden() {
    try { return parseHiddenRooms(localStorage.getItem(HIDDEN_KEY)); } catch { return []; }
}
function writeHidden(list) {
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(list)); } catch { /* private mode: session only */ }
}

/** Monday of a week's aggregate (or computed when the data have no weekStart). */
function weekStartOf(week, now) {
    const agg = model && model[week] && model[week].data;
    if (agg && agg.weekStart) return agg.weekStart;
    const monday = mondayIso(now);
    return week === 'Next' ? addDaysIso(monday, 7) : monday;
}

function dateOf(week, day, now) {
    return addDaysIso(weekStartOf(week, now), day);
}

function slotFromDate(date, now) {
    for (const week of ['Actual', 'Next']) {
        if (!model[week] || !model[week].data) continue;
        for (let day = 0; day < 5; day++) if (dateOf(week, day, now) === date) return { week, day };
    }
    return null;
}

function wire() {
    if (wired) return;
    wired = true;
    $('roomsDay').addEventListener('change', (e) => {
        const now = new Date();
        const found = slotFromDate(e.target.value, now);
        if (!found) return;
        const hours = rasterHours(model[found.week].data);
        const hour = pick && hours.includes(pick.hour) ? pick.hour : (hours.includes(1) ? 1 : hours[0]);
        pick = { ...found, hour };
        render();
    });
    $('roomsHour').addEventListener('change', (e) => {
        const now = new Date();
        const base = pick || currentSlots(now).primary;
        if (!base) return;
        pick = { week: base.week, day: base.day, hour: Number(e.target.value) };
        render();
    });
    $('roomsNow').addEventListener('click', () => { pick = null; render(); });
    $('roomsResult').addEventListener('click', onRoomAction);
    $('roomsHiddenList').addEventListener('click', onRoomAction);
}

function onRoomAction(e) {
    const hide = e.target.closest('button[data-room]');
    if (hide) {
        const id = hide.dataset.room;
        const list = toggleHiddenRoom(readHidden(), id);
        writeHidden(list);
        const nowHidden = list.includes(id);
        render();
        // Keep the keyboard focus somewhere sensible after the row disappears
        const target = nowHidden ? $('roomsHiddenSummary') : $('roomsResult').querySelector(`button[data-room="${CSS.escape(id)}"]`);
        if (target) target.focus();
        return;
    }
    const link = e.target.closest('a[data-room]');
    if (link && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        openTimetable({ type: 'Room', id: link.dataset.room, schedule: link.dataset.week.toLowerCase(), day: Number(link.dataset.day) });
    }
}

function currentSlots(now) {
    const base = model.Actual && model.Actual.data ? model.Actual.data : model.Next && model.Next.data;
    return defaultRoomSlots(now, rasterHours(base));
}

/** Show the view. Params from the URL: date (YYYY-MM-DD) and hour. */
export async function enterRoomsView(params = {}) {
    wire();
    const seq = ++loadSeq;
    $('roomsResult').setAttribute('aria-busy', 'true');
    if (!model) $('roomsResult').innerHTML = skeletonHtml();
    const [actual, next, status] = await Promise.all([
        fetchAggregate('freeRooms_Actual').catch(() => null),
        fetchAggregate('freeRooms_Next').catch(() => null),
        fetchBackendStatus(),
    ]);
    if (seq !== loadSeq) return;
    model = { Actual: actual, Next: next, status };
    $('roomsResult').setAttribute('aria-busy', 'false');

    pick = null;
    if (params.date) {
        const found = slotFromDate(params.date, new Date());
        if (found) {
            const hours = rasterHours(model[found.week].data);
            const hour = params.hour !== undefined && hours.includes(Number(params.hour)) ? Number(params.hour) : hours[0];
            if (hour !== undefined) pick = { ...found, hour };
        }
    }
    render();
}

function skeletonHtml() {
    const tiles = '<div class="g-skel rooms-skel-tile"></div>'.repeat(4);
    return `<div class="rooms-slot g-veil g-mod" aria-hidden="true"><div class="g-skel rooms-skel-head"></div><div class="rooms-skel-tiles">${tiles}</div></div>`.repeat(2);
}

/** "8:00–8:45" of a lesson */
function timeRange(hour) {
    const t = lessonTimes.find(x => x.hour === hour);
    return t ? t.label.replace('-', '–') : '';
}

/** A tile: the big room code opens the room's timetable, the eye hides it from the list. */
function roomItem(room, slot) {
    const href = timetableUrl({ type: 'Room', id: room.id, schedule: slot.week.toLowerCase(), day: slot.day });
    return `<li class="room-item">
        <a class="room-link" href="${esc(href)}" data-room="${esc(room.id)}" data-week="${esc(slot.week)}" data-day="${esc(slot.day)}">${esc(room.name)}</a>
        <button type="button" class="room-hide" data-room="${esc(room.id)}" aria-label="Skrýt ${esc(room.name)} ze seznamu" title="Skrýt ze seznamu">${icon('eye-off')}</button>
    </li>`;
}

/** Free rooms of a slot (or why there are none). */
function slotResult(slot, hidden) {
    const agg = model[slot.week] && model[slot.week].data;
    if (!agg) return { agg: null, res: null };
    return { agg, res: freeRoomsAt(agg, slot.day, slot.hour, hidden) };
}

function slotSection(slot, idx, hidden, now) {
    if (!slot) return '';
    const id = `roomsSlot${idx}`;
    const date = dateOf(slot.week, slot.day, now);
    const dayText = date === isoDate(now) ? '' : dayLabel(date, now);
    const head = `<h3 class="rooms-slot-title" id="${id}"><span class="rooms-when">${esc(WHEN_LABEL[slot.when] || '')}</span>`
        + `${dayText ? ` <span class="rooms-day">${esc(dayText)}</span>` : ''}`
        + ` <span class="rooms-hour">${esc(hourLabel(slot.hour))}</span></h3>`;
    const { agg, res } = slotResult(slot, hidden);
    const empty = (title, hint) => `<div class="g-empty rooms-empty">${icon('door-open')}<strong>${esc(title)}</strong><span>${esc(hint)}</span></div>`;
    let count = '';
    let body;
    if (!agg) body = empty('Pro tento týden zatím data nejsou.', 'Zkuste jiný den.');
    else if (!res.known) body = empty('Pro tuto hodinu nejsou data.', 'Vyberte jinou hodinu.');
    else if (res.rooms.length === 0) {
        body = empty(`Žádná volná učebna${res.hiddenCount ? ' (kromě skrytých)' : ''}.`, 'Zkuste jinou hodinu nebo den.');
    } else {
        count = `<p class="rooms-count">${czPlural(res.rooms.length, ['volná učebna', 'volné učebny', 'volných učeben'])}${res.hiddenCount ? `, ${res.hiddenCount} skrytých` : ''}</p>`;
        body = `<ul class="room-list rooms-tiles" aria-labelledby="${id}">${res.rooms.map(r => roomItem(r, slot)).join('')}</ul>`;
    }
    return `<section class="rooms-slot g-veil g-mod${idx === 1 ? ' is-primary' : ''}"><div class="rooms-slot-head">${head}${count}</div>${body}</section>`;
}

/** "Teď volné: 3" + "1. hodina, do 8:45" */
function leadHtml(slot, hidden, now) {
    if (!slot) return '';
    const { res } = slotResult(slot, hidden);
    if (!res || !res.known) return '';
    const date = dateOf(slot.week, slot.day, now);
    const t = lessonTimes.find(x => x.hour === slot.hour);
    let when;
    if (slot.when === 'now' && t) when = `${slot.hour}. hodina, do ${t.label.split('-')[1]}`;
    else {
        const day = date === isoDate(now) ? '' : `${dayLabel(date, now)}, `;
        when = `${day}${slot.hour}. hodina ${timeRange(slot.hour)}`;
    }
    return `<strong class="rooms-lead-num">${esc(LEAD_LABEL[slot.when] || 'Volné')}: ${res.rooms.length}</strong> <span class="rooms-lead-when">${esc(when)}</span>`;
}

function render() {
    if (!model) return;
    const now = new Date();
    const hidden = readHidden();
    const hasData = (model.Actual && model.Actual.data) || (model.Next && model.Next.data);

    if (!hasData) {
        ['roomsDay', 'roomsHour', 'roomsNow'].forEach(id => { $(id).disabled = true; });
        $('roomsLead').innerHTML = '';
        $('roomsResult').innerHTML = `<div class="g-empty g-veil rooms-empty">${icon('clock')}<strong>Přehled volných učeben zatím není k dispozici.</strong><span>Vznikne po příštím stažení dat z Bakalářů – zkuste to prosím později.</span></div>`;
        $('roomsFreshness').textContent = freshnessText({ lastSuccessAt: model.status && model.status.lastSuccessAt }, now);
        renderHidden([], hidden);
        return;
    }
    ['roomsDay', 'roomsHour', 'roomsNow'].forEach(id => { $(id).disabled = false; });

    let primary;
    let secondary;
    if (pick) {
        const hours = rasterHours(model[pick.week].data);
        const after = hours.find(h => h > pick.hour);
        primary = { when: 'picked', ...pick };
        secondary = after === undefined ? null : { when: 'next', week: pick.week, day: pick.day, hour: after };
    } else {
        ({ primary, secondary } = currentSlots(now));
    }

    // Day + hour pickers reflect what is shown
    const days = [];
    for (const [week, label] of [['Actual', 'Tento týden'], ['Next', 'Příští týden']]) {
        if (!model[week] || !model[week].data) continue;
        days.push(`<optgroup label="${label}">${[0, 1, 2, 3, 4].map(d => {
            const date = dateOf(week, d, now);
            const sel = primary && primary.week === week && primary.day === d;
            return `<option value="${esc(date)}"${sel ? ' selected' : ''}>${esc(dayLabel(date, now))}</option>`;
        }).join('')}</optgroup>`);
    }
    $('roomsDay').innerHTML = days.join('');
    const raster = primary ? rasterHours(model[primary.week] && model[primary.week].data) : [];
    $('roomsHour').innerHTML = raster.map(h => `<option value="${h}"${primary && primary.hour === h ? ' selected' : ''}>${esc(hourLabel(h))}</option>`).join('');
    setPressed([$('roomsNow')], () => !pick);

    $('roomsLead').innerHTML = leadHtml(primary, hidden, now);
    $('roomsResult').innerHTML = slotSection(primary, 1, hidden, now) + slotSection(secondary, 2, hidden, now);

    const src = primary && model[primary.week];
    $('roomsFreshness').textContent = freshnessText({
        lastSuccessAt: model.status && model.status.lastSuccessAt,
        generatedAt: src && src.data && src.data.generatedAt,
        fromCache: !!(src && src.fromCache),
        cacheAgeMs: src && src.cacheAgeMs,
    }, now);

    const allRooms = [...((model.Actual && model.Actual.data && model.Actual.data.rooms) || []), ...((model.Next && model.Next.data && model.Next.data.rooms) || [])];
    renderHidden(allRooms, hidden);

    updateViewParams(pick ? { date: dateOf(pick.week, pick.day, now), hour: String(pick.hour) } : {});
}

function renderHidden(allRooms, hidden) {
    const names = new Map(allRooms.map(r => [String(r.id), r.name]));
    $('roomsHiddenCount').textContent = String(hidden.length);
    $('roomsHiddenBox').hidden = hidden.length === 0;
    $('roomsHiddenList').innerHTML = hidden.map(id => {
        const name = names.get(id) || id;
        return `<li class="room-hidden-item"><span class="room-name">${esc(name)}</span>
            <button type="button" class="room-hide g-btn g-btn--small" data-room="${esc(id)}" aria-label="Zobrazit ${esc(name)} v seznamu">${icon('eye')}Zobrazit</button></li>`;
    }).join('');
}
