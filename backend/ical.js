/**
 * iCalendar (RFC 5545) export of one timetable, for subscribing in Google
 * Calendar / Apple Calendar / Outlook.
 *
 * - permanent schedule → one weekly recurring event per lesson (RRULE) until
 *   the end of the school half-year (SEMESTER_END);
 * - current / next week → single events on their real dates (S2 `date`),
 *   cancelled lessons with STATUS:CANCELLED, days off as all-day events;
 * - times in Europe/Prague with an embedded VTIMEZONE, lines folded at 75
 *   octets, CRLF line ends, UIDs stable between downloads so calendars update
 *   events instead of duplicating them.
 *
 * No dependency: the format is small and the generator is easier to check
 * line by line than a library configuration (see test/ical.test.js).
 */

const { fromZonedTime, formatInTimeZone } = require('date-fns-tz');
const { lessonTimeByHour } = require('./lesson-times');
const { matchesGroupFilters, addDaysIso, mondayOf } = require('./bakalari-parser');

const TZID = 'Europe/Prague';
const PRODID = '-//Lepsi Rozvrh//iCal export//CS';
const UID_DOMAIN = 'lepsi-rozvrh';

// Europe/Prague: CET/CEST, change on the last Sunday of March / October
// (EU directive 2000/84/EC; the same rule since 1996).
const VTIMEZONE = [
    'BEGIN:VTIMEZONE',
    `TZID:${TZID}`,
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
];

const SCHEDULE_LABELS = { permanent: 'stálý', actual: 'tento týden', next: 'příští týden' };
const SCHEDULE_DOC = { permanent: 'Permanent', actual: 'Actual', next: 'Next' };

/** RFC 5545 3.3.11: backslash, semicolon, comma and newlines in TEXT values. */
function escapeText(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 3.1: lines SHOULD NOT be longer than 75 octets (not characters -
 * Czech letters take 2 bytes); a continuation line starts with one space.
 * A UTF-8 character is never split.
 */
function foldLine(line) {
    const parts = [];
    let current = '';
    let bytes = 0;
    for (const ch of line) {
        const size = Buffer.byteLength(ch, 'utf8');
        const limit = parts.length === 0 ? 75 : 74; // the leading space counts
        if (bytes + size > limit) {
            parts.push(current);
            current = '';
            bytes = 0;
        }
        current += ch;
        bytes += size;
    }
    parts.push(current);
    return parts.map((p, i) => (i === 0 ? p : ' ' + p)).join('\r\n');
}

const pad = (n) => String(n).padStart(2, '0');
const compactDate = (iso) => iso.replace(/-/g, '');
const localDateTime = (iso, [h, m]) => `${compactDate(iso)}T${pad(h)}${pad(m)}00`;
const utcStamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const slug = (value) => String(value || 'all').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9.]+/g, '_') || 'all';

/**
 * Last day of the current school half-year ('YYYY-MM-DD'). SEMESTER_END wins
 * when set and still ahead; otherwise 31 January (1st half, §2 vyhláška
 * 16/2005 Sb.) or 30 June (2nd half) by today's Prague date. In July and
 * August the coming first half is assumed.
 */
function semesterEnd(now = new Date(), env = process.env) {
    const today = formatInTimeZone(now, TZID, 'yyyy-MM-dd');
    const configured = String(env.SEMESTER_END || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(configured) && configured >= today) return configured;
    const [year, month] = today.split('-').map(Number);
    if (month === 1) return `${year}-01-31`;
    if (month <= 6) return `${year}-06-30`;
    return `${year + 1}-01-31`;
}

/** UNTIL in UTC: with a TZID'd DTSTART, RFC 5545 3.3.10 requires a UTC UNTIL. */
function untilUtc(lastDayIso) {
    return utcStamp(fromZonedTime(`${lastDayIso}T23:59:59`, TZID));
}

const isCancelled = (lesson) => lesson.type === 'removed' || lesson.type === 'absent';

function describe(lesson) {
    const change = lesson.changeInfo && (lesson.changeInfo.description || lesson.changeInfo.raw);
    return [
        lesson.teacher && `Vyučující: ${lesson.teacher}`,
        lesson.group && `Skupina: ${lesson.group}`,
        lesson.theme && `Téma: ${lesson.theme}`,
        change && `Změna: ${change}`,
    ].filter(Boolean).join('\n');
}

function summarize(lesson) {
    const prefix = isCancelled(lesson) ? 'Odpadá: ' : (lesson.changed ? 'Změna: ' : '');
    const subject = lesson.subject || 'Hodina';
    return prefix + subject + (lesson.group ? ` (${lesson.group})` : '');
}

/**
 * Stable UIDs: one per slot (date or weekday, hour, group, live/cancelled).
 * A substitution keeps the UID of the slot, so the calendar updates the event
 * instead of adding a second one. Repeats in a slot get a counter.
 */
function uidFactory(prefix) {
    const seen = new Map();
    return (parts) => {
        const key = [prefix, ...parts].map(slug).join('-');
        const n = seen.get(key) || 0;
        seen.set(key, n + 1);
        return `${key}${n ? `-${n}` : ''}@${UID_DOMAIN}`;
    };
}

function eventLines({ uid, stamp, date, time, lesson, rrule = null }) {
    const cancelled = isCancelled(lesson);
    const lines = [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${TZID}:${localDateTime(date, time.start)}`,
        `DTEND;TZID=${TZID}:${localDateTime(date, time.end)}`,
    ];
    if (rrule) lines.push(`RRULE:${rrule}`);
    lines.push(`SUMMARY:${escapeText(summarize(lesson))}`);
    if (lesson.room) lines.push(`LOCATION:${escapeText(lesson.room)}`);
    const description = describe(lesson);
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    // RFC 5545 3.8.1.11 / 3.8.2.7: a cancelled lesson stays visible but does not block time.
    lines.push(`STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
    lines.push(`TRANSP:${cancelled ? 'TRANSPARENT' : 'OPAQUE'}`);
    lines.push('END:VEVENT');
    return lines;
}

const byDayHour = (a, b) => (a.day - b.day) || (a.hour - b.hour) || String(a.group || '').localeCompare(String(b.group || ''));

/**
 * @param {Object} args
 * @param {{type: string, id: string, name: string}} args.timetable
 * @param {Array<{schedule: 'permanent'|'actual'|'next', snapshot: Object}>} args.sources
 *        snapshot = Firestore timetables/{…} document ({ data, weekStart, daysOff, lastUpdate })
 * @param {Array<string>} [args.groups] - group filter (whole-class lessons always pass)
 * @param {Date} [args.now]
 * @param {Object} [args.env]
 * @returns {string} the VCALENDAR text (CRLF)
 */
function buildCalendar({ timetable, sources, groups = [], now = new Date(), env = process.env }) {
    const label = sources.map(s => SCHEDULE_LABELS[s.schedule]).join(' + ');
    const title = `Rozvrh ${timetable.name || timetable.id} (${label})`;
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:${PRODID}`,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `NAME:${escapeText(title)}`,            // RFC 7986 5.1
        `X-WR-CALNAME:${escapeText(title)}`,    // older clients
        `X-WR-TIMEZONE:${TZID}`,
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H', // RFC 7986 5.7
        'X-PUBLISHED-TTL:PT1H',
        ...VTIMEZONE,
    ];

    const passesGroup = (lesson) => !groups.length || matchesGroupFilters(lesson.group, groups);
    const prefix = `${timetable.type}_${timetable.id}`;

    for (const { schedule, snapshot } of sources) {
        const lessons = (Array.isArray(snapshot.data) ? snapshot.data : []).filter(passesGroup).slice().sort(byDayHour);
        // DTSTAMP from the snapshot's last update: the same data gives the same
        // bytes, so ETag / 304 and calendar caches work.
        const updated = Date.parse(snapshot.lastUpdate);
        const stamp = utcStamp(Number.isFinite(updated) ? new Date(updated) : now);
        const uid = uidFactory(schedule === 'permanent' ? `${prefix}_P` : prefix);

        if (schedule === 'permanent') {
            const thisMonday = mondayOf(formatInTimeZone(now, TZID, 'yyyy-MM-dd'));
            const lastDay = semesterEnd(now, env);
            const rrule = `FREQ=WEEKLY;UNTIL=${untilUtc(lastDay)}`;
            for (const lesson of lessons) {
                const time = lessonTimeByHour.get(lesson.hour);
                if (!time || !Number.isInteger(lesson.day) || lesson.day < 0 || lesson.day > 4) continue;
                // A one-off cancellation or change has no place in a weekly series.
                if (isCancelled(lesson)) continue;
                const first = addDaysIso(thisMonday, lesson.day);
                if (!first || first > lastDay) continue;
                lines.push(...eventLines({
                    uid: uid([`d${lesson.day}`, `h${lesson.hour}`, lesson.group, 'a']),
                    stamp, date: first, time, lesson: { ...lesson, changed: false, changeInfo: null }, rrule,
                }));
            }
            continue;
        }

        for (const lesson of lessons) {
            const time = lessonTimeByHour.get(lesson.hour);
            const date = lesson.date || (snapshot.weekStart && Number.isInteger(lesson.day) ? addDaysIso(snapshot.weekStart, lesson.day) : null);
            if (!time || !date) continue;
            lines.push(...eventLines({
                uid: uid([date, `h${lesson.hour}`, lesson.group, isCancelled(lesson) ? 'x' : 'a']),
                stamp, date, time, lesson,
            }));
        }

        // Holidays as all-day events, so an empty day reads "volno", not "no data".
        for (const off of Array.isArray(snapshot.daysOff) ? snapshot.daysOff : []) {
            if (!off || !off.date) continue;
            lines.push(
                'BEGIN:VEVENT',
                `UID:${uid(['volno', off.date])}`,
                `DTSTAMP:${stamp}`,
                `DTSTART;VALUE=DATE:${compactDate(off.date)}`,
                `DTEND;VALUE=DATE:${compactDate(addDaysIso(off.date, 1))}`,
                `SUMMARY:${escapeText(off.name ? `Volno: ${off.name}` : 'Volno')}`,
                'TRANSP:TRANSPARENT',
                'END:VEVENT',
            );
        }
    }

    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * ?schedule= → list of schedules. Default: this and next week (what a
 * calendar subscription is for). Permanent cannot be mixed with the weeks:
 * the recurring events would duplicate the dated ones.
 * @returns {{ schedules: string[] } | { error: string }}
 */
function parseScheduleParam(value) {
    const raw = value === undefined || value === null || value === '' ? 'actual,next' : String(value);
    const schedules = [...new Set(raw.toLowerCase().split(',').map(s => s.trim()).filter(Boolean))];
    if (!schedules.length || schedules.some(s => !SCHEDULE_DOC[s])) {
        return { error: 'schedule must be permanent, actual, next or actual,next' };
    }
    if (schedules.includes('permanent') && schedules.length > 1) {
        return { error: 'permanent cannot be combined with actual/next' };
    }
    return { schedules };
}

function isIcalEnabled(env = process.env) {
    return !['false', '0', 'off', 'no'].includes(String(env.ICAL_ENABLED ?? 'true').trim().toLowerCase());
}

module.exports = {
    TZID,
    VTIMEZONE,
    SCHEDULE_DOC,
    escapeText,
    foldLine,
    semesterEnd,
    untilUtc,
    buildCalendar,
    parseScheduleParam,
    isIcalEnabled,
};
