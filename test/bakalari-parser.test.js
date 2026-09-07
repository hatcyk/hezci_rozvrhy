const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    standardizeGroupName,
    abbreviateTeacherName,
    parseTimetableHtml,
    addRemovedLessonsFromPermanent,
    matchesGroupFilters,
} = require('../backend/bakalari-parser');

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
    assert.equal(abbreviateTeacherName('Kozakovič Radko'), 'R. Kozakovič');
    assert.equal(abbreviateTeacherName('Radko Kozakovič'), 'R. Kozakovič');
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
        day: 0, dayName: 'po', hour: 1,
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
        { day: 0, hour: 2, subject: 'Programování', teacher: 'Kozakovič Radko', group: '1. sk', type: 'atom' },
        { day: 0, hour: 2, subject: 'Programování', teacher: 'Dvořák Petr', group: '2. sk', type: 'atom' },
        { day: 0, hour: 3, subject: 'Fyzika', teacher: 'Horák', group: null, type: 'removed' },
    ];
    const actual = [
        { day: 0, hour: 1, subject: 'Matematika', teacher: 'Nováková Jana', group: null, type: 'atom' },
        // group spelled differently must still match
        { day: 0, hour: 2, subject: 'Programování', teacher: 'Kozakovič Radko', group: '1.sk', type: 'atom' },
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

    assert.deepEqual(addRemovedLessonsFromPermanent(actual, []), actual);
    assert.deepEqual(addRemovedLessonsFromPermanent(actual, null), actual);
});
