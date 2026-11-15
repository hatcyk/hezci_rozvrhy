/**
 * Návrh G – rozvrh: čisté funkce přehledu, dne, týdne a hledání.
 *  - stav hodiny (ikona + slovo) a sloty (škrtnutý originál suplování, dělené hodiny),
 *  - věta o změnách dne, nadpis týdne, časový rozsah osy,
 *  - „teď / další“ (přestávka, po vyučování, víkend),
 *  - migrace uloženého rozvržení (agenda / single-day → Den),
 *  - hledání bez ohledu na diakritiku.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
globalThis.window = { location: { search: '' }, addEventListener() {}, matchMedia: () => ({ matches: false }), innerWidth: 1440 };

const L = (extra = {}) => ({ day: 2, hour: 1, subject: 'Matematika', teacher: 'Mgr. Marta Cvičná', room: 'A101', group: null, type: 'atom', changed: false, changeInfo: null, ...extra });
// Středa 2.A ze syntetických dat náhledu
const WED = [
    L({ hour: 1 }),
    L({ hour: 2, subject: 'Fyzika', teacher: 'Libor Návrhový', room: 'U11' }),
    L({ hour: 3, teacher: 'Adam Šablonový', room: 'U15', changed: true, changeInfo: { description: 'Suplování: MAT, Šablonový Adam (PRO, Ukázková Jana)' } }),
    L({ hour: 3, subject: 'Programování', teacher: 'Mgr. Jana Ukázková', room: 'U15', type: 'removed', changed: true, changeInfo: { description: 'Hodina odpadla' } }),
    L({ hour: 4, subject: 'Český jazyk a literatura', teacher: 'Ing. Petr Vzorový', room: 'LAB2', changed: true, changeInfo: { description: 'Změna místnosti: LAB2 → LAB2' } }),
    L({ hour: 5, subject: 'Anglický jazyk', teacher: 'Mgr. Eva Testová', room: 'A102', type: 'removed', changed: true, changeInfo: { description: 'Zrušeno - Nemoc vyučujícího' } }),
    L({ hour: 6, subject: 'Databázové systémy', room: 'U12', group: '1.sk', changed: true, changeInfo: { description: 'Suplování: DAT, Cvičná Marta (DAT, Příkladný Karel)' } }),
    L({ hour: 6, subject: 'Databázové systémy', teacher: 'Karel Příkladný', room: 'U12', group: '1.sk', type: 'removed', changed: true, changeInfo: { description: 'Hodina odpadla' } }),
    L({ hour: 6, subject: 'Databázové systémy', teacher: 'Libor Návrhový', room: 'A102', group: '2.sk' }),
    L({ hour: 7, subject: 'Dějepis', teacher: 'Mgr. Olga Smyšlená', room: 'LAB1' }),
];

test('stav hodiny: suplování, jiná učebna, odpadá, akce; beze změny nic', async () => {
    const { lessonKind, KINDS, statusHtml } = await import('../public/js/rozvrh-core.js');
    assert.equal(lessonKind(WED[0]), '');
    assert.equal(lessonKind(WED[2], WED[3]), 'sub');
    assert.equal(lessonKind(WED[2]), 'sub', 'z poznámky Bakalářů i bez originálu');
    assert.equal(lessonKind(WED[4]), 'room');
    assert.equal(lessonKind(WED[5]), 'cancel');
    assert.equal(lessonKind(L({ type: 'absent', subject: 'Exkurze', changed: true })), 'extra');
    assert.deepEqual(Object.keys(KINDS).sort(), ['added', 'cancel', 'changed', 'extra', 'room', 'sub']);
    // Stav vždy ikona + slovo (barva jen na ikoně)
    const html = statusHtml('sub');
    assert.match(html, /g-st--sub/);
    assert.match(html, /<use href="icons\.svg#repeat-2">/);
    assert.match(html, /suplování<\/span>$/);
});

test('sloty: škrtnutý originál suplování se schová, dělená hodina má obě skupiny', async () => {
    const { daySlots, groupText } = await import('../public/js/rozvrh-core.js');
    const slots = daySlots(WED, 2);
    assert.deepEqual([...slots.keys()], [1, 2, 3, 4, 5, 6, 7]);
    const third = slots.get(3);
    assert.equal(third.length, 1);
    assert.equal(third[0].kind, 'sub');
    assert.equal(third[0].before.subject, 'Programování');
    const sixth = slots.get(6);
    assert.deepEqual(sixth.map(s => groupText(s.lesson.group)), ['1. sk', '2. sk']);
    assert.deepEqual(sixth.map(s => s.kind), ['sub', '']);
    // Odpadlá hodina bez náhrady zůstává (přeškrtnutá)
    assert.equal(slots.get(5)[0].kind, 'cancel');
    assert.equal(groupText('2.A celá'), '');
    assert.equal(groupText('2.A 1.sk'), '1. sk');
});

test('věta o změnách dne jako v Počasí', async () => {
    const { dayChangeEntries, changesSentence } = await import('../public/js/rozvrh-core.js');
    const sentence = changesSentence(dayChangeEntries(WED), 'Dnes').replace(/ /g, ' ');
    assert.equal(sentence, 'Dnes 4 změny: 3. hodina suplování, 4. hodina v jiné učebně, 5. hodina odpadá a 6. hodina suplování pro 1. sk.');
    assert.equal(changesSentence([], 'Zítra'), 'Zítra beze změn, platí stálý rozvrh.');
});

test('časová osa ve skutečném měřítku a nadpis týdne', async () => {
    const { timeRange, axisHours, fmtMin, weekTitle, weekMonday } = await import('../public/js/rozvrh-core.js');
    const r = timeRange([1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(r, { start: 480, end: 850, range: 370 });
    assert.deepEqual(axisHours(r).map(fmtMin), ['8:00', '9:00', '10:00', '11:00', '12:00', '13:00', '14:00']);
    // 0. hodina (7:10) posune začátek osy
    assert.equal(fmtMin(timeRange([0, 1]).start), '7:10');
    assert.equal(weekTitle(new Date(2026, 10, 2)), 'Týden 2.–6. listopadu');
    assert.equal(weekTitle(new Date(2026, 10, 30)), 'Týden 30. listopadu – 4. prosince');
    assert.equal(weekTitle(null), 'Stálý rozvrh');
    const monday = weekMonday([{ day: 2, date: '2026-11-04' }]);
    assert.equal(monday.getDate(), 2);
});

test('teď / další: hodina, přestávka, po vyučování, víkend', async () => {
    const { nowState } = await import('../public/js/next-lesson.js');
    const week = [...WED, L({ day: 3, hour: 1, subject: 'Matematika', room: 'A101' })];
    const at = (d, h, m) => new Date(2026, 10, d, h, m);

    const lesson = nowState(week, { now: at(4, 8, 20) });
    assert.equal(lesson.kind, 'lesson');
    assert.equal(lesson.current.hour, 1);
    assert.equal(lesson.next.hour, 2);
    assert.equal(lesson.next.dayOffset, 0);

    const brk = nowState(week, { now: at(4, 10, 35) });
    assert.equal(brk.kind, 'break');
    assert.equal(brk.next.hour, 4);

    // 5. hodina odpadá: v jejím čase není „teď“ hodina, ale ví se, že odpadla
    const cancelled = nowState(week, { now: at(4, 11, 50) });
    assert.equal(cancelled.kind, 'break');
    assert.equal(cancelled.cancelledNow.hour, 5);
    assert.equal(cancelled.next.hour, 6);
    assert.equal(cancelled.next.items.length, 2, 'dělená hodina: obě skupiny');

    const after = nowState(week, { now: at(4, 15, 0) });
    assert.equal(after.kind, 'after');
    assert.equal(after.next.day, 3);
    assert.equal(after.next.dayOffset, 1);

    const weekend = nowState(week, { now: at(7, 10, 0), nextWeek: [L({ day: 0, hour: 1 })] });
    assert.equal(weekend.kind, 'weekend');
    assert.equal(weekend.next.nextWeek, true);
    assert.equal(weekend.next.day, 0);
});

test('rozvržení: Agenda a Denní se sloučily do Den, uložená hodnota se převede', async () => {
    const { migrateLayoutId, getLayoutById, getAvailableLayouts, layoutExists } = await import('../public/js/layout-registry.js');
    assert.equal(migrateLayoutId('agenda'), 'day');
    assert.equal(migrateLayoutId('single-day'), 'day');
    assert.equal(migrateLayoutId('week-view'), 'week-view');
    assert.equal(migrateLayoutId('nesmysl'), null);
    assert.equal(getLayoutById('agenda').id, 'day');
    assert.ok(layoutExists('agenda'));
    assert.deepEqual(getAvailableLayouts('mobile').map(l => l.id), ['day', 'compact-list', 'card-view']);
    assert.deepEqual(getAvailableLayouts('desktop').map(l => l.id), ['day', 'week-view']);
    for (const l of getAvailableLayouts('mobile')) assert.match(l.icon, /^[a-z0-9-]+$/, 'jméno ikony ze spritu');

    const { initLayoutSystem } = await import('../public/js/layout-manager.js');
    const { state } = await import('../public/js/state.js');
    store.set('layoutMode', 'agenda');
    window.innerWidth = 390;
    initLayoutSystem();
    assert.equal(state.layoutMode, 'day');
    assert.equal(store.get('layoutMode'), 'day', 'migrovaná hodnota se uloží');
    store.set('layoutMode', 'compact-list');
    window.innerWidth = 1440;
    initLayoutSystem();
    assert.equal(state.layoutMode, 'week-view', 'mobilní rozvržení se na počítači nepoužije');
});

test('hledání: bez diakritiky, seskupené, nejlepší shoda první', async () => {
    const { normalize, matchRank, searchItems } = await import('../public/js/dropdown.js');
    assert.equal(normalize('  Ukázková '), 'ukazkova');
    const items = [
        { type: 'Class', id: 'C2A', name: '2.A' }, { type: 'Class', id: 'C1A', name: '1.A' },
        { type: 'Teacher', id: 'T1', name: 'Mgr. Jana Ukázková' }, { type: 'Teacher', id: 'T8', name: 'Adam Šablonový' },
        { type: 'Room', id: 'RA1', name: 'A101' }, { type: 'Room', id: 'RL1', name: 'LAB1' },
    ].map(it => ({ ...it, key: normalize(it.name) }));
    assert.equal(matchRank('mgr. jana ukazkova', 'ukaz'), 2, 'začátek slova, titul nevadí');
    assert.equal(matchRank('a101', 'a101'), 0);
    assert.equal(matchRank('lab1', 'x'), -1);
    const g = searchItems(items, 'sablon');
    assert.deepEqual(g.Teacher.map(x => x.id), ['T8']);
    assert.deepEqual(g.Class, []);
    const a = searchItems(items, 'a');
    assert.deepEqual(a.Room.map(x => x.id), ['RA1', 'RL1'], 'A101 začíná na „a“, LAB1 jen obsahuje');
});
