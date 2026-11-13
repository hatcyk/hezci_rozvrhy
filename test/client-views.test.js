/**
 * Phase 2 views - pure functions of the frontend:
 *  - changes board: merging a substitution (changed + removed row) into one
 *    "originally → now" entry, day choice, filters (changes-core.js),
 *  - "what is different": the week against the permanent timetable,
 *  - free rooms now / next lesson (rooms-core.js),
 *  - common free time of several teachers / classes (common-free-core.js),
 *  - view URLs and the kiosk helpers.
 * The aggregates are built by the real backend code (backend/aggregates.js),
 * so the tests follow the S3 contract instead of a hand-written copy of it.
 * All names are made up.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildChangesAggregate, buildFreeRoomsAggregate } = require('../backend/aggregates');

globalThis.window = globalThis.window || { location: { search: '' }, addEventListener() {}, matchMedia: () => ({ matches: false }) };

const core = () => import('../public/js/changes-core.js');
const rooms = () => import('../public/js/rooms-core.js');
const common = () => import('../public/js/common-free-core.js');
const route = () => import('../public/js/view-route.js');
const kiosk = () => import('../public/js/kiosk-core.js');

const L = (day, hour, subject, teacher, room, extra = {}) => ({
    day, hour, subject, teacher, room, group: null, theme: null, type: 'atom', changed: false, changeInfo: null,
    date: `2026-11-0${2 + day}`, ...extra,
});
const removedCopy = (l) => ({ ...l, type: 'removed', changed: true, changeInfo: { raw: 'Hodina odpadla', description: 'Hodina odpadla' } });

// Wednesday 4. 11. 2026 (school week 2.–6. 11.)
const WED_0820 = new Date(2026, 10, 4, 8, 20); // 1st lesson running
const WED_0940 = new Date(2026, 10, 4, 9, 40); // break before the 3rd lesson
const WED_0700 = new Date(2026, 10, 4, 7, 0);  // before school
const WED_1600 = new Date(2026, 10, 4, 16, 0); // after the last lesson of the raster used below
const FRI_1600 = new Date(2026, 10, 6, 16, 0);
const SAT_1000 = new Date(2026, 10, 7, 10, 0);

/* ── changes board ────────────────────────────────────────────────────── */

/** One class week the way prefetch stores it: substitution = changed lesson + struck original. */
function classWeek() {
    const sub = L(2, 3, 'Matematika', 'Ing. Petr Vzorový', 'U12', {
        changed: true, changeInfo: { raw: 'x', description: 'Suplování: MAT, Vzorový Petr (FYZ, Testová Eva)' },
    });
    const original = removedCopy(L(2, 3, 'Fyzika', 'Mgr. Eva Testová', 'U15'));
    const roomNew = L(2, 4, 'Anglický jazyk', 'Mgr. Jana Ukázková', 'LAB2', {
        changed: true, changeInfo: { raw: 'x', description: 'Změna místnosti' },
    });
    const roomOld = removedCopy(L(2, 4, 'Anglický jazyk', 'Mgr. Jana Ukázková', 'U12'));
    const cancelled = { ...L(2, 5, 'Fyzika', 'T. Testová', 'U15'), type: 'removed', changed: true, changeInfo: { raw: 'Zrušeno', description: 'Zrušeno - Exkurze' } };
    const event = { ...L(2, 6, 'Exkurze', '', null), type: 'absent', changed: true, changeInfo: { raw: 'Akce', description: 'Exkurze (EXK)' } };
    // split class: only the 1st group is substituted, the 2nd has its lesson
    const g1new = L(2, 2, 'Programování', 'Mgr. Jana Ukázková', 'LAB2', { group: '1.sk', changed: true, changeInfo: { raw: 'x', description: 'Suplování: PRG, Ukázková Jana (PRG, Testová Eva)' } });
    const g1old = removedCopy(L(2, 2, 'Programování', 'Mgr. Eva Testová', 'LAB2', { group: '1.sk' }));
    const g2 = L(2, 2, 'Databázové systémy', 'Ing. Petr Vzorový', 'U12', { group: '2.sk' });
    const normal = L(2, 1, 'Český jazyk a literatura', 'Mgr. Jana Ukázková', 'U12');
    return [normal, g1new, g1old, g2, sub, original, roomNew, roomOld, cancelled, event];
}

test('merge: substitution, room change, cancellation and event become readable entries', async () => {
    const { mergeChangeItems, KIND_LABELS } = await core();
    const flagged = classWeek().filter(l => l.changed || l.type === 'removed' || l.type === 'absent');
    const entries = mergeChangeItems(flagged);
    assert.deepEqual(entries.map(e => [e.hour, e.kind]), [
        [2, 'substitution'], [3, 'substitution'], [4, 'roomChange'], [5, 'removed'], [6, 'absent'],
    ]);
    const sub = entries[1];
    assert.deepEqual(sub.before, { subject: 'Fyzika', teacher: 'Mgr. Eva Testová', room: 'U15' });
    assert.deepEqual(sub.after, { subject: 'Matematika', teacher: 'Ing. Petr Vzorový', room: 'U12' });
    assert.equal(sub.items.length, 2, 'both source rows are kept for lookups');
    assert.equal(entries[0].group, '1.sk');
    assert.equal(entries[3].note, 'Exkurze', 'reason of a cancellation without the "Zrušeno -" prefix');
    assert.equal(entries[3].after, null);
    assert.equal(entries[4].note, 'Exkurze (EXK)');
    assert.equal(KIND_LABELS.substitution, 'Suplování');
});

test('merge: a lone substitution row still says what it replaced (parsed from the description)', async () => {
    const { mergeChangeItems, originalFromDescription } = await core();
    const [e] = mergeChangeItems([{ hour: 3, group: null, kind: 'changed', subject: 'Matematika', teacher: 'Vzorový Petr', room: 'U12',
        description: 'Suplování: MAT, Vzorový Petr (FYZ, Testová Eva)' }]);
    assert.equal(e.kind, 'substitution');
    assert.deepEqual(e.before, { subject: 'FYZ', teacher: 'Testová Eva', room: '' });
    assert.equal(e.note, '');
    assert.equal(originalFromDescription('Změna místnosti: U12 → LAB2'), null);
    const [other] = mergeChangeItems([{ hour: 3, kind: 'changed', subject: 'X', teacher: 'Y', room: 'U1', description: 'Přesunuto' }]);
    assert.equal(other.kind, 'changed');
    assert.equal(other.before, null);
    assert.equal(other.note, 'Přesunuto', 'unknown change text is shown as it is');
});

test('merge: removed row without a group pairs with the only change of the slot', async () => {
    const { mergeChangeItems } = await core();
    const entries = mergeChangeItems([
        { hour: 2, group: '1.sk', kind: 'changed', subject: 'MAT', teacher: 'Vzorový Petr', room: 'U1', description: '' },
        { hour: 2, group: null, kind: 'removed', subject: 'FYZ', teacher: 'E. Testová', room: 'U2', description: 'Hodina odpadla' },
    ]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'substitution');
    // two cancelled + one change cannot be paired across groups unambiguously
    const two = mergeChangeItems([
        { hour: 2, group: '1.sk', kind: 'changed', subject: 'MAT', teacher: 'A B', room: '' },
        { hour: 2, group: null, kind: 'removed', subject: 'FYZ', teacher: 'C D', room: '' },
        { hour: 2, group: '3.sk', kind: 'removed', subject: 'FYZ', teacher: 'C D', room: '' },
    ]);
    assert.deepEqual(two.map(e => e.kind), ['changed', 'removed', 'removed']);
});

test('board: aggregate from the backend → one row per substitution, grouped by class', async () => {
    const { boardDayOptions, boardEntries, groupByClass, filterEntries, teachersInEntries } = await core();
    const weekB = [
        L(2, 3, 'Fyzika', 'Mgr. Eva Testová', 'U15'),
        { ...L(2, 4, 'Matematika', 'J. Ukázková', 'U12'), type: 'removed', changed: true, changeInfo: { description: 'Zrušeno - Nemoc' } },
    ];
    const agg = buildChangesAggregate([
        { id: 'C10', name: '10.A', weekStart: '2026-11-02', lessons: weekB },
        { id: 'C2', name: '2.A', weekStart: '2026-11-02', lessons: classWeek() },
    ], { generatedAt: '2026-11-04T07:00:00Z' });
    const options = boardDayOptions({ Actual: agg, Next: null }, WED_0820);
    assert.equal(options.length, 5);
    const wed = options.find(o => o.date === '2026-11-04');
    assert.equal(wed.items.length, 9, 'aggregate keeps the two rows of every substitution');

    const entries = boardEntries(wed);
    assert.equal(entries.length, 6, '9 rows → 6 entries (3 pairs merged)');
    const groups = groupByClass(entries);
    assert.deepEqual(groups.map(g => [g.className, g.entries.length]), [['2.A', 5], ['10.A', 1]], 'natural class order');

    assert.equal(filterEntries(entries, { classId: 'C10' }).length, 1);
    // full name from definitions matches the abbreviated teacher of a cancelled lesson …
    assert.equal(filterEntries(entries, { teacher: 'Ukázková Jana' }).length, 3);
    // … and the original teacher of a substitution
    assert.deepEqual(filterEntries(entries, { teacher: 'Testová Eva' }).map(e => e.kind), ['substitution', 'substitution']);
    assert.equal(filterEntries(entries, { classId: 'C2', teacher: 'Nikdo Neznámý' }).length, 0);
    assert.ok(teachersInEntries(entries).length >= 3);
});

test('board: default day is today, the next school day at the weekend / after the switch time', async () => {
    const { boardDayOptions, pickBoardDate, dayLabel, shortDayLabel } = await core();
    const mk = (weekStart) => buildChangesAggregate([{ id: 'C1', name: '1.A', weekStart, lessons: [] }], { generatedAt: 'x' });
    const options = boardDayOptions({ Actual: mk('2026-11-02'), Next: mk('2026-11-09') }, WED_0820);
    assert.equal(options.length, 10);
    assert.equal(pickBoardDate(options, WED_0820), '2026-11-04');
    assert.equal(pickBoardDate(options, WED_0820, { switchAt: [15, 0] }), '2026-11-04');
    assert.equal(pickBoardDate(options, WED_1600, { switchAt: [15, 0] }), '2026-11-05');
    assert.equal(pickBoardDate(options, FRI_1600, { switchAt: [15, 0] }), '2026-11-09', 'Friday afternoon → Monday of the next week');
    assert.equal(pickBoardDate(options, SAT_1000), '2026-11-09');
    assert.equal(pickBoardDate([], SAT_1000), null);
    assert.equal(dayLabel('2026-11-04', WED_0820), 'dnes, středa 4. 11.');
    assert.equal(dayLabel('2026-11-05', WED_0820), 'zítra, čtvrtek 5. 11.');
    assert.equal(dayLabel('2026-11-09', WED_0820), 'pondělí 9. 11.');
    assert.equal(shortDayLabel('2026-11-09', SAT_1000), 'Pondělí');
    // a Next aggregate still describing this week (not switched yet) does not duplicate days
    const stale = boardDayOptions({ Actual: mk('2026-11-02'), Next: mk('2026-11-02') }, WED_0820);
    assert.equal(stale.length, 5);
    assert.ok(stale.every(o => o.source === 'Actual'));
});

test('teacher names match across titles, word order and initials', async () => {
    const { teachersMatch, stripTitles } = await core();
    assert.equal(stripTitles('Ing. Bc. Jan Vzorek, Ph.D.'), 'Jan Vzorek');
    assert.ok(teachersMatch('Ing. Bc. Jan Vzorek MBA', 'Vzorek Jan'));
    assert.ok(teachersMatch('J. Vzorek', 'Mgr. Jan Vzorek'));
    assert.ok(teachersMatch('Vzorová Věra', 'V. Vzorová'));
    assert.ok(!teachersMatch('J. Vzorek', 'P. Vzorek'));
    assert.ok(!teachersMatch('', 'Jan Vzorek'));
    assert.ok(!teachersMatch('Jan Vzorek', 'Jana Vzorková'));
});

test('freshness text: last successful download first, aggregate change time as fallback', async () => {
    const { freshnessText } = await core();
    const now = new Date(2026, 10, 4, 10, 0);
    assert.equal(freshnessText({ lastSuccessAt: new Date(2026, 10, 4, 9, 55).toISOString() }, now), 'Data z Bakalářů ověřena před 5 min');
    assert.equal(freshnessText({ lastSuccessAt: new Date(2026, 10, 4, 7, 30).toISOString() }, now), 'Data z Bakalářů ověřena dnes v 7:30');
    assert.equal(freshnessText({ generatedAt: new Date(2026, 10, 3, 15, 5).toISOString() }, now), 'Přehled naposledy změněn 3. 11. v 15:05');
    assert.equal(freshnessText({ fromCache: true, cacheAgeMs: 20 * 60000 }, now), 'Offline – zobrazuji uložená data (před 20 min)');
    assert.equal(freshnessText({ lastSuccessAt: 'nonsense' }, now), '');
});

/* ── "what is different" against the permanent timetable ─────────────── */

test('week vs permanent: originally → now for substitutions, room changes and events', async () => {
    const { weekChangesAgainstPermanent, describeLessonChange } = await core();
    const permanent = [
        L(2, 3, 'Fyzika', 'Mgr. Eva Testová', 'U15', { date: null }),
        L(2, 6, 'Dějepis', 'Ing. Petr Vzorový', 'U12', { date: null }),
        L(3, 2, 'Matematika', 'Mgr. Jana Ukázková', 'U12', { date: null }),
    ];
    // Bakaláři flag a room change without a struck original: the permanent timetable supplies "before"
    const roomMoved = L(3, 2, 'Matematika', 'Mgr. Jana Ukázková', 'LAB2', { changed: true, changeInfo: { description: 'Změna místnosti' } });
    const actual = [...classWeek(), roomMoved, L(3, 3, 'Fyzika', 'Mgr. Eva Testová', 'U15')];
    const days = weekChangesAgainstPermanent(actual, permanent);
    assert.deepEqual(days.map(d => d.day), [2, 3]);
    const wed = days[0].entries;
    assert.deepEqual(wed.map(e => e.kind), ['substitution', 'substitution', 'roomChange', 'removed', 'absent']);
    assert.deepEqual(wed[4].before, { subject: 'Dějepis', teacher: 'Ing. Petr Vzorový', room: 'U12' }, 'event: what does not take place');
    const thu = days[1].entries[0];
    assert.equal(thu.kind, 'roomChange');
    assert.deepEqual([thu.before.room, thu.after.room], ['U12', 'LAB2']);

    // lesson detail: the change row and the struck original point to the same entry
    const sub = actual.find(l => l.day === 2 && l.hour === 3 && l.type !== 'removed');
    const orig = actual.find(l => l.day === 2 && l.hour === 3 && l.type === 'removed');
    const a = describeLessonChange(sub, actual, permanent);
    const b = describeLessonChange(orig, actual, permanent);
    assert.equal(a.kind, 'substitution');
    assert.deepEqual([a.before, a.after], [b.before, b.after]);
    assert.equal(describeLessonChange(actual[0], actual, permanent), null, 'unchanged lesson → nothing to explain');
});

test('week vs permanent: a substitute teacher\'s extra lesson falls back to the change text', async () => {
    const { describeLessonChange } = await core();
    const extra = { ...L(1, 4, 'Matematika', '', 'U12'), group: '2.A', changed: true,
        changeInfo: { description: 'Suplování: MAT, Vzorový Petr (FYZ, Testová Eva)' } };
    const e = describeLessonChange(extra, [extra], []);
    assert.equal(e.kind, 'substitution');
    assert.equal(e.before.subject, 'FYZ');
});

/* ── free rooms ──────────────────────────────────────────────────────── */

function roomsAgg() {
    const hours = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const busy = (day, hour, extra = {}) => ({ day, hour, subject: 'X', teacher: 'Y', room: null, type: 'atom', ...extra });
    return buildFreeRoomsAggregate([
        { id: 'R1', name: 'U12', weekStart: '2026-11-02', lessons: [busy(2, 1), busy(2, 3)] },
        { id: 'R2', name: 'U15', weekStart: '2026-11-02', lessons: [busy(2, 3, { type: 'removed' }), busy(2, 4)] },
        { id: 'R3', name: 'LAB2', weekStart: '2026-11-02', lessons: [busy(2, 1), busy(2, 2), busy(2, 3)] },
    ], { generatedAt: 'x', hours });
}

test('free rooms: now / next lesson by the clock, cancelled lesson frees the room, hidden rooms', async () => {
    const { rasterHours, freeRoomsAt, defaultRoomSlots, hourLabel, parseHiddenRooms, toggleHiddenRoom } = await rooms();
    const agg = roomsAgg();
    const hours = rasterHours(agg);
    assert.deepEqual(hours, [0, 1, 2, 3, 4, 5, 6, 7, 8]);

    assert.deepEqual(defaultRoomSlots(WED_0820, hours), {
        primary: { when: 'now', week: 'Actual', day: 2, hour: 1 },
        secondary: { when: 'next', week: 'Actual', day: 2, hour: 2 },
    });
    assert.deepEqual(defaultRoomSlots(WED_0940, hours).primary, { when: 'upcoming', week: 'Actual', day: 2, hour: 3 });
    assert.deepEqual(defaultRoomSlots(WED_0700, hours).primary, { when: 'upcoming', week: 'Actual', day: 2, hour: 0 });
    assert.deepEqual(defaultRoomSlots(new Date(2026, 10, 4, 19, 0), hours).primary, { when: 'nextDay', week: 'Actual', day: 3, hour: 1 });
    assert.deepEqual(defaultRoomSlots(FRI_1600, hours).primary, { when: 'nextDay', week: 'Next', day: 0, hour: 1 });
    assert.deepEqual(defaultRoomSlots(SAT_1000, hours).secondary, { when: 'next', week: 'Next', day: 0, hour: 2 });
    // last lesson of the raster: no "next"
    assert.equal(defaultRoomSlots(new Date(2026, 10, 4, 14, 30), [1, 2, 8]).secondary, null);

    assert.deepEqual(freeRoomsAt(agg, 2, 3).rooms.map(r => r.name), ['U15'], 'removed lesson in U15 frees it');
    assert.deepEqual(freeRoomsAt(agg, 2, 1).rooms.map(r => r.id), ['R2']);
    const hidden = freeRoomsAt(agg, 2, 5, ['R3']);
    assert.deepEqual(hidden.rooms.map(r => r.id), ['R1', 'R2'], 'rooms in name order (U12, U15)');
    assert.equal(hidden.hiddenCount, 1);
    assert.deepEqual(freeRoomsAt(agg, 2, 11), { known: false, rooms: [], hiddenCount: 0 }, 'outside the raster = unknown, not "none free"');
    assert.equal(hourLabel(3), '3. hodina (9:45–10:30)');

    assert.deepEqual(parseHiddenRooms('["R1","R1",2]'), ['R1', '2']);
    assert.deepEqual(parseHiddenRooms('{bad'), []);
    assert.deepEqual(parseHiddenRooms('{"a":1}'), []);
    assert.deepEqual(toggleHiddenRoom(['R1'], 'R2'), ['R1', 'R2']);
    assert.deepEqual(toggleHiddenRoom(['R1', 'R2'], 'R1'), ['R2']);
});

/* ── common free time ────────────────────────────────────────────────── */

test('common free time: busy if anyone teaches; cancelled lesson frees; absent stays busy', async () => {
    const { commonFreeSlots, freeRanges, rangeLabel } = await common();
    const t1 = [L(0, 1, 'A', '', ''), L(0, 2, 'A', '', ''), L(0, 5, 'A', '', ''), { ...L(0, 4, 'A', '', ''), type: 'removed' }];
    const t2 = [L(0, 1, 'B', '', ''), L(0, 3, 'B', '', ''), L(0, 6, 'B', '', ''), { ...L(1, 1, 'B', '', ''), type: 'absent' }];
    const cls = [L(0, 1, 'C', '', ''), L(0, 2, 'C', '', ''), L(0, 3, 'C', '', ''), L(0, 4, 'C', '', '')];
    const r = commonFreeSlots([
        { id: 'Teacher:T1', label: 'J. Ukázková', lessons: t1 },
        { id: 'Teacher:T2', label: 'P. Vzorový', lessons: t2 },
    ]);
    assert.deepEqual(r.hours, [1, 2, 3, 4, 5, 6]);
    const mon = r.rows[0].cells;
    assert.deepEqual(mon.filter(c => c.free).map(c => c.hour), [4], 'removed lesson of T1 frees the 4th hour');
    assert.equal(mon[3].ideal, true, 'both teach before and after → both are at school');
    assert.deepEqual(mon[0].busy, ['J. Ukázková', 'P. Vzorový']);
    const tue = r.rows[1].cells;
    assert.equal(tue[0].free, false, 'absent counts as busy');
    assert.ok(tue[1].free && !tue[1].ideal, 'free but nobody has lessons around → not ideal');
    assert.deepEqual(tue[1].away, ['J. Ukázková', 'P. Vzorový']);

    const withClass = commonFreeSlots([{ id: 'a', label: 'J. Ukázková', lessons: t1 }, { id: 'b', label: '9.Z', lessons: cls }], { days: [0] });
    assert.deepEqual(withClass.rows[0].cells.filter(c => c.free).map(c => c.hour), []);
    const ranges = freeRanges(commonFreeSlots([{ id: 'a', label: 'A', lessons: t1 }, { id: 'b', label: 'B', lessons: [L(0, 1, 'x', '', ''), L(0, 7, 'x', '', '')] }], { days: [0] }));
    assert.deepEqual(ranges[0].ranges, [{ from: 3, to: 4, ideal: true }, { from: 6, to: 6, ideal: false }]);
    assert.equal(rangeLabel({ from: 3, to: 4 }), '3.–4. hodina (9:45–11:35)');
    assert.equal(rangeLabel({ from: 6, to: 6 }), '6. hodina (12:35–13:20)');
    assert.deepEqual(commonFreeSlots([]).rows[0].cells.every(c => !c.free), true, 'no selection → nothing is "free for all"');
});

test('common free time: selection in the URL is validated and capped at 6', async () => {
    const { parseEntityList, formatEntityList, MAX_ENTITIES } = await common();
    assert.deepEqual(parseEntityList('Teacher:T1,Class:XX,Teacher:T1,Room:R1,<b>:x'), [{ type: 'Teacher', id: 'T1' }, { type: 'Class', id: 'XX' }]);
    const many = Array.from({ length: 9 }, (_, i) => `Teacher:T${i}`).join(',');
    assert.equal(parseEntityList(many).length, MAX_ENTITIES);
    assert.equal(formatEntityList([{ type: 'Teacher', id: 'T1' }, { type: 'Class', id: 'XX' }]), 'Teacher:T1,Class:XX');
});

/* ── routes, kiosk ───────────────────────────────────────────────────── */

test('view routes: deep links per view, invalid parameters dropped, kiosk', async () => {
    const { parseRoute, routeUrl, timetableUrl } = await route();
    assert.deepEqual(parseRoute(''), { kiosk: null, view: 'timetable', params: {} });
    assert.deepEqual(parseRoute('?view=changes&date=2026-11-05&class=XX&teacher=T1&hour=3'),
        { kiosk: null, view: 'changes', params: { date: '2026-11-05', class: 'XX', teacher: 'T1' } });
    assert.deepEqual(parseRoute('?view=rooms&date=bad&hour=3').params, { hour: '3' });
    assert.deepEqual(parseRoute('?view=rooms&hour=99').params, {});
    assert.deepEqual(parseRoute('?view=common&with=Teacher:T1,Class:XX&week=next').params, { with: 'Teacher:T1,Class:XX', week: 'next' });
    assert.equal(parseRoute('?view=changes&class=<script>').params.class, undefined);
    assert.deepEqual(parseRoute('?kiosk=changes'), { kiosk: 'changes', view: 'changes', params: {} });
    assert.equal(parseRoute('?kiosk=evil').kiosk, null);
    assert.equal(routeUrl('changes', { date: '2026-11-05', class: '', teacher: 'T1' }), '/?view=changes&date=2026-11-05&teacher=T1');
    assert.equal(routeUrl('timetable', { date: 'x' }), '/');
    assert.equal(routeUrl('nope'), '/');
    assert.equal(timetableUrl({ type: 'Room', id: 'R1', schedule: 'actual', day: 2 }), '/?type=Room&id=R1&schedule=Actual&day=2');
    // round trip with the existing deep-link parser
    const { parseDeepLinkParams } = await import('../public/js/deeplink.js');
    assert.deepEqual(parseDeepLinkParams(timetableUrl({ type: 'Room', id: 'R1', schedule: 'next', day: 4 }).slice(1)),
        { type: 'Room', id: 'R1', schedule: 'next', day: 4, highlight: false });
});

test('kiosk: nightly reload time, lesson status line, auto-scroll steps', async () => {
    const { msUntilNightlyReload, lessonNowText, nextScroll, clockText } = await kiosk();
    assert.equal(msUntilNightlyReload(new Date(2026, 10, 4, 2, 0)), 60 * 60000);
    assert.equal(msUntilNightlyReload(new Date(2026, 10, 4, 8, 0)), 19 * 3600000);
    assert.equal(msUntilNightlyReload(new Date(2026, 10, 4, 3, 0)), 24 * 3600000, 'exactly 3:00 → tomorrow, no reload loop');
    assert.equal(msUntilNightlyReload(new Date(2026, 10, 4, 2, 0), { jitterMs: 5000 }), 60 * 60000 + 5000);

    assert.equal(lessonNowText(WED_0820), 'Probíhá 1. hodina (do 8:45)');
    assert.equal(lessonNowText(WED_0940), 'Přestávka – 3. hodina začne v 9:45');
    assert.equal(lessonNowText(WED_0700), 'Před vyučováním – 0. hodina začne v 7:10');
    assert.equal(lessonNowText(new Date(2026, 10, 4, 20, 0)), 'Mimo vyučování');
    assert.equal(lessonNowText(SAT_1000), 'Víkend');
    assert.equal(clockText(WED_0820).time, '8:20');

    // continuous: moves by speed × time, holds at the end, then back to the top
    assert.deepEqual(nextScroll({ top: 0, max: 300, viewport: 500, mode: 'smooth', dtMs: 1000, speed: 30 }), { top: 30, wait: 0 });
    assert.deepEqual(nextScroll({ top: 290, max: 300, viewport: 500, mode: 'smooth', dtMs: 1000, speed: 30 }), { top: 300, wait: 6000 });
    assert.deepEqual(nextScroll({ top: 300, max: 300, viewport: 500, mode: 'smooth', dtMs: 16 }), { top: 0, wait: 6000 });
    // reduced motion: whole screens, no in-between positions
    assert.deepEqual(nextScroll({ top: 0, max: 900, viewport: 500, mode: 'paged' }), { top: 460, wait: 12000 });
    assert.deepEqual(nextScroll({ top: 900, max: 900, viewport: 500, mode: 'paged' }), { top: 0, wait: 12000 });
    assert.deepEqual(nextScroll({ top: 0, max: 0, viewport: 500, mode: 'paged' }), { top: 0, wait: 6000 }, 'fits on screen → no scrolling');
});
