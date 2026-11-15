/**
 * „Teď / Další“ (návrh G): co právě probíhá a co bude dál.
 *
 * Widget nad rozvrhem zmizel; stejná data teď vykresluje hrdina přehledu
 * na mobilu a karta „teď“ v postranním panelu (overview.js). Tady zůstává
 * čistá logika (testovaná v Node) a pravidelné obnovování.
 *
 * Dělené hodiny: když má hodina víc skupin, vrátí se všechny (hrdina ukáže
 * obě učebny vedle sebe), odpadlé skupiny se nepočítají.
 */

import { lessonTimes } from './constants.js';
import { getTodayIndex } from './utils.js';
import { slotLessons, startMin, endMin, minutesOfDay } from './rozvrh-core.js';

let intervalId = null;

/** Hodiny dne jako [{ hour, start, end, items (bez odpadlých), cancelled }] seřazené. */
export function dayTimeline(data, day) {
    const byHour = new Map();
    for (const l of data || []) {
        if (!l || l.day !== day) continue;
        if (!byHour.has(l.hour)) byHour.set(l.hour, []);
        byHour.get(l.hour).push(l);
    }
    const out = [];
    for (const [hour, rows] of byHour) {
        const s = startMin(hour);
        if (s == null) continue;
        const all = slotLessons(rows);
        const items = all.filter(it => it.kind !== 'cancel' && it.lesson.type !== 'absent' && it.lesson.subject && String(it.lesson.subject).trim());
        out.push({ hour, start: s, end: endMin(hour), items, all, cancelled: items.length === 0 });
    }
    return out.sort((a, b) => a.start - b.start);
}

function firstLive(data, day) {
    return dayTimeline(data, day).find(s => !s.cancelled) || null;
}

/**
 * Stav „teď“.
 * @param {Array} data - lekce aktuálního týdne
 * @param {{ now?: Date, nextWeek?: Array|null }} [opts] - nextWeek: lekce příštího týdne (víkend, pátek odpoledne)
 * @returns {{
 *   kind: 'lesson'|'break'|'before'|'after'|'weekend'|'empty',
 *   today: number,
 *   current: null | { hour, start, end, items },
 *   cancelledNow: null | { hour, all },
 *   next: null | { hour, start, end, items, day, dayOffset, nextWeek: boolean },
 *   lastToday: boolean
 * }}
 */
export function nowState(data, { now = new Date(), nextWeek = null } = {}) {
    const today = getTodayIndex(now);
    const m = minutesOfDay(now);
    const res = { kind: 'empty', today, current: null, cancelledNow: null, next: null, lastToday: false };

    const findNextFrom = (fromDay) => {
        for (let d = fromDay; d <= 4; d++) {
            const s = firstLive(data, d);
            if (s) return { ...s, day: d, dayOffset: d - today, nextWeek: false };
        }
        if (nextWeek) {
            for (let d = 0; d <= 4; d++) {
                const s = firstLive(nextWeek, d);
                if (s) return { ...s, day: d, dayOffset: null, nextWeek: true };
            }
        }
        return null;
    };

    if (today < 0) {
        res.kind = 'weekend';
        res.next = findNextFrom(5);
        return res;
    }

    const tl = dayTimeline(data, today);
    const live = tl.filter(s => !s.cancelled);
    const cur = tl.find(s => m >= s.start && m < s.end);
    if (cur && !cur.cancelled) res.current = { hour: cur.hour, start: cur.start, end: cur.end, items: cur.items };
    else if (cur) res.cancelledNow = { hour: cur.hour, all: cur.all };

    const laterToday = live.find(s => s.start > m);
    if (laterToday) res.next = { ...laterToday, day: today, dayOffset: 0, nextWeek: false };
    else res.next = findNextFrom(today + 1);

    if (res.current) {
        res.kind = 'lesson';
        res.lastToday = !laterToday;
    } else if (!live.length) {
        res.kind = res.next ? 'after' : 'empty';
    } else if (m < live[0].start) {
        res.kind = 'before';
    } else if (laterToday) {
        res.kind = 'break';
    } else {
        res.kind = res.next ? 'after' : 'empty';
    }
    return res;
}

/** Postup hodinou v % (0–100). */
export function progressPct(start, end, now = new Date()) {
    const dur = end - start;
    if (dur <= 0) return 0;
    return Math.max(0, Math.min(100, ((minutesOfDay(now) - start) / dur) * 100));
}

/** Celé minuty do / od (zaokrouhleno nahoru, jako „zbývá 25 min“). */
export function minutesUntil(target, now = new Date()) {
    return Math.max(0, Math.ceil(target - minutesOfDay(now)));
}

/** Hodina (0–12) podle času, jen kvůli zpětné kompatibilitě. */
export function hourAt(now = new Date()) {
    const m = minutesOfDay(now);
    const t = lessonTimes.find(x => m >= x.start[0] * 60 + x.start[1] && m < x.end[0] * 60 + x.end[1]);
    return t ? t.hour : -1;
}

/**
 * Recompute and render "now": overview hero, "now" card, now lines.
 * Called after every timetable load and periodically.
 */
export function refreshNextLessonWidget() {
    import('./overview.js')
        .then(m => m.tickOverview())
        .catch(err => console.error('Overview refresh failed:', err));
}

/** Start the periodic refresh (every 15s). Safe to call once. */
export function initNextLessonWidget() {
    if (intervalId) return;
    // Skip the re-render while the tab is hidden; the visibilitychange
    // listener below catches up as soon as it becomes visible again.
    intervalId = setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        refreshNextLessonWidget();
    }, 15 * 1000);

    // Re-render when the tab returns to the foreground: mobile browsers suspend
    // timers in the background, so finished lessons would otherwise linger.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshNextLessonWidget();
    });
    window.addEventListener('focus', refreshNextLessonWidget);
    window.addEventListener('pageshow', refreshNextLessonWidget);
    window.addEventListener('online', refreshNextLessonWidget);
}
