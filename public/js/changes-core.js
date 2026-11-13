/**
 * Pure helpers behind the school-wide changes board (?view=changes), the
 * hallway kiosk (?kiosk=changes) and the "what is different today" detail.
 *
 * No DOM and no Firebase here, so all of it runs in the Node tests
 * (test/client-views.test.js). Input is the S3 aggregate
 * aggregates/changes_{Actual|Next} or plain lessons of one timetable.
 */

import { standardizeGroupName } from './utils.js';

const collator = new Intl.Collator('cs', { numeric: true });
const byName = (a, b) => collator.compare(String(a || ''), String(b || ''));

export const KIND_LABELS = {
    substitution: 'Suplování',
    roomChange: 'Změna učebny',
    changed: 'Změna',
    removed: 'Odpadá',
    absent: 'Nekoná se',
};

const WEEKDAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];

/* ── dates (local time; the app is used in Prague) ─────────────────────── */

/** 'YYYY-MM-DD' of a Date in local time (toISOString would shift to UTC). */
export function isoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Local Date at midnight from 'YYYY-MM-DD' (null for anything else). */
export function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
}

export function addDaysIso(iso, n) {
    const d = parseIso(iso);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return isoDate(d);
}

/** Monday of the week containing `date`, as 'YYYY-MM-DD'. */
export function mondayIso(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    return isoDate(d);
}

/** "středa 4. 11." / "dnes, středa 4. 11." / "zítra, čtvrtek 5. 11." */
export function dayLabel(iso, now = new Date(), { relative = true } = {}) {
    const d = parseIso(iso);
    if (!d) return '';
    const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`;
    if (!relative) return base;
    const today = isoDate(now);
    if (iso === today) return `dnes, ${base}`;
    if (iso === addDaysIso(today, 1)) return `zítra, ${base}`;
    return base;
}

/** Short label for a quick day button: "Dnes", "Zítra" or "Pondělí". */
export function shortDayLabel(iso, now = new Date()) {
    const today = isoDate(now);
    if (iso === today) return 'Dnes';
    if (iso === addDaysIso(today, 1)) return 'Zítra';
    const d = parseIso(iso);
    if (!d) return '';
    const name = WEEKDAYS[d.getDay()];
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Czech plural: czPlural(3, ['změna', 'změny', 'změn']) → "3 změny". */
export function czPlural(n, [one, few, many]) {
    const word = n === 1 ? one : (n >= 2 && n <= 4 ? few : many);
    return `${n} ${word}`;
}

/* ── teacher names ─────────────────────────────────────────────────────── */

const TITLE_PREFIX = /^(?:Mgr\.|Ing\.|Bc\.|Dr\.|Ph\.D\.|RNDr\.|PaedDr\.|PhDr\.|JUDr\.|MUDr\.|Mgr\.A\.|MBA|DiS\.)\s*/i;
const TITLE_SUFFIX = /,?\s*(?:Ph\.D\.|CSc\.|MBA|DiS\.)$/i;

export function stripTitles(name) {
    let cleaned = String(name || '').trim();
    let prev;
    do {
        prev = cleaned;
        cleaned = cleaned.replace(TITLE_PREFIX, '').replace(TITLE_SUFFIX, '').trim();
    } while (cleaned !== prev);
    return cleaned;
}

const fold = (s) => String(s || '').toLocaleLowerCase('cs').replace(/\./g, '').trim();

/**
 * Keys "surname|initial" a teacher name can stand for. Bakaláři writes the
 * same person as "Ing. Jan Vzorek", "Vzorek Jan" or (in cancelled lessons)
 * "J. Vzorek"; the order of the words is not reliable, so both readings of
 * a two-word name are produced and two names match when the sets meet.
 */
export function teacherKeys(name) {
    const parts = stripTitles(name).split(/\s+/).filter(Boolean);
    const keys = new Set();
    if (parts.length === 0) return keys;
    if (parts.length === 1) {
        keys.add(`${fold(parts[0])}|`);
        return keys;
    }
    const first = parts[0];
    const last = parts[parts.length - 1];
    const isInitial = (p) => /^\p{L}\.?$/u.test(p);
    if (isInitial(first) && !isInitial(last)) {
        keys.add(`${fold(last)}|${fold(first).charAt(0)}`);
    } else if (isInitial(last) && !isInitial(first)) {
        keys.add(`${fold(first)}|${fold(last).charAt(0)}`);
    } else {
        keys.add(`${fold(last)}|${fold(first).charAt(0)}`);
        keys.add(`${fold(first)}|${fold(last).charAt(0)}`);
    }
    return keys;
}

/** Same person? Empty names never match (an unknown teacher is not "the same"). */
export function teachersMatch(a, b) {
    if (!a || !b) return false;
    const ka = teacherKeys(a);
    for (const k of teacherKeys(b)) if (ka.has(k)) return true;
    return false;
}

/* ── merging the rows of one slot ──────────────────────────────────────── */

/** Group of a lesson in a comparable form ('' = whole class). */
export function groupKey(group) {
    return standardizeGroupName(group || '').toLocaleLowerCase('cs');
}

/** removed | absent | changed for an aggregate item or a raw lesson. */
export function kindOf(item) {
    if (item.kind) return item.kind;
    if (item.type === 'removed') return 'removed';
    if (item.type === 'absent') return 'absent';
    return 'changed';
}

function descriptionOf(item) {
    if (typeof item.description === 'string') return item.description;
    return (item.changeInfo && item.changeInfo.description) || '';
}

const brief = (item) => item ? { subject: item.subject || '', teacher: item.teacher || '', room: item.room || '' } : null;
const same = (a, b) => fold(a) === fold(b);

/**
 * "Suplování: MAT, Vzorový Petr (FYZ, Testová Eva)" → { subject: 'FYZ', teacher: 'Testová Eva' }.
 * Used when a substitution arrives without the cancelled original next to it.
 */
export function originalFromDescription(description) {
    const m = /^[^:()]+:\s*[^,()]+,\s*[^()]+?\s*\(([^,()]+)(?:,\s*([^()]+))?\)\s*$/.exec(String(description || '').trim());
    if (!m) return null;
    return { subject: m[1].trim(), teacher: (m[2] || '').trim(), room: '' };
}

/** Reason worth showing next to a cancellation ("Zrušeno - Exkurze" → "Exkurze"). */
export function removalReason(description) {
    const text = String(description || '').trim();
    if (!text || /^hodina odpadla$/i.test(text)) return '';
    const m = /^(?:Zrušeno|Vyjmuto(?: z rozvrhu)?)\s*(?:-\s*(.+)|\(.*\))?$/i.exec(text);
    if (m) return (m[1] || '').trim();
    return text;
}

/** Kind of a cancelled-original → replacement pair. */
export function classifyPair(before, after) {
    const sameTeacher = teachersMatch(before.teacher, after.teacher)
        || (!before.teacher && !after.teacher);
    if (sameTeacher && same(before.subject, after.subject) && !same(before.room, after.room)) return 'roomChange';
    if (!sameTeacher) return 'substitution';
    return 'changed';
}

function entryFor(kind, items, before, after, note, extra) {
    return { kind, hour: items[0].hour, group: items[0].group || null, before, after, note, items, ...extra };
}

/**
 * Turn the change rows of one or more slots into readable entries.
 *
 * A substitution is stored as two rows of the same slot (the S3 aggregate and
 * the timetable both do this): the replacement lesson (changed) and the struck
 * original (removed). They become one entry "originally → now". Pairs are
 * matched within the same group first, then - when exactly one of each is
 * left in the slot - across groups (a cancelled row may lack the group).
 *
 * @param {Array} items - aggregate items { hour, group, kind, subject, teacher, room, description }
 *                        or raw lessons { hour, group, type, changed, changeInfo, ... }
 * @param {(item) => string} [slotOf] - slot identity without the group (default: hour)
 * @returns {Array<{ kind, hour, group, before, after, note, items }>} in input order
 */
export function mergeChangeItems(items, slotOf = (it) => String(it.hour)) {
    const slots = new Map();
    for (const item of items || []) {
        const key = slotOf(item);
        if (!slots.has(key)) slots.set(key, []);
        slots.get(key).push(item);
    }

    const out = [];
    for (const slotItems of slots.values()) {
        const removed = slotItems.filter(i => kindOf(i) === 'removed');
        const changed = slotItems.filter(i => kindOf(i) === 'changed');
        const pairs = [];
        // 1) same group
        for (const c of [...changed]) {
            const r = removed.find(x => groupKey(x.group) === groupKey(c.group));
            if (!r) continue;
            pairs.push([r, c]);
            removed.splice(removed.indexOf(r), 1);
            changed.splice(changed.indexOf(c), 1);
        }
        // 2) one of each left: still the same slot, the group just differs
        if (removed.length === 1 && changed.length === 1) {
            pairs.push([removed.pop(), changed.pop()]);
        }

        const extra = (it) => (it.classId !== undefined ? { classId: it.classId, className: it.className } : {});
        const ordered = [];
        for (const [r, c] of pairs) {
            const before = brief(r);
            const after = brief(c);
            // Nothing visible differs (e.g. only the theme or a note): keep Bakaláři's own words
            const identical = same(before.subject, after.subject) && teachersMatch(before.teacher, after.teacher) && same(before.room, after.room);
            ordered.push({ at: slotItems.indexOf(c), entry: entryFor(classifyPair(r, c), [c, r], before, after, identical ? descriptionOf(c) : '', extra(c)) });
        }
        for (const c of changed) {
            const fromText = originalFromDescription(descriptionOf(c));
            const kind = fromText ? classifyPair(fromText, c) : 'changed';
            ordered.push({ at: slotItems.indexOf(c), entry: entryFor(kind, [c], fromText, brief(c), fromText ? '' : descriptionOf(c), extra(c)) });
        }
        for (const r of removed) {
            ordered.push({ at: slotItems.indexOf(r), entry: entryFor('removed', [r], brief(r), null, removalReason(descriptionOf(r)), extra(r)) });
        }
        for (const a of slotItems.filter(i => kindOf(i) === 'absent')) {
            // absent rows carry the event (e.g. "Exkurze") as subject
            const note = descriptionOf(a) || a.subject || '';
            ordered.push({ at: slotItems.indexOf(a), entry: entryFor('absent', [a], null, null, note, { event: a.subject || '', ...extra(a) }) });
        }
        ordered.sort((x, y) => x.at - y.at).forEach(x => out.push(x.entry));
    }
    return out;
}

/* ── the changes board (aggregate) ─────────────────────────────────────── */

/**
 * All days the two aggregates describe, by calendar date.
 * @param {{ Actual?: object|null, Next?: object|null }} aggs
 * @param {Date} now - only for aggregates without dates (data before S2)
 * @returns {Array<{ date, source, day, items }>} sorted by date
 */
export function boardDayOptions(aggs, now = new Date()) {
    const out = new Map();
    const thisMonday = mondayIso(now);
    for (const source of ['Actual', 'Next']) {
        const agg = aggs && aggs[source];
        if (!agg || !Array.isArray(agg.days)) continue;
        const weekStart = agg.weekStart || (source === 'Actual' ? thisMonday : addDaysIso(thisMonday, 7));
        for (const d of agg.days) {
            if (!d || !Number.isInteger(d.day) || d.day < 0 || d.day > 4) continue;
            const date = d.date || addDaysIso(weekStart, d.day);
            if (!date || out.has(date)) continue; // Actual wins over a stale Next of the same week
            out.set(date, { date, source, day: d.day, items: Array.isArray(d.items) ? d.items : [] });
        }
    }
    return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Day shown by default: today, or the next school day on weekends, after
 * `switchAt` (kiosk: the afternoon) or when today is not in the data.
 * @param {Array<{date}>} options
 * @param {Date} now
 * @param {{ switchAt?: [number, number] | null }} [opts]
 * @returns {string|null} date
 */
export function pickBoardDate(options, now = new Date(), { switchAt = null } = {}) {
    if (!options || options.length === 0) return null;
    const today = isoDate(now);
    const late = switchAt && (now.getHours() * 60 + now.getMinutes() >= switchAt[0] * 60 + switchAt[1]);
    if (!late && options.some(o => o.date === today)) return today;
    const next = options.find(o => o.date > today);
    if (next) return next.date;
    // Everything is in the past (stale data): the last known day
    return options[options.length - 1].date;
}

/** Board entries of one day: merged substitutions, in class / hour order. */
export function boardEntries(dayOption) {
    if (!dayOption) return [];
    const items = [...dayOption.items].sort((a, b) => byName(a.className, b.className)
        || a.hour - b.hour || byName(a.group || '', b.group || ''));
    return mergeChangeItems(items, (it) => `${it.classId}|${it.hour}`);
}

/**
 * Filter by class id and/or teacher (full name from definitions). A teacher
 * matches as the substitute or as the teacher of the cancelled lesson.
 */
export function filterEntries(entries, { classId = '', teacher = '' } = {}) {
    return entries.filter(e => {
        if (classId && String(e.classId) !== String(classId)) return false;
        if (teacher) {
            const names = [e.before && e.before.teacher, e.after && e.after.teacher];
            if (!names.some(n => teachersMatch(n, teacher))) return false;
        }
        return true;
    });
}

/** [{ classId, className, entries }] in the order the entries come. */
export function groupByClass(entries) {
    const groups = new Map();
    for (const e of entries) {
        const id = String(e.classId ?? '');
        if (!groups.has(id)) groups.set(id, { classId: id, className: e.className || id, entries: [] });
        groups.get(id).entries.push(e);
    }
    return [...groups.values()];
}

/** Teacher names (as written in the data) that occur in the entries. */
export function teachersInEntries(entries) {
    const names = [];
    for (const e of entries) {
        for (const n of [e.before && e.before.teacher, e.after && e.after.teacher]) {
            if (n && !names.some(x => teachersMatch(x, n))) names.push(n);
        }
    }
    return names;
}

/* ── "what is different" against the permanent timetable ──────────────── */

const isFlagged = (l) => l && (l.changed || l.type === 'removed' || l.type === 'absent');

/** Lessons of the permanent timetable in the lesson's slot (same group first). */
export function permanentCounterparts(lesson, permanent) {
    const inSlot = (permanent || []).filter(p => p.day === lesson.day && p.hour === lesson.hour && p.type !== 'removed');
    const sameGroup = inSlot.filter(p => groupKey(p.group) === groupKey(lesson.group));
    if (sameGroup.length) return sameGroup;
    // e.g. a whole-class lesson replaced by a group lesson: only unambiguous fallbacks
    return inSlot.length === 1 ? inSlot : [];
}

/**
 * Changed / cancelled lessons of one timetable compared with its permanent
 * timetable, per day: "originally (permanent) → now (this week)".
 * The flags from Bakaláři decide WHAT changed (a plain diff would flag every
 * alternating odd/even-week lesson); the permanent timetable says what it
 * replaced when the change row itself does not.
 * @param {Array} actual - lessons of the week (Actual or Next)
 * @param {Array} [permanent] - lessons of the permanent timetable
 * @returns {Array<{ day, entries }>}
 */
export function weekChangesAgainstPermanent(actual, permanent = []) {
    const flagged = (actual || []).filter(isFlagged)
        .sort((a, b) => a.day - b.day || a.hour - b.hour || byName(a.group || '', b.group || ''));
    const entries = mergeChangeItems(flagged, (l) => `${l.day}|${l.hour}`);

    for (const e of entries) {
        const lesson = e.items[0];
        e.day = lesson.day;
        if (e.kind === 'removed') continue; // the struck lesson already is the original
        const counterpart = permanentCounterparts(lesson, permanent)[0];
        if (!counterpart) continue;
        const fromPermanent = brief(counterpart);
        if (e.kind === 'absent') {
            e.before = fromPermanent;
        } else if (!e.items.some(i => kindOf(i) === 'removed')) {
            // lone change: the permanent lesson is a better "before" than parsed text
            e.before = fromPermanent;
            e.kind = classifyPair(fromPermanent, e.after);
            const identical = same(fromPermanent.subject, e.after.subject)
                && teachersMatch(fromPermanent.teacher, e.after.teacher) && same(fromPermanent.room, e.after.room);
            // Same lesson as in the permanent timetable: only Bakaláři's note tells what changed
            e.note = identical ? descriptionOf(lesson) : '';
        }
    }

    const byDay = new Map();
    for (const e of entries) {
        if (!byDay.has(e.day)) byDay.set(e.day, []);
        byDay.get(e.day).push(e);
    }
    return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, list]) => ({ day, entries: list }));
}

/**
 * The entry that describes one lesson of the timetable (for its detail).
 * @returns {null | { kind, before, after, note }} - null for an unchanged lesson
 */
export function describeLessonChange(lesson, actual, permanent = []) {
    if (!isFlagged(lesson)) return null;
    for (const { entries } of weekChangesAgainstPermanent(actual, permanent)) {
        const hit = entries.find(e => e.items.includes(lesson));
        if (hit) return hit;
    }
    return null;
}

/* ── data age ──────────────────────────────────────────────────────────── */

function relativeTime(at, now) {
    const min = Math.max(0, Math.floor((now - at) / 60000));
    if (min < 1) return 'právě teď';
    if (min < 60) return `před ${min} min`;
    const hhmm = `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`;
    if (at.toDateString() === now.toDateString()) return `dnes v ${hhmm}`;
    return `${at.getDate()}. ${at.getMonth() + 1}. v ${hhmm}`;
}

const validDate = (v) => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(typeof v === 'object' && v.seconds ? v.seconds * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Human text about how fresh the board is.
 * `lastSuccessAt` (system/health via /api/status) says when Bakaláři were last
 * read successfully; `generatedAt` of an aggregate only changes when its
 * content changes, so it is the fallback.
 */
export function freshnessText({ lastSuccessAt = null, generatedAt = null, fromCache = false, cacheAgeMs = null } = {}, now = new Date()) {
    if (fromCache) {
        const at = cacheAgeMs != null ? new Date(now - cacheAgeMs) : null;
        return at ? `Offline – zobrazuji uložená data (${relativeTime(at, now)})` : 'Offline – zobrazuji uložená data';
    }
    const ok = validDate(lastSuccessAt);
    if (ok) return `Data z Bakalářů ověřena ${relativeTime(ok, now)}`;
    const gen = validDate(generatedAt);
    if (gen) return `Přehled naposledy změněn ${relativeTime(gen, now)}`;
    return '';
}
