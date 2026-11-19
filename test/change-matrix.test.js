// Matice přechodů stavu JEDNÉ hodiny: co detektor ohlásí, co z toho projde
// výchozími předvolbami a jaký text uživatel dostane. Syntetická data, žádná síť.
//
// Třída (Actual) jde skutečnou cestou sběru: stránka → addRemovedLessonsFromPermanent
// (přeškrtnutá kopie ze stálého rozvrhu) → detektor → filtr předvoleb → text.
// Učitel a učebna kopie ze stálého rozvrhu nemají; zrušenou hodinu tam nese
// „removed“ položka přímo ze stránky Bakalářů (zkratka předmětu, bez učebny).
const test = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {}; // „Added N removed lessons…“ ze sběru

const { detectTimetableChanges, createChangeSummary, createDetailedChangeSummary } = require('../backend/change-detector');
const { addRemovedLessonsFromPermanent } = require('../backend/bakalari-parser');
const { filterChangesByPreferences } = require('../backend/fcm');

const W = '2026-11-09';
// Výchozí předvolby aplikace (public/js/notifications-preferences.js)
const DEFAULTS = { changes: { lesson_removed: true, substitution: true, room_change: true, lesson_added: false, subject_change: false } };
const only = (key) => ({ changes: { lesson_removed: false, substitution: false, room_change: false, lesson_added: false, subject_change: false, [key]: true } });

const L = (subject, teacher, extra = {}) => ({
    day: 0, dayName: 'Po', hour: 3, date: W, subject, teacher, room: 'U15', group: '', type: 'normal', ...extra,
});
const detect = (type, before, after) => detectTimetableChanges(before, after,
    { type, id: 'X1', name: 'X1', scheduleType: 'Actual' }, { oldWeekStart: W, newWeekStart: W });
const typesOf = (changes) => changes.map(c => c.type).sort();
/** Something is reported, and at most one message about the lesson itself plus one about its room. */
function assertOncePerLesson(changes) {
    assert.ok(changes.length >= 1, 'the transition is detected');
    assert.ok(changes.filter(c => c.type !== 'room_change').length <= 1, typesOf(changes).join(', '));
    assert.ok(changes.filter(c => c.type === 'room_change').length <= 1, typesOf(changes).join(', '));
}

// ─── třída ──────────────────────────────────────────────────────────────────

const PERMANENT = [{ ...L('Matematika', 'Mgr. A'), date: null }];
const snapshot = (page) => addRemovedLessonsFromPermanent(page, PERMANENT, { weekStart: W, daysOff: [] });

// Stavy 3. hodiny v pondělí; ve stálém rozvrhu je Matematika, Mgr. A, U15.
const CLASS_STATES = {
    'běžná': [L('Matematika', 'Mgr. A')],
    'odpadlá': [],
    'suplovaná': [L('Matematika', 'Mgr. B', { changed: true })],
    'jiný předmět': [L('Fyzika', 'Mgr. C', { changed: true })],
    'jiná učebna': [L('Matematika', 'Mgr. A', { room: 'U20', changed: true })],
    'jiný předmět, stejný vyučující': [L('Fyzika', 'Mgr. A', { changed: true })],
};

// [z, do, typy doručené s výchozími předvolbami, text upozornění]
// Prázdný seznam = s výchozími předvolbami nic nepřijde; takové řádky jsou jen
// dva a oba jsou „čistá změna předmětu“ (stejný čas, místo i vyučující), kterou
// aplikace vede pod vypnutým přepínačem Změna předmětu.
const CLASS_MATRIX = [
    ['běžná', 'odpadlá', ['type_change'], 'Po 3.h: Matematika odpadla'],
    ['běžná', 'suplovaná', ['substitution'], 'Po 3.h: Matematika - supluje Mgr. B'],
    ['běžná', 'jiný předmět', ['lesson_replaced'], 'Po 3.h: Matematika → Fyzika (Mgr. C)'],
    ['běžná', 'jiná učebna', ['room_change'], 'Po 3.h: Matematika - učebna U20'],
    ['běžná', 'jiný předmět, stejný vyučující', [], ''],

    ['odpadlá', 'běžná', ['lesson_restored'], 'Po 3.h: Matematika se koná (zrušení odvoláno)'],
    ['odpadlá', 'suplovaná', ['lesson_restored'], 'Po 3.h: Matematika se koná, supluje Mgr. B (zrušení odvoláno)'],
    ['odpadlá', 'jiný předmět', ['lesson_replaced'], 'Po 3.h: Fyzika (Mgr. C) místo odpadlé hodiny Matematika'],
    ['odpadlá', 'jiná učebna', ['lesson_restored', 'room_change'], 'Po 3.h: Matematika se koná (zrušení odvoláno); Po 3.h: Matematika - učebna U20'],
    ['odpadlá', 'jiný předmět, stejný vyučující', ['lesson_replaced'], 'Po 3.h: Fyzika (Mgr. A) místo odpadlé hodiny Matematika'],

    ['suplovaná', 'běžná', ['substitution'], 'Po 3.h: Matematika - supluje Mgr. A'],
    ['suplovaná', 'odpadlá', ['lesson_removed'], 'Po 3.h: Matematika odpadla'],
    ['suplovaná', 'jiný předmět', ['lesson_replaced'], 'Po 3.h: Matematika → Fyzika (Mgr. C)'],
    ['suplovaná', 'jiná učebna', ['room_change', 'substitution'], 'Po 3.h: Matematika - supluje Mgr. A; Po 3.h: Matematika - učebna U20'],
    ['suplovaná', 'jiný předmět, stejný vyučující', ['lesson_replaced'], 'Po 3.h: Matematika → Fyzika (Mgr. A)'],

    ['jiný předmět', 'běžná', ['lesson_replaced'], 'Po 3.h: Fyzika → Matematika (Mgr. A)'],
    ['jiný předmět', 'odpadlá', ['lesson_removed'], 'Po 3.h: Fyzika odpadla'],
    ['jiný předmět', 'suplovaná', ['lesson_replaced'], 'Po 3.h: Fyzika → Matematika (Mgr. B)'],
    ['jiný předmět', 'jiná učebna', ['lesson_replaced', 'room_change'], 'Po 3.h: Fyzika → Matematika (Mgr. A); Po 3.h: Matematika - učebna U20'],
    ['jiný předmět', 'jiný předmět, stejný vyučující', ['substitution'], 'Po 3.h: Fyzika - supluje Mgr. A'],

    ['jiná učebna', 'běžná', ['room_change'], 'Po 3.h: Matematika - učebna U15'],
    ['jiná učebna', 'odpadlá', ['type_change'], 'Po 3.h: Matematika odpadla'],
    ['jiná učebna', 'suplovaná', ['room_change', 'substitution'], 'Po 3.h: Matematika - supluje Mgr. B; Po 3.h: Matematika - učebna U15'],
    ['jiná učebna', 'jiný předmět', ['lesson_replaced', 'room_change'], 'Po 3.h: Matematika → Fyzika (Mgr. C); Po 3.h: Fyzika - učebna U15'],
    ['jiná učebna', 'jiný předmět, stejný vyučující', ['room_change'], 'Po 3.h: Fyzika - učebna U15'],

    ['jiný předmět, stejný vyučující', 'běžná', [], ''],
    ['jiný předmět, stejný vyučující', 'odpadlá', ['lesson_removed'], 'Po 3.h: Fyzika odpadla'],
    ['jiný předmět, stejný vyučující', 'suplovaná', ['lesson_replaced'], 'Po 3.h: Fyzika → Matematika (Mgr. B)'],
    ['jiný předmět, stejný vyučující', 'jiný předmět', ['substitution'], 'Po 3.h: Fyzika - supluje Mgr. C'],
    ['jiný předmět, stejný vyučující', 'jiná učebna', ['room_change'], 'Po 3.h: Matematika - učebna U20'],
];

test('matice je úplná: každý přechod mezi dvěma různými stavy má svůj řádek', () => {
    const names = Object.keys(CLASS_STATES);
    const wanted = names.flatMap(from => names.filter(to => to !== from).map(to => `${from} → ${to}`));
    assert.deepEqual(CLASS_MATRIX.map(([from, to]) => `${from} → ${to}`).sort(), wanted.sort());
});

for (const [from, to, delivered, text] of CLASS_MATRIX) {
    test(`třída: ${from} → ${to}: ${delivered.join(' + ') || 'jen pod přepínačem Změna předmětu'}`, () => {
        const before = snapshot(CLASS_STATES[from]);
        const after = snapshot(CLASS_STATES[to]);
        const changes = detect('Class', before, after);
        const passed = filterChangesByPreferences(changes, DEFAULTS);

        assert.deepEqual(typesOf(passed), delivered);
        assert.equal(createChangeSummary(passed), text);
        if (delivered.length) {
            assert.ok(createDetailedChangeSummary(passed).includes('3.h: '), 'podrobný text není prázdný');
        } else {
            // not lost, only behind its own switch
            assert.deepEqual(typesOf(changes), ['subject_change']);
            assert.deepEqual(typesOf(filterChangesByPreferences(changes, only('subject_change'))), ['subject_change']);
        }

        // nejvýš jedna zpráva o hodině samé (+ případně učebna), nic dvakrát
        assertOncePerLesson(changes);
        // další běh nad stejným stavem už nehlásí nic
        assert.deepEqual(detect('Class', after, snapshot(CLASS_STATES[to])), []);
    });
}

test('třída: běžná → odpadlá → suplovaná → beze změny: dvě upozornění, každé jednou', () => {
    const steps = ['běžná', 'odpadlá', 'suplovaná', 'suplovaná'].map(name => snapshot(CLASS_STATES[name]));
    const sentPerRun = steps.slice(1).map((after, i) => createChangeSummary(filterChangesByPreferences(detect('Class', steps[i], after), DEFAULTS)));
    assert.deepEqual(sentPerRun, [
        'Po 3.h: Matematika odpadla',
        'Po 3.h: Matematika se koná, supluje Mgr. B (zrušení odvoláno)',
        '',
    ]);
});

test('třída: hodina po zrušení se řídí přepínačem Odpadlé hodiny; se suplujícím stačí i Suplování', () => {
    const cancelled = snapshot(CLASS_STATES['odpadlá']);
    const through = (to, prefs) => typesOf(filterChangesByPreferences(detect('Class', cancelled, snapshot(CLASS_STATES[to])), prefs));
    for (const to of ['běžná', 'suplovaná', 'jiný předmět', 'jiný předmět, stejný vyučující']) {
        assert.equal(through(to, only('lesson_removed')).length, 1, to);
        assert.deepEqual(through(to, only('lesson_added')), [], `${to}: už to není „přidaná hodina“`);
        assert.deepEqual(through(to, only('room_change')), [], to);
    }
    // Who follows substitutions but not cancellations would have got "supluje B"
    // had the substitute been assigned straight away.
    assert.deepEqual(through('suplovaná', only('substitution')), ['lesson_restored']);
    assert.deepEqual(through('jiný předmět', only('substitution')), ['lesson_replaced']);
    assert.deepEqual(through('běžná', only('substitution')), [], 'plain "se koná" belongs to the cancellation only');
});

test('třída: celá třída odpadla a místo ní mají hodinu skupiny → každá skupina dostane svou', () => {
    const before = snapshot([]);
    const after = snapshot([
        L('Fyzika', 'Mgr. C', { group: '1.sk', room: 'U20' }),
        L('Chemie', 'Mgr. D', { group: '2.sk' }),
    ]);
    const changes = detect('Class', before, after);
    assert.deepEqual(changes.map(c => `${c.type} ${c.lesson.group}`).sort(),
        ['lesson_replaced 1.sk', 'lesson_replaced 2.sk', 'room_change 1.sk']);
    assert.equal(createChangeSummary(changes.filter(c => c.lesson.group === '2.sk')), 'Po 3.h: Chemie (Mgr. D) místo odpadlé hodiny Matematika');
});

test('třída: přidaná hodina tam, kde nic neodpadlo, zůstává „přidaná“ (přepínač Přidané hodiny)', () => {
    const extra = L('Seminář', 'Mgr. E', { hour: 8 });
    // free slot
    const added = detect('Class', snapshot(CLASS_STATES['běžná']), snapshot([...CLASS_STATES['běžná'], extra]));
    assert.deepEqual(typesOf(added), ['lesson_added']);
    assert.deepEqual(filterChangesByPreferences(added, DEFAULTS), [], 'off by default in the app');
    assert.equal(createChangeSummary(filterChangesByPreferences(added, only('lesson_added'))), 'Po 8.h: Přidána Seminář');
    // ... and its removal is a cancellation, delivered by default
    const removed = detect('Class', snapshot([...CLASS_STATES['běžná'], extra]), snapshot(CLASS_STATES['běžná']));
    assert.equal(createChangeSummary(filterChangesByPreferences(removed, DEFAULTS)), 'Po 8.h: Seminář odpadla');

    // a second lesson next to one that takes place (another group) is an addition, not a replacement
    const second = detect('Class', snapshot(CLASS_STATES['běžná']), snapshot([...CLASS_STATES['běžná'], L('Fyzika', 'Mgr. C', { group: '1.sk' })]));
    assert.deepEqual(typesOf(second), ['lesson_added']);
    // next to a substituted lesson (substitute + struck-through original) as well
    const third = detect('Class', snapshot(CLASS_STATES['suplovaná']), snapshot([...CLASS_STATES['suplovaná'], L('Fyzika', 'Mgr. C', { group: '1.sk' })]));
    assert.deepEqual(typesOf(third), ['lesson_added']);
    // the cancelled lesson is restored and a group lesson appears beside it: one "se koná", one addition
    const both = detect('Class', snapshot([]), snapshot([...CLASS_STATES['běžná'], L('Fyzika', 'Mgr. C', { group: '1.sk' })]));
    assert.deepEqual(typesOf(both), ['lesson_added', 'lesson_restored']);
    // an absence of the class (excursion) where a lesson was cancelled is not a lesson taking place
    const absent = detect('Class', snapshot([]), snapshot([L('Exkurze', '', { type: 'absent', group: '1.sk' })]));
    assert.deepEqual(typesOf(absent), ['lesson_added']);
});

// ─── učitel a učebna ────────────────────────────────────────────────────────

// „removed“ položka ze stránky: předmět a vyučující z textu „Zrušeno (MAT, …)“, bez učebny.
// U učitele a učebny je „skupina“ třída, která na hodinu přijde.
const ATOM = L('MAT', 'A. Učitel', { type: 'removed', room: null, group: '2.A', changed: true });
const OWN = L('Matematika', 'Mgr. A', { group: '2.A' });
const OTHER = L('Fyzika', 'Mgr. A', { group: '3.B' });
const VIEW_STATES = {
    'běžná': [OWN],
    'odpadlá (přeškrtnutá)': [ATOM],
    'odpadlá (přeškrtnutá, bez třídy)': [{ ...ATOM, group: null }],
    'odpadlá (zmizela)': [],
    'jiná třída místo zrušené': [OTHER],
    'jiná třída vedle zrušené': [ATOM, OTHER],
    'jiná učebna': [{ ...OWN, room: 'U20' }],
};
const VIEW_MATRIX = [
    ['běžná', 'odpadlá (přeškrtnutá)', ['type_change'], 'Po 3.h: MAT odpadla'],
    ['běžná', 'odpadlá (přeškrtnutá, bez třídy)', ['lesson_removed'], 'Po 3.h: Matematika odpadla'],
    ['běžná', 'odpadlá (zmizela)', ['lesson_removed'], 'Po 3.h: Matematika odpadla'],
    ['běžná', 'jiná učebna', ['room_change'], 'Po 3.h: Matematika - učebna U20'],
    ['odpadlá (přeškrtnutá)', 'běžná', ['lesson_restored'], 'Po 3.h: Matematika se koná (zrušení odvoláno)'],
    ['odpadlá (přeškrtnutá)', 'jiná učebna', ['lesson_restored'], 'Po 3.h: Matematika se koná (zrušení odvoláno)'],
    ['odpadlá (přeškrtnutá)', 'jiná třída místo zrušené', ['lesson_replaced'], 'Po 3.h: Fyzika (Mgr. A) místo odpadlé hodiny MAT'],
    ['odpadlá (přeškrtnutá)', 'jiná třída vedle zrušené', ['lesson_replaced'], 'Po 3.h: Fyzika (Mgr. A) místo odpadlé hodiny MAT'],
    // the cancelled entry carries no class: the subject is known only as "MAT"
    ['odpadlá (přeškrtnutá, bez třídy)', 'běžná', ['lesson_replaced'], 'Po 3.h: Matematika (Mgr. A) místo odpadlé hodiny MAT'],
    ['jiná třída vedle zrušené', 'odpadlá (přeškrtnutá)', ['lesson_removed'], 'Po 3.h: Fyzika odpadla'],
    ['jiná třída místo zrušené', 'odpadlá (zmizela)', ['lesson_removed'], 'Po 3.h: Fyzika odpadla'],
    // The page no longer shows the cancelled lesson at all: nothing tells the
    // detector there ever was one, so the lesson is a plain addition.
    ['odpadlá (zmizela)', 'běžná', [], ''],
];

for (const type of ['Teacher', 'Room']) {
    for (const [from, to, delivered, text] of VIEW_MATRIX) {
        test(`${type === 'Teacher' ? 'učitel' : 'učebna'}: ${from} → ${to}: ${delivered.join(' + ') || 'jen pod přepínačem Přidané hodiny'}`, () => {
            const changes = detect(type, VIEW_STATES[from], VIEW_STATES[to]);
            const passed = filterChangesByPreferences(changes, DEFAULTS);
            assert.deepEqual(typesOf(passed), delivered);
            assert.equal(createChangeSummary(passed), text);
            if (!delivered.length) assert.deepEqual(typesOf(changes), ['lesson_added']);
            assertOncePerLesson(changes);
            assert.deepEqual(detect(type, VIEW_STATES[to], structuredClone(VIEW_STATES[to])), []);
        });
    }
}

test('učebna: zrušená položka s učebnou → vrácená hodina jinde ohlásí i učebnu', () => {
    const changes = detect('Teacher', [{ ...ATOM, room: 'U15' }], VIEW_STATES['jiná učebna']);
    assert.deepEqual(typesOf(changes), ['lesson_restored', 'room_change']);
    assert.equal(createChangeSummary(changes), 'Po 3.h: Matematika se koná (zrušení odvoláno); Po 3.h: Matematika - učebna U20');
});
