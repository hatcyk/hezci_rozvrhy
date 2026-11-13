// iCal export (RFC 5545): generator, a small independent validator and the route.
// Synthetic timetable data only (invented subjects, teachers and rooms).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fromZonedTime } = require('date-fns-tz');
const { createFakeFirestore, stubFirebase, listen } = require('./helpers/fake-firestore');

process.env.NODE_ENV = 'test';
delete process.env.SEMESTER_END;
delete process.env.ICAL_ENABLED;

const ical = require('../backend/ical');

// ─── minimal validator (independent of the generator) ───────────────────────

/**
 * Checks what calendar clients rely on: CRLF only, ≤ 75 octets per line,
 * folding, balanced BEGIN/END, required properties, defined TZIDs, escaped
 * TEXT, DTEND after DTSTART, unique UIDs. Returns the unfolded components.
 */
function validateIcs(text) {
    const errors = [];
    if (/[^\r]\n/.test(text) || /\r(?!\n)/.test(text)) errors.push('line ends must be CRLF');
    if (!text.endsWith('\r\n')) errors.push('must end with CRLF');
    const physical = text.split('\r\n').slice(0, -1);
    physical.forEach((l, i) => {
        if (Buffer.byteLength(l, 'utf8') > 75) errors.push(`line ${i + 1} longer than 75 octets`);
        if (l.includes('�')) errors.push(`line ${i + 1} has a broken UTF-8 character`);
    });
    // Unfold (RFC 5545 3.1): CRLF + one space/tab is removed.
    const lines = [];
    for (const l of physical) {
        if (/^[ \t]/.test(l)) {
            if (!lines.length) errors.push('continuation without a line');
            else lines[lines.length - 1] += l.slice(1);
        } else lines.push(l);
    }
    const stack = [];
    const components = [];
    for (const line of lines) {
        const m = line.match(/^([A-Z0-9-]+)((?:;[^:]*)?):(.*)$/);
        if (!m) { errors.push(`unparsable line: ${line.slice(0, 40)}`); continue; }
        const [, name, params, value] = m;
        if (name === 'BEGIN') { stack.push({ type: value, props: [] }); continue; }
        if (name === 'END') {
            const top = stack.pop();
            if (!top || top.type !== value) errors.push(`END:${value} does not close ${top && top.type}`);
            else components.push(top);
            if (stack.length) stack[stack.length - 1].children = [...(stack[stack.length - 1].children || []), top];
            continue;
        }
        if (!stack.length) { errors.push(`property ${name} outside a component`); continue; }
        stack[stack.length - 1].props.push({ name, params, value });
    }
    if (stack.length) errors.push('unclosed component');

    const prop = (c, n) => c.props.find(p => p.name === n);
    const cal = components.find(c => c.type === 'VCALENDAR');
    if (!cal) errors.push('no VCALENDAR');
    else for (const n of ['VERSION', 'PRODID']) if (!prop(cal, n)) errors.push(`VCALENDAR without ${n}`);
    const tzids = new Set(components.filter(c => c.type === 'VTIMEZONE').map(c => prop(c, 'TZID').value));
    const events = components.filter(c => c.type === 'VEVENT');
    const uids = new Set();
    for (const e of events) {
        for (const n of ['UID', 'DTSTAMP', 'DTSTART']) if (!prop(e, n)) errors.push(`VEVENT without ${n}`);
        const uid = prop(e, 'UID') && prop(e, 'UID').value;
        if (uids.has(uid)) errors.push(`duplicate UID ${uid}`);
        uids.add(uid);
        if (!/^\d{8}T\d{6}Z$/.test(prop(e, 'DTSTAMP').value)) errors.push('DTSTAMP must be UTC');
        for (const p of e.props) {
            const tz = p.params.match(/TZID=([^;]+)/);
            if (tz && !tzids.has(tz[1])) errors.push(`TZID ${tz[1]} not defined`);
            if (['SUMMARY', 'DESCRIPTION', 'LOCATION'].includes(p.name) && /(^|[^\\])[;,]/.test(p.value.replace(/\\\\/g, ''))) {
                errors.push(`${p.name} has an unescaped ; or ,`);
            }
        }
        const start = prop(e, 'DTSTART').value;
        const end = prop(e, 'DTEND') && prop(e, 'DTEND').value;
        if (end && end <= start) errors.push(`DTEND not after DTSTART (${uid})`);
        const rrule = prop(e, 'RRULE');
        if (rrule && /DTSTART;TZID/.test(`DTSTART${prop(e, 'DTSTART').params}`) && !/UNTIL=\d{8}T\d{6}Z/.test(rrule.value)) {
            errors.push('UNTIL must be UTC when DTSTART has a TZID (RFC 5545 3.3.10)');
        }
    }
    return { errors, events, components, prop };
}

/** Text value of an event property, unescaped. */
const unescape = (v) => v.replace(/\\n/g, '\n').replace(/\\([;,\\])/g, '$1');

/**
 * UTC instant of a local DTSTART using the VTIMEZONE rules of the file
 * (last Sunday of March 02:00 → +2, last Sunday of October 03:00 → +1),
 * computed here without date-fns-tz, to cross-check the embedded zone.
 */
function utcFromVtimezone(local) {
    const [, y, mo, d, h, mi] = local.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/).map(Number);
    const lastSunday = (month) => { const last = new Date(Date.UTC(y, month, 0)); return last.getUTCDate() - last.getUTCDay(); };
    const key = mo * 1e6 + d * 1e4 + h * 100 + mi;
    const summer = key >= 3 * 1e6 + lastSunday(3) * 1e4 + 200 && key < 10 * 1e6 + lastSunday(10) * 1e4 + 300;
    return new Date(Date.UTC(y, mo - 1, d, h - (summer ? 2 : 1), mi)).toISOString();
}

// ─── synthetic data ────────────────────────────────────────────────────────

const lesson = (day, hour, subject, extra = {}) => ({
    day, dayName: ['po', 'út', 'st', 'čt', 'pá'][day], hour, subject, teacher: 'Ing. Synt. Učitelka', room: `U${100 + hour}`,
    group: null, theme: null, type: 'atom', changed: false, changeInfo: null, date: null, ...extra,
});
const addDays = (isoDate, n) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const week = (weekStart) => [
    lesson(0, 1, 'Matematika', { date: weekStart }),
    lesson(0, 2, 'Programování', { group: '1.sk', date: weekStart }),
    lesson(0, 2, 'Databázové systémy', { group: '2.sk', date: weekStart }),
    // substitution: the changed lesson + the struck-through original in the same slot
    lesson(1, 3, 'Fyzika', { date: addDays(weekStart, 1), changed: true, teacher: 'Mgr. Zástup', changeInfo: { description: 'Suplování; za Ing. Synt. Učitelku, učebna změněna' } }),
    lesson(1, 3, 'Chemie', { date: addDays(weekStart, 1), type: 'removed', changed: true, changeInfo: { description: 'Hodina odpadla' } }),
    lesson(3, 4, 'Český jazyk a literatura', { date: addDays(weekStart, 3), theme: 'Žluťoučký kůň úpěl ďábelské ódy – velmi dlouhé téma hodiny, aby se řádek musel zalomit podle oktetů' }),
    lesson(4, 0, 'Tělesná výchova', { date: addDays(weekStart, 4), type: 'absent', changed: true, changeInfo: { description: 'Exkurze' } }),
];
const snapshot = (weekStart, extra = {}) => ({
    type: 'Class', id: 'SYN', name: 'SYN.A', scheduleType: 'Actual', weekStart, data: week(weekStart),
    daysOff: [{ day: 2, date: addDays(weekStart, 2), name: 'ředitelské volno' }],
    lastUpdate: '2026-11-04T08:15:00.000Z', ...extra,
});
const TT = { type: 'Class', id: 'SYN', name: 'SYN.A' };
const NOW = new Date('2026-11-04T09:00:00Z');

// ─── unit tests ────────────────────────────────────────────────────────────

test('escapeText escapuje \\ ; , a nové řádky (RFC 5545 3.3.11)', () => {
    assert.equal(ical.escapeText('a\\b;c,d\ne\r\nf'), 'a\\\\b\\;c\\,d\\ne\\nf');
    assert.equal(ical.escapeText(null), '');
});

test('foldLine: nejvýš 75 oktetů, nerozdělí znak UTF-8, rozbalení vrátí původní text', () => {
    const line = 'DESCRIPTION:' + 'Žluťoučký kůň úpěl ďábelské ódy. '.repeat(8);
    const folded = ical.foldLine(line);
    for (const part of folded.split('\r\n')) assert.ok(Buffer.byteLength(part) <= 75, part);
    assert.equal(folded.split('\r\n').map((p, i) => (i ? p.slice(1) : p)).join(''), line);
    assert.ok(!Buffer.from(folded).toString('utf8').includes('�'));
    assert.equal(ical.foldLine('SHORT:x'), 'SHORT:x');
});

test('konec pololetí: SEMESTER_END, jinak 31. 1. nebo 30. 6. podle data', () => {
    assert.equal(ical.semesterEnd(new Date('2026-11-04T09:00:00Z'), {}), '2027-01-31');
    assert.equal(ical.semesterEnd(new Date('2027-01-15T09:00:00Z'), {}), '2027-01-31');
    assert.equal(ical.semesterEnd(new Date('2027-02-01T09:00:00Z'), {}), '2027-06-30');
    assert.equal(ical.semesterEnd(new Date('2027-07-10T09:00:00Z'), {}), '2028-01-31');
    // 31. 1. 23:30 UTC is already 1. 2. in Prague
    assert.equal(ical.semesterEnd(new Date('2027-01-31T23:30:00Z'), {}), '2027-06-30');
    assert.equal(ical.semesterEnd(new Date('2026-11-04T09:00:00Z'), { SEMESTER_END: '2027-01-29' }), '2027-01-29');
    assert.equal(ical.semesterEnd(new Date('2026-11-04T09:00:00Z'), { SEMESTER_END: '2026-06-30' }), '2027-01-31', 'past value ignored');
    assert.equal(ical.semesterEnd(new Date('2026-11-04T09:00:00Z'), { SEMESTER_END: 'leden' }), '2027-01-31');
});

test('UNTIL je konec dne v Praze v UTC (zima +1, léto +2)', () => {
    assert.equal(ical.untilUtc('2027-01-31'), '20270131T225959Z');
    assert.equal(ical.untilUtc('2027-06-30'), '20270630T215959Z');
});

test('aktuální týden: platný soubor, data a časy hodin, zrušené CANCELLED, volno celodenní', () => {
    const text = ical.buildCalendar({ timetable: TT, sources: [{ schedule: 'actual', snapshot: snapshot('2026-11-02') }], now: NOW });
    const { errors, events, prop } = validateIcs(text);
    assert.deepEqual(errors, []);
    assert.equal(events.length, 8, '7 lessons + 1 day off');

    const math = events.find(e => prop(e, 'SUMMARY').value === 'Matematika');
    assert.equal(prop(math, 'DTSTART').params, ';TZID=Europe/Prague');
    assert.equal(prop(math, 'DTSTART').value, '20261102T080000');
    assert.equal(prop(math, 'DTEND').value, '20261102T084500');
    assert.equal(prop(math, 'LOCATION').value, 'U101');
    assert.equal(prop(math, 'STATUS').value, 'CONFIRMED');
    assert.equal(prop(math, 'DTSTAMP').value, '20261104T081500Z', 'DTSTAMP = last data update');

    const cancelled = events.filter(e => (prop(e, 'STATUS') || {}).value === 'CANCELLED').map(e => unescape(prop(e, 'SUMMARY').value));
    assert.deepEqual(cancelled.sort(), ['Odpadá: Chemie', 'Odpadá: Tělesná výchova']);
    const sub = events.find(e => prop(e, 'SUMMARY').value.startsWith('Změna: Fyzika'));
    assert.match(unescape(prop(sub, 'DESCRIPTION').value), /Změna: Suplování; za Ing\. Synt\. Učitelku, učebna změněna/);
    assert.equal(prop(sub, 'TRANSP').value, 'OPAQUE');

    const off = events.find(e => /^Volno/.test(prop(e, 'SUMMARY').value));
    assert.equal(prop(off, 'DTSTART').params, ';VALUE=DATE');
    assert.equal(prop(off, 'DTSTART').value, '20261104');
    assert.equal(prop(off, 'DTEND').value, '20261105');
    assert.equal(unescape(prop(off, 'SUMMARY').value), 'Volno: ředitelské volno');

    const theme = events.find(e => prop(e, 'SUMMARY').value.startsWith('Český'));
    assert.match(unescape(prop(theme, 'DESCRIPTION').value), /velmi dlouhé téma hodiny, aby se řádek musel zalomit podle oktetů/);
});

test('VTIMEZONE odpovídá date-fns-tz i přes konec letního času (26. 10. 2026)', () => {
    const text = ical.buildCalendar({
        timetable: TT,
        sources: [{ schedule: 'actual', snapshot: snapshot('2026-10-19') }, { schedule: 'next', snapshot: snapshot('2026-10-26') }],
        now: new Date('2026-10-20T09:00:00Z'),
    });
    const { errors, events, prop } = validateIcs(text);
    assert.deepEqual(errors, []);
    const timed = events.filter(e => prop(e, 'DTSTART').params.includes('TZID'));
    assert.ok(timed.length >= 12);
    for (const e of timed) {
        const local = prop(e, 'DTSTART').value;
        const viaLib = fromZonedTime(local.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6'), 'Europe/Prague').toISOString();
        assert.equal(utcFromVtimezone(local), viaLib, local);
    }
    // 8:00 is 6:00 UTC in the CEST week and 7:00 UTC after the change
    assert.equal(utcFromVtimezone('20261019T080000'), '2026-10-19T06:00:00.000Z');
    assert.equal(utcFromVtimezone('20261026T080000'), '2026-10-26T07:00:00.000Z');
});

test('UID jsou stabilní mezi staženími a suplování drží UID slotu', () => {
    const build = (snap) => ical.buildCalendar({ timetable: TT, sources: [{ schedule: 'actual', snapshot: snap }], now: NOW });
    const a = validateIcs(build(snapshot('2026-11-02')));
    const b = validateIcs(build(snapshot('2026-11-02', { lastUpdate: '2026-11-04T08:30:00.000Z' })));
    const uids = (r) => r.events.map(e => r.prop(e, 'UID').value).sort();
    assert.deepEqual(uids(a), uids(b));
    for (const uid of uids(a)) assert.match(uid, /^[A-Za-z0-9._-]+@lepsi-rozvrh$/);

    // the teacher changes in a later download: same UID, new content
    const changed = snapshot('2026-11-02');
    changed.data[0] = { ...changed.data[0], teacher: 'Mgr. Jiná', changed: true };
    const c = validateIcs(build(changed));
    const uidOf = (r, summary) => r.prop(r.events.find(e => r.prop(e, 'SUMMARY').value.endsWith(summary)), 'UID').value;
    assert.equal(uidOf(a, 'Matematika'), uidOf(c, 'Matematika'));
    // same bytes for the same data (ETag / 304 work)
    assert.equal(build(snapshot('2026-11-02')), build(snapshot('2026-11-02')));
});

test('stálý rozvrh: týdenní opakování od tohoto týdne do konce pololetí', () => {
    const permanent = { type: 'Class', id: 'SYN', name: 'SYN.A', scheduleType: 'Permanent', weekStart: null, data: week('2026-11-02').map(l => ({ ...l, date: null })), lastUpdate: '2026-09-01T05:00:00.000Z' };
    const text = ical.buildCalendar({ timetable: TT, sources: [{ schedule: 'permanent', snapshot: permanent }], now: NOW, env: {} });
    const { errors, events, prop } = validateIcs(text);
    assert.deepEqual(errors, []);
    assert.equal(events.length, 5, 'no day-off events, no cancelled lessons in a weekly series');
    assert.ok(events.every(e => prop(e, 'STATUS').value === 'CONFIRMED' && !/^(Změna|Odpadá)/.test(prop(e, 'SUMMARY').value)));
    for (const e of events) assert.equal(prop(e, 'RRULE').value, 'FREQ=WEEKLY;UNTIL=20270131T225959Z');
    const monday = events.find(e => prop(e, 'SUMMARY').value === 'Matematika');
    assert.equal(prop(monday, 'DTSTART').value, '20261102T080000', 'Monday of the current week');
    const thursday = events.find(e => prop(e, 'SUMMARY').value.startsWith('Český'));
    assert.equal(prop(thursday, 'DTSTART').value, '20261105T105000');
    assert.match(text, /X-WR-CALNAME:Rozvrh SYN\.A \(stálý\)/);
});

test('filtr skupiny: hodiny celé třídy zůstanou, cizí skupina zmizí', () => {
    const text = ical.buildCalendar({ timetable: TT, sources: [{ schedule: 'actual', snapshot: snapshot('2026-11-02') }], groups: ['1.sk'], now: NOW });
    const { errors, events, prop } = validateIcs(text);
    assert.deepEqual(errors, []);
    const summaries = events.map(e => unescape(prop(e, 'SUMMARY').value));
    assert.ok(summaries.includes('Programování (1.sk)'));
    assert.ok(!summaries.some(s => s.includes('2.sk')));
    assert.ok(summaries.includes('Matematika'));
});

test('parseScheduleParam a ICAL_ENABLED', () => {
    assert.deepEqual(ical.parseScheduleParam(undefined), { schedules: ['actual', 'next'] });
    assert.deepEqual(ical.parseScheduleParam('Permanent'), { schedules: ['permanent'] });
    assert.ok(ical.parseScheduleParam('permanent,actual').error);
    assert.ok(ical.parseScheduleParam('tomorrow').error);
    assert.equal(ical.isIcalEnabled({}), true);
    assert.equal(ical.isIcalEnabled({ ICAL_ENABLED: 'false' }), false);
    assert.equal(ical.isIcalEnabled({ ICAL_ENABLED: '0' }), false);
});

// ─── route ─────────────────────────────────────────────────────────────────

const db = createFakeFirestore({
    'timetables/Class_SYN_Actual': snapshot('2026-11-02'),
    'timetables/Class_SYN_Next': snapshot('2026-11-09', { scheduleType: 'Next', daysOff: [] }),
    'timetables/Class_SYN_Permanent': { type: 'Class', id: 'SYN', name: 'SYN.A', scheduleType: 'Permanent', weekStart: null, data: week('2026-11-02').map(l => ({ ...l, date: null })) },
});
stubFirebase(db);
const { createApp } = require('../routes');

let base, close;
test.before(async () => { ({ base, close } = await listen(createApp({ staticDir: null }))); });
test.after(() => close());

test('GET /api/ical/Class/SYN.ics: text/calendar, cache, ETag/304, oba týdny', async () => {
    const r = await fetch(`${base}/api/ical/Class/SYN.ics`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/calendar; charset=utf-8');
    assert.match(r.headers.get('cache-control'), /max-age=900/);
    const text = await r.text();
    const { errors, events, prop } = validateIcs(text);
    assert.deepEqual(errors, []);
    const dates = new Set(events.map(e => prop(e, 'DTSTART').value.slice(0, 8)));
    assert.ok(dates.has('20261102') && dates.has('20261109'), 'this and next week');

    const etag = r.headers.get('etag');
    assert.ok(etag);
    // node:http, because fetch() adds "Cache-Control: no-cache" to conditional
    // requests, and a no-cache request is never answered with 304.
    const status = await new Promise((resolve, reject) => {
        http.get(`${base}/api/ical/Class/SYN.ics`, { headers: { 'if-none-match': etag } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(status, 304);
});

test('GET /api/ical: stálý, skupina, chyby vstupu, neexistující rozvrh, vypnutí', async () => {
    const perm = await fetch(`${base}/api/ical/Class/SYN.ics?schedule=permanent&group=2.sk`);
    assert.equal(perm.status, 200);
    const text = await perm.text();
    assert.match(text, /RRULE:FREQ=WEEKLY;UNTIL=/);
    assert.ok(!text.includes('(1.sk)'));

    assert.equal((await fetch(`${base}/api/ical/Hacker/SYN.ics`)).status, 400);
    assert.equal((await fetch(`${base}/api/ical/Class/SYN.ics?schedule=permanent,next`)).status, 400);
    assert.equal((await fetch(`${base}/api/ical/Class/SYN.ics?group=${encodeURIComponent('<script>')}`)).status, 400);
    assert.equal((await fetch(`${base}/api/ical/Class/NOPE.ics`)).status, 404);
    assert.equal((await fetch(`${base}/api/ical/Class/SYN`)).status, 404);

    process.env.ICAL_ENABLED = 'false';
    try {
        assert.equal((await fetch(`${base}/api/ical/Class/SYN.ics`)).status, 404);
    } finally {
        delete process.env.ICAL_ENABLED;
    }
});
