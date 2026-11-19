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

/* ── opravy po revizi 15. 11. 2026 ──────────────────────────────────────── */

test('skupiny ze staré podoby stránky („1. sk“) neztratí číslo a nejsou třída', async () => {
    const { groupText, classOf } = await import('../public/js/rozvrh-core.js');
    assert.equal(groupText('1. sk'), '1. sk');
    assert.equal(groupText('2. sk'), '2. sk');
    assert.equal(groupText('2.A 1. sk'), '1. sk');
    assert.equal(groupText('2.A 1.sk'), '1. sk');
    assert.equal(groupText('2.A celá'), '');
    assert.equal(classOf({ group: '1. sk' }), '');
    assert.equal(classOf({ group: '2.A 1.sk' }), '2.A');
    assert.equal(classOf({ group: '10.A celá' }), '10.A');
});

test('dělená hodina, jedné skupině odpadá: „teď“ zná všechny skupiny i odpadlou', async () => {
    const { nowState, slotGroups } = await import('../public/js/next-lesson.js');
    const day = [
        L({ hour: 1, group: '1.sk', type: 'removed', changed: true, changeInfo: { description: 'Zrušeno - Nemoc vyučujícího' } }),
        L({ hour: 1, group: '2.sk', subject: 'Fyzika', teacher: 'Libor Návrhový', room: 'U11' }),
        L({ hour: 2 }),
    ];
    const st = nowState(day, { now: new Date(2026, 10, 4, 8, 20) });
    assert.equal(st.kind, 'lesson');
    assert.equal(st.current.items.length, 1);
    assert.equal(st.current.all.length, 2, 'i odpadlá skupina');
    const g = slotGroups(st.current);
    assert.equal(g.split, true);
    assert.deepEqual(g.live.map(x => [x.group, x.lesson.subject, x.lesson.room]), [['2. sk', 'Fyzika', 'U11']]);
    assert.deepEqual(g.off.map(x => [x.group, x.lesson.subject]), [['1. sk', 'Matematika']]);
    // celá třída: žádné skupiny
    const whole = slotGroups(st.next);
    assert.equal(whole.split, false);
    assert.equal(whole.off.length, 0);
});

test('celodenní akce a den, kdy vše odpadá, nejsou „po vyučování“', async () => {
    const { nowState } = await import('../public/js/next-lesson.js');
    const tomorrow = L({ day: 3, hour: 1 });
    const trip = [1, 2, 3, 4, 5].map(hour => L({ hour, subject: 'Exkurze', teacher: '', room: null, type: 'absent', changed: true }));
    const at = (h, m) => new Date(2026, 10, 4, h, m);

    const allDay = nowState([...trip, tomorrow], { now: at(7, 30) });
    assert.equal(allDay.kind, 'noneToday');
    assert.equal(allDay.dayOff, 'event');
    assert.deepEqual(allDay.event, { name: 'Exkurze', from: 1, to: 5 });
    assert.equal(allDay.next.day, 3);

    const removed = [1, 2, 3].map(hour => L({ hour, type: 'removed', changed: true }));
    const off = nowState([...removed, tomorrow], { now: at(7, 30) });
    assert.equal(off.kind, 'noneToday');
    assert.equal(off.dayOff, 'cancelled');
    assert.equal(off.event, null);

    const free = nowState([tomorrow], { now: at(7, 30) });
    assert.equal(free.kind, 'noneToday');
    assert.equal(free.dayOff, 'free');

    // akce jen v 1.–3. hodině, pak se učí
    const part = [...trip.slice(0, 3), L({ hour: 4 }), L({ hour: 5 })];
    const before = nowState(part, { now: at(7, 30) });
    assert.equal(before.kind, 'before');
    assert.deepEqual(before.event, { name: 'Exkurze', from: 1, to: 3 });
    const during = nowState(part, { now: at(8, 20) });
    assert.equal(during.kind, 'before');
    assert.deepEqual(during.event, { name: 'Exkurze', from: 1, to: 3 });
    assert.equal(during.next.hour, 4);
    const lesson = nowState(part, { now: at(10, 55) });
    assert.equal(lesson.kind, 'lesson');
    assert.equal(lesson.event, null);
});

test('týden dat proti dnešku: tento, minulý, bez datumů', async () => {
    const { weekOffset, isThisWeek } = await import('../public/js/rozvrh-core.js');
    const data = [L({ day: 2, date: '2026-11-04' })];
    assert.equal(weekOffset(data, new Date(2026, 10, 4, 8, 20)), 0);
    assert.equal(weekOffset(data, new Date(2026, 10, 8, 23, 0)), 0, 'neděle patří k uplynulému týdnu');
    assert.equal(weekOffset(data, new Date(2026, 10, 9, 8, 20)), -1);
    assert.equal(weekOffset(data, new Date(2026, 9, 30, 8, 20)), 1);
    assert.equal(weekOffset([L()], new Date(2026, 10, 9, 8, 20)), null);
    assert.equal(weekOffset([L({ day: 0, date: '2026-03-30' })], new Date(2026, 2, 27, 12, 0)), 1, 'přes změnu času');
    assert.equal(isThisWeek(new Date(2026, 10, 2), new Date(2026, 10, 4, 8, 20)), true);
    assert.equal(isThisWeek(new Date(2026, 10, 2), new Date(2026, 10, 9, 8, 20)), false);
    assert.equal(isThisWeek(null), false);
});

test('název hodiny pro čtečku říká totéž co obrazovka', async () => {
    const { lessonSentence, slotSentence, slotLessons } = await import('../public/js/rozvrh-core.js');
    const one = (rows) => slotLessons(rows)[0];
    assert.equal(lessonSentence(one([WED[0]])), '1. hodina, 8:00–8:45, Matematika, vyučující Mgr. Marta Cvičná, učebna A101');
    assert.equal(lessonSentence(one([WED[2], WED[3]])),
        '3. hodina, 9:45–10:30, Matematika, vyučující Adam Šablonový, učebna U15, suplování, původně Programování, Mgr. Jana Ukázková');
    assert.match(lessonSentence(one([L({ hour: 4, room: 'LAB2', changed: true, changeInfo: { description: 'Změna místnosti: A101 → LAB2' } })])), /učebna LAB2, jiná učebna, původně A101$/);
    assert.match(lessonSentence(one([WED[5]])), /učebna A102, odpadá, nemoc vyučujícího$/);
    assert.equal(lessonSentence(one([L({ hour: 2, subject: 'Exkurze', teacher: '', room: null, type: 'absent', changed: true })])), '2. hodina, 8:50–9:35, Exkurze, akce');
    assert.doesNotMatch(lessonSentence(one([WED[5]])), /zrušeno|změna/);
    assert.match(lessonSentence({ lesson: L({ group: '2.A 1.sk' }), kind: '', before: null }), /Matematika, třída 2\.A, 1\. sk, vyučující/);
    // dělená hodina: živé skupiny, pak odpadlá
    const split = slotLessons([
        L({ hour: 1, group: '1.sk', type: 'removed', changed: true, changeInfo: { description: 'Hodina odpadla' } }),
        L({ hour: 1, group: '2.sk', subject: 'Fyzika', teacher: 'Libor Návrhový', room: 'U11' }),
    ]);
    assert.equal(slotSentence(split),
        '1. hodina, 8:00–8:45, dělená hodina: Fyzika, 2. sk, vyučující Libor Návrhový, učebna U11; Matematika, 1. sk, vyučující Mgr. Marta Cvičná, učebna A101, odpadá');
    // WCAG 2.5.3: věta obsahuje i to, co je na tlačítku vidět zkráceně
    assert.equal(lessonSentence(one([WED[2], WED[3]]), { short: 'MAT', teacher: 'A. Šablonový', note: 'původně PRG, J. Ukázková' }),
        '3. hodina, 9:45–10:30, Matematika (MAT), vyučující A. Šablonový, učebna U15, suplování, původně PRG, J. Ukázková');
    assert.equal(lessonSentence(one([WED[0]]), { short: 'Matematika', teacher: '', note: '' }),
        '1. hodina, 8:00–8:45, Matematika, vyučující Mgr. Marta Cvičná, učebna A101', 'nezkrácený předmět se neopakuje');
    assert.doesNotMatch(lessonSentence(one([WED[0]]), { short: 'Základy elektrotech...' }), /\(/);
    assert.equal(slotSentence(split, { shorts: true, now: true }),
        '1. hodina, teď, 8:00–8:45, dělená hodina: Fyzika (FYZ), 2. sk, vyučující Libor Návrhový, učebna U11; Matematika (MAT), 1. sk, vyučující Mgr. Marta Cvičná, učebna A101, odpadá');
    assert.match(slotSentence([one([WED[0]])], { shorts: true }), /^1\. hodina, 8:00–8:45, Matematika \(MAT\), vyučující Mgr\. Marta Cvičná, učebna A101$/);
});
