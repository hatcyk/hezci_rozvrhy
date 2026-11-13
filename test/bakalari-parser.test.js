const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    standardizeGroupName,
    abbreviateTeacherName,
    parseTimetableHtml,
    parseTimetablePage,
    addRemovedLessonsFromPermanent,
    matchesGroupFilters,
    normalizeGroup,
    inferIsoDate,
    mondayOf,
    addDaysIso,
} = require('../backend/bakalari-parser');

// Fixture page shows the week of Monday 7.9.2026; downloaded on Tuesday 8.9.2026
const FETCHED_AT = new Date('2026-09-08T10:00:00Z');

test('standardizeGroupName understands 2026 Bakaláři group codes', () => {
    assert.equal(standardizeGroupName('sk1 - 1. skupina'), '1.sk');
    assert.equal(standardizeGroupName('sk2'), '2.sk');
    assert.equal(standardizeGroupName('ak1 - 1. skupina AK'), '1.ak');
    assert.equal(standardizeGroupName('tvk1 - Tělesná výchova - kluci'), 'TVk1');
    assert.equal(standardizeGroupName('celá - celá třída'), '');
    assert.equal(standardizeGroupName('xtvd - TV dívky all'), 'xtvd');
    assert.equal(standardizeGroupName('sem - volitelné semináře'), 'sem');
    // already-normalized values are stable
    assert.equal(standardizeGroupName('1.ak'), '1.ak');
    assert.equal(standardizeGroupName('TVk1'), 'TVk1');
});

test('normalizeGroup maps class and teacher/room group references', () => {
    assert.equal(normalizeGroup('sk1', 'sk1 - 1. skupina'), '1.sk');
    assert.equal(normalizeGroup('tvk2', 'tvk2 - Tělesná výchova - kluci 2'), 'TVk2');
    assert.equal(normalizeGroup('', ''), null, 'whole class on a class page');
    assert.equal(normalizeGroup(null, null), null);
    assert.equal(normalizeGroup('2.A sk1', '2.A sk1 - 1. skupina'), '2.A 1.sk');
    assert.equal(normalizeGroup('2.D', '2.D celá - celá třída'), '2.D celá');
    assert.equal(normalizeGroup(null, '3.A celá - celá třída'), '3.A celá', 'tooltip fallback');
    assert.equal(normalizeGroup('4.A tvk1', null), '4.A TVk1');
});

test('parseTimetableHtml parses the 2026 embedded-JSON page', () => {
    const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'timetable-embedded.html'), 'utf8');
    const lessons = parseTimetableHtml(html, { now: FETCHED_AT });

    // 21 atoms in the fixture (po + út) + 1 hour-level absence (čt); day-off (st) contributes nothing
    assert.equal(lessons.length, 22);
    assert.deepEqual([...new Set(lessons.map(l => l.day))].sort(), [0, 1, 3]);

    // hour numbers come from the raster, not from Hour.Index (which is offset by 2)
    const mon = lessons.filter(l => l.day === 0 && l.type !== 'removed').sort((a, b) => a.hour - b.hour);
    assert.deepEqual(mon.map(l => l.hour), [0, 1, 2, 2, 3, 4, 5, 6]);
    const first = mon[0];
    assert.equal(first.dayName, 'po');
    assert.equal(first.subject, 'Dopravní telematika');
    assert.equal(first.teacher, 'Ing. Bc. Jan Vzorek MBA');
    assert.equal(first.date, '2026-09-07', 'date of the day from Days[].Date "7.9." + year of the download');
    assert.equal(first.room, 'A104', 'short room code from the atom, not the tooltip description');
    assert.equal(first.group, null, 'whole-class lesson has no group');
    assert.equal(first.type, 'atom');

    // split hour keeps both groups in canonical form
    const split = mon.filter(l => l.hour === 2).map(l => l.group).sort();
    assert.deepEqual(split, ['1.sk', '2.sk']);

    // substitution / move carries changeInfo
    const changed = lessons.find(l => l.changed && l.type === 'atom');
    assert.ok(changed && changed.changeInfo.raw.length > 0);

    // removed atoms: subject + abbreviated teacher parsed from removedinfo, no group
    const removed = lessons.filter(l => l.type === 'removed');
    assert.ok(removed.length >= 2);
    assert.equal(removed[0].subject, 'MOD');
    assert.equal(removed[0].teacher, 'V. Vzorová');
    assert.equal(removed[0].group, null);
    assert.equal(removed[0].changed, true);

    // special TV group and hour-level absence
    assert.ok(lessons.some(l => l.group === 'xtvd' && l.day === 1));
    const absent = lessons.find(l => l.type === 'absent');
    assert.equal(absent.day, 3);
    assert.equal(absent.hour, 1);
    assert.equal(absent.subject, 'Exkurze');
    assert.equal(absent.date, '2026-09-10');

    // every lesson carries the date of its day
    const dateByDay = { 0: '2026-09-07', 1: '2026-09-08', 3: '2026-09-10' };
    for (const lesson of lessons) assert.equal(lesson.date, dateByDay[lesson.day], `day ${lesson.day}`);
});

test('parseTimetablePage returns weekStart, the hour raster and the day-off flag', () => {
    const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'timetable-embedded.html'), 'utf8');
    const page = parseTimetablePage(html, { now: FETCHED_AT });
    assert.equal(page.format, 'embedded');
    assert.equal(page.weekStart, '2026-09-07');
    assert.equal(page.allDaysOff, false, 'only Wednesday is a day off');
    assert.deepEqual(page.hours, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.equal(page.lessons.length, 22);

    // the same page fetched at New Year's Eve 2026 would be read as September 2026 still (nearest year)
    assert.equal(parseTimetablePage(html, { now: new Date('2026-12-31T12:00:00Z') }).weekStart, '2026-09-07');
});

test('parseTimetablePage: whole week off, week without days, legacy page', () => {
    const page = (days) => `<script>const timetableData = ${JSON.stringify({ Hours: [{ Caption: '1', BeginTime: '8:00' }], Days: days })};</script>`;
    const holidays = parseTimetablePage(page([
        { DayAbbrev: 'po', Date: '28.12.', DayOff: true, DayOffName: 'vánoční prázdniny', Hours: [] },
        { DayAbbrev: 'út', Date: '29.12.', DayOff: true, Hours: [] },
    ]), { now: new Date('2026-12-20T08:00:00Z') });
    assert.equal(holidays.lessons.length, 0);
    assert.equal(holidays.allDaysOff, true);
    assert.equal(holidays.weekStart, '2026-12-28', 'a week entirely off still has a week');

    const empty = parseTimetablePage(page([]));
    assert.equal(empty.allDaysOff, false, 'no days at all is not "holidays" (prefetch keeps the old snapshot)');
    assert.equal(empty.weekStart, null);

    const legacy = parseTimetablePage(fs.readFileSync(path.join(__dirname, 'fixtures', 'timetable-sample.html'), 'utf8'));
    assert.equal(legacy.format, 'legacy');
    assert.equal(legacy.weekStart, null, 'pre-2026 markup has no dates');
    assert.ok(legacy.lessons.every(l => l.date === null));
});

test('inferIsoDate picks the year closest to the download (New Year in both directions)', () => {
    const at = (iso) => new Date(`${iso}T12:00:00Z`);
    assert.equal(inferIsoDate('7.9.', at('2026-09-08')), '2026-09-07');
    assert.equal(inferIsoDate('9.11.', at('2026-11-06')), '2026-11-09', 'Next week, same year');
    assert.equal(inferIsoDate('4.1.', at('2026-12-30')), '2027-01-04', 'Next week already in January');
    assert.equal(inferIsoDate('28.12.', at('2027-01-02')), '2026-12-28', 'Actual week started in December');
    assert.equal(inferIsoDate('31.12.', at('2026-12-31')), '2026-12-31');
    assert.equal(inferIsoDate('1.1.', at('2026-12-31')), '2027-01-01');
    // tolerated spellings
    assert.equal(inferIsoDate(' 7. 9. ', at('2026-09-08')), '2026-09-07');
    assert.equal(inferIsoDate('7.9', at('2026-09-08')), '2026-09-07');
    assert.equal(inferIsoDate('7.9.2025', at('2026-09-08')), '2025-09-07', 'explicit year wins');
    // 29.2. only exists in leap years: the nearest valid one is chosen
    assert.equal(inferIsoDate('29.2.', at('2027-03-01')), '2028-02-29');
    // garbage
    for (const bad of ['', null, undefined, 'pondělí', '32.1.', '0.5.', '1.13.', '31.4.', '29.2.2027']) {
        assert.equal(inferIsoDate(bad, at('2026-09-08')), null, `input ${JSON.stringify(bad)}`);
    }
});

test('mondayOf / addDaysIso do calendar arithmetic without time zones', () => {
    assert.equal(mondayOf('2026-09-07'), '2026-09-07', 'Monday stays');
    assert.equal(mondayOf('2026-09-13'), '2026-09-07', 'Sunday belongs to the week before');
    assert.equal(mondayOf('2027-01-01'), '2026-12-28', 'week across New Year');
    assert.equal(mondayOf('2026-03-29'), '2026-03-23', 'DST change day (Europe)');
    assert.equal(mondayOf('2026-02-30'), null);
    assert.equal(mondayOf(null), null);
    assert.equal(addDaysIso('2026-12-28', 4), '2027-01-01');
    assert.equal(addDaysIso('bad', 1), null);
});

test('matchesGroupFilters normalizes both sides and always passes whole-class lessons', () => {
    assert.equal(matchesGroupFilters('1. sk', []), true, 'no filters = everything');
    assert.equal(matchesGroupFilters('1. sk', ['all']), true);
    assert.equal(matchesGroupFilters(null, ['2.sk']), true, 'no group = whole class');
    assert.equal(matchesGroupFilters('celá třída', ['2.sk']), true);
    assert.equal(matchesGroupFilters('1. sk', ['1.sk']), true);
    assert.equal(matchesGroupFilters('1.sk', ['skupina 1']), true, 'legacy filter spelling still matches');
    assert.equal(matchesGroupFilters('1. sk', ['2.sk']), false);
    assert.equal(matchesGroupFilters('TVk1', ['1.sk']), false, 'special groups never collapse to 1.sk');
    assert.equal(matchesGroupFilters('TVk1', ['TVk1', '2.sk']), true);
});

test('standardizeGroupName normalizes numbered groups and keeps special ones', () => {
    const cases = {
        '1. sk': '1.sk', '1.sk': '1.sk', 'skupina 1': '1.sk', '2.skupina': '2.sk', 'sk 3': '3.sk',
        'TVk1': 'TVk1', 'TVDi': 'TVDi', 'TVCh': 'TVCh',
        'celá třída': '', 'cela': '', '': '', 'něco jiného': 'něco jiného',
    };
    for (const [input, expected] of Object.entries(cases)) {
        assert.equal(standardizeGroupName(input), expected, `input "${input}"`);
    }
    assert.equal(standardizeGroupName(null), '');
    assert.equal(standardizeGroupName(undefined), '');
});

test('abbreviateTeacherName handles both name orders and titles', () => {
    assert.equal(abbreviateTeacherName('Příkladovič Radim'), 'R. Příkladovič');
    assert.equal(abbreviateTeacherName('Radim Příkladovič'), 'R. Příkladovič');
    assert.equal(abbreviateTeacherName('Ing. Mgr. Nováková Jana'), 'J. Nováková');
    assert.equal(abbreviateTeacherName('Jan Malý, Ph.D.'), 'J. Malý');
    assert.equal(abbreviateTeacherName('Horák'), 'HO');
    assert.equal(abbreviateTeacherName(''), '');
    assert.equal(abbreviateTeacherName(null), '');
});

test('parseTimetableHtml parses normal, substituted, removed and absent lessons', () => {
    const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'timetable-sample.html'), 'utf8');
    const lessons = parseTimetableHtml(html);

    assert.equal(lessons.length, 6, 'invalid JSON and missing data-detail are skipped');

    assert.deepEqual(lessons[0], {
        day: 0, dayName: 'po', date: null, hour: 1,
        subject: 'Matematika', teacher: 'Nováková Jana', room: 'A12',
        group: null, theme: 'Rovnice', type: 'atom', changed: false, changeInfo: null,
    });

    const [grp1, grp2] = lessons.slice(1, 3);
    assert.equal(grp1.hour, 2);
    assert.equal(grp1.group, '1. sk');
    assert.equal(grp1.changed, false);
    assert.equal(grp2.group, '2. sk');
    assert.equal(grp2.changed, true);
    assert.deepEqual(grp2.changeInfo, {
        raw: 'Suplování: Dvořák Petr za Malý Jan',
        description: 'Suplování: Dvořák Petr za Malý Jan',
    });

    const removed = lessons[3];
    assert.equal(removed.type, 'removed');
    assert.equal(removed.subject, 'Fyzika');
    assert.equal(removed.teacher, 'T. Horák', 'teacher from removedinfo is abbreviated');
    assert.equal(removed.changed, true);
    assert.equal(removed.changeInfo.raw, 'Vyjmuto z rozvrhu (Fyzika, Ing. Horák Tomáš)');

    const absent = lessons[4];
    assert.equal(absent.type, 'absent');
    assert.equal(absent.subject, 'Exkurze');
    assert.equal(absent.changeInfo.description, 'exkurze (celý den)');

    const tue = lessons[5];
    assert.equal(tue.day, 1);
    assert.equal(tue.dayName, 'út');
    assert.equal(tue.hour, 0);
    assert.equal(tue.group, 'TVk1');
});

test('parseTimetableHtml returns [] for a page without timetable markup', () => {
    assert.deepEqual(parseTimetableHtml('<html><body><h1>Přihlášení</h1></body></html>'), []);
    assert.deepEqual(parseTimetableHtml(''), []);
});

test('addRemovedLessonsFromPermanent marks lessons missing from actual as removed', () => {
    const permanent = [
        { day: 0, hour: 1, subject: 'Matematika', teacher: 'Nováková Jana', group: null, type: 'atom' },
        { day: 0, hour: 2, subject: 'Programování', teacher: 'Příkladovič Radim', group: '1. sk', type: 'atom' },
        { day: 0, hour: 2, subject: 'Programování', teacher: 'Dvořák Petr', group: '2. sk', type: 'atom' },
        { day: 0, hour: 3, subject: 'Fyzika', teacher: 'Horák', group: null, type: 'removed' },
    ];
    const actual = [
        { day: 0, hour: 1, subject: 'Matematika', teacher: 'Nováková Jana', group: null, type: 'atom' },
        // group spelled differently must still match
        { day: 0, hour: 2, subject: 'Programování', teacher: 'Příkladovič Radim', group: '1.sk', type: 'atom' },
        // stale removed entry in actual is dropped and rebuilt
        { day: 0, hour: 5, subject: 'Stale', teacher: '', group: null, type: 'removed' },
    ];

    const result = addRemovedLessonsFromPermanent(actual, permanent);

    assert.equal(result.length, 3);
    assert.ok(!result.some(l => l.subject === 'Stale'));
    const removed = result.find(l => l.type === 'removed');
    assert.equal(removed.subject, 'Programování');
    assert.equal(removed.group, '2. sk');
    assert.equal(removed.changed, true);
    assert.deepEqual(removed.changeInfo, { raw: 'Hodina odpadla', description: 'Hodina odpadla' });
    assert.equal(removed.date, null, 'week unknown → no date');

    // with the week of the actual timetable the copied lesson gets the date of its day
    const dated = addRemovedLessonsFromPermanent(actual, permanent, { weekStart: '2026-11-02' });
    assert.equal(dated.find(l => l.type === 'removed').date, '2026-11-02');
    const tuesday = addRemovedLessonsFromPermanent([], [{ day: 1, hour: 1, subject: 'X', teacher: '', group: null, type: 'atom' }], { weekStart: '2026-12-28' });
    assert.equal(tuesday[0].date, '2026-12-29');

    assert.deepEqual(addRemovedLessonsFromPermanent(actual, []), actual);
    assert.deepEqual(addRemovedLessonsFromPermanent(actual, null), actual);
});

test('parseTimetablePage vrací dny volna (den, datum, název)', () => {
    const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'timetable-embedded.html'), 'utf8');
    const page = parseTimetablePage(html, { now: FETCHED_AT });
    assert.deepEqual(page.daysOff, [{ day: 2, date: '2026-09-09', name: 'ředitelské volno' }]);
    assert.ok(!page.lessons.some(l => l.day === 2), 'no lessons on the day off');

    const legacy = parseTimetablePage(fs.readFileSync(path.join(__dirname, 'fixtures', 'timetable-sample.html'), 'utf8'));
    assert.deepEqual(legacy.daysOff, []);
});

test('addRemovedLessonsFromPermanent nedává „odpadlé“ hodiny do dnů volna', () => {
    const permanent = [
        { day: 1, hour: 1, subject: 'Matematika', teacher: 'Vzorová', group: null, type: 'atom' },
        { day: 2, hour: 1, subject: 'Fyzika', teacher: 'Vzorek', group: null, type: 'atom' },
        { day: 2, hour: 2, subject: 'Chemie', teacher: 'Vzorek', group: '1.sk', type: 'atom' },
    ];
    // Wednesday is "ředitelské volno": Bakaláři shows no lessons that day,
    // Tuesday's maths really was cancelled.
    const result = addRemovedLessonsFromPermanent([], permanent, {
        weekStart: '2026-09-07',
        daysOff: [{ day: 2, date: '2026-09-09', name: 'ředitelské volno' }],
    });
    assert.deepEqual(result.map(l => [l.day, l.subject, l.type]), [[1, 'Matematika', 'removed']]);
    // plain day indexes work too; without daysOff the old behaviour stays
    assert.equal(addRemovedLessonsFromPermanent([], permanent, { daysOff: [1, 2] }).length, 0);
    assert.equal(addRemovedLessonsFromPermanent([], permanent).length, 3);
});
