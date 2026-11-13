// Agregáty S3 (aggregates/changes_*, aggregates/freeRooms_*). Syntetická data.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildChangesAggregate,
    buildFreeRoomsAggregate,
    dominantWeekStart,
    stableStringify,
    sameAggregateContent,
} = require('../backend/aggregates');

const GEN = '2026-11-09T06:00:00.000Z';
const WEEK = '2026-11-09';
const L = (day, hour, extra = {}) => ({
    day, dayName: ['po', 'út', 'st', 'čt', 'pá'][day], date: null, hour,
    subject: 'Matematika', teacher: 'Ing. Jana Cvičná', room: 'A101', group: null, theme: null,
    type: 'atom', changed: false, changeInfo: null, ...extra,
});
const changed = (description) => ({ changed: true, changeInfo: { raw: description, description } });

/** Every value Firestore accepts: no undefined anywhere, no array directly inside an array. */
function assertFirestoreSafe(value, path = '$') {
    assert.notEqual(value, undefined, `${path} is undefined`);
    if (Array.isArray(value)) {
        value.forEach((v, i) => {
            assert.ok(!Array.isArray(v), `${path}[${i}] is a nested array`);
            assertFirestoreSafe(v, `${path}[${i}]`);
        });
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) assertFirestoreSafe(v, `${path}.${k}`);
    }
}

test('changes: přesný tvar podle S3, druhy položek a řazení podle třídy a hodiny', () => {
    const classes = [
        { id: 'C10', name: '10.A', weekStart: WEEK, lessons: [L(0, 2, { ...changed('Suplování'), teacher: 'Mgr. Hana Náčrtová' })] },
        { id: 'C2', name: '2.A', weekStart: WEEK, lessons: [
            L(0, 3, { type: 'removed', subject: 'Fyzika', ...changed('Hodina odpadla'), group: '1.sk' }),
            L(0, 1, { type: 'absent', subject: 'Exkurze', teacher: '', room: null, ...changed('exkurze (celý den)') }),
            L(0, 1, {}),                    // beze změny → v agregátu není
            L(4, 6, changed('Přesun z 7.9.')),
            L(5, 1, changed('sobota')),     // mimo pracovní týden → ignorováno
        ] },
    ];
    const agg = buildChangesAggregate(classes, { generatedAt: GEN });

    assert.deepEqual(Object.keys(agg), ['weekStart', 'generatedAt', 'days']);
    assert.equal(agg.weekStart, WEEK);
    assert.equal(agg.generatedAt, GEN);
    assert.deepEqual(agg.days.map(d => [d.day, d.date]), [
        [0, '2026-11-09'], [1, '2026-11-10'], [2, '2026-11-11'], [3, '2026-11-12'], [4, '2026-11-13'],
    ]);

    const monday = agg.days[0].items;
    // 2.A před 10.A (přirozené řazení), uvnitř třídy podle hodiny
    assert.deepEqual(monday.map(i => `${i.className}/${i.hour}/${i.kind}`), ['2.A/1/absent', '2.A/3/removed', '10.A/2/changed']);
    assert.deepEqual(monday[1], {
        classId: 'C2', className: '2.A', hour: 3, group: '1.sk', subject: 'Fyzika',
        teacher: 'Ing. Jana Cvičná', room: 'A101', kind: 'removed', description: 'Hodina odpadla',
    });
    assert.equal(monday[0].room, null);
    assert.equal(agg.days[4].items.length, 1);
    assert.deepEqual(agg.days.slice(1, 4).map(d => d.items.length), [0, 0, 0]);
    assertFirestoreSafe(agg);
});

test('changes: snímek jiného týdne (např. nepovedené stažení) se do agregátu nedostane', () => {
    const agg = buildChangesAggregate([
        { id: 'A', name: '1.A', weekStart: WEEK, lessons: [L(0, 1, changed('x'))] },
        { id: 'B', name: '1.B', weekStart: WEEK, lessons: [L(0, 1, changed('x'))] },
        { id: 'C', name: '1.C', weekStart: '2026-11-02', lessons: [L(0, 1, changed('stará'))] },
    ], { generatedAt: GEN });
    assert.deepEqual(agg.days[0].items.map(i => i.classId), ['A', 'B']);

    // bez snímků: prázdný týden s neznámým datem
    const empty = buildChangesAggregate([], { generatedAt: GEN });
    assert.equal(empty.weekStart, null);
    assert.deepEqual(empty.days.map(d => d.date), [null, null, null, null, null]);
    assert.equal(empty.days.every(d => d.items.length === 0), true);
});

test('dominantWeekStart: nejčastější týden, při shodě přednost známému', () => {
    assert.equal(dominantWeekStart([{ weekStart: 'a' }, { weekStart: 'b' }, { weekStart: 'b' }]), 'b');
    assert.equal(dominantWeekStart([{ weekStart: null }, { weekStart: 'a' }]), 'a');
    assert.equal(dominantWeekStart([{}, {}, { weekStart: 'a' }]), null);
    assert.equal(dominantWeekStart([]), null);
});

test('freeRooms: volná = bez hodiny, která není zrušená; neznámá učebna se nevypisuje', () => {
    const rooms = [
        { id: 'R104', name: 'A104', weekStart: WEEK, lessons: [L(0, 1), L(0, 2, { type: 'removed' }), L(1, 1, { type: 'absent' })] },
        { id: 'R20', name: 'A20', weekStart: WEEK, lessons: [L(0, 2)] },
        { id: 'TV', name: 'Tělocvična', weekStart: WEEK, lessons: [] },
        { id: 'OLD', name: 'A999', weekStart: '2026-11-02', lessons: [] }, // jiný týden → nevíme
    ];
    const agg = buildFreeRoomsAggregate(rooms, { generatedAt: GEN, hours: [0, 1, 2] });

    assert.deepEqual(Object.keys(agg), ['weekStart', 'generatedAt', 'rooms', 'free']);
    assert.equal(agg.weekStart, WEEK);
    assert.deepEqual(agg.rooms, [{ id: 'R20', name: 'A20' }, { id: 'R104', name: 'A104' }, { id: 'TV', name: 'Tělocvična' }]);
    assert.equal(Object.keys(agg.free).length, 5 * 3, 'every day × hour of the raster');
    assert.deepEqual(agg.free['0-1'], ['R20', 'TV'], 'A104 has a lesson');
    assert.deepEqual(agg.free['0-2'], ['R104', 'TV'], 'cancelled lesson frees A104');
    assert.deepEqual(agg.free['1-1'], ['R20', 'TV'], 'S3: only "removed" frees a room, absence does not');
    assert.deepEqual(agg.free['4-0'], ['R20', 'R104', 'TV']);
    assert.ok(!JSON.stringify(agg).includes('OLD'));
    assertFirestoreSafe(agg);
});

test('freeRooms: bez rastru se hodiny odvodí z hodin v rozvrzích', () => {
    const agg = buildFreeRoomsAggregate([{ id: 'R', name: 'R', weekStart: WEEK, lessons: [L(0, 2), L(3, 5)] }], { generatedAt: GEN });
    assert.deepEqual(Object.keys(agg.free).filter(k => k.startsWith('0-')), ['0-2', '0-3', '0-4', '0-5']);
    const none = buildFreeRoomsAggregate([], { generatedAt: GEN, hours: [] });
    assert.deepEqual(none.free, {});
    assert.deepEqual(none.rooms, []);
});

test('velikost v rozsahu školy (16 tříd, 28 učeben, hodiny 0–12) je hluboko pod 1 MiB', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const classes = Array.from({ length: 16 }, (_, c) => ({
        id: `C${c}`, name: `${1 + (c % 4)}.${'ABCD'[c >> 2]}`, weekStart: WEEK,
        lessons: Array.from({ length: 35 }, (_, i) => L(i % 5, 1 + Math.floor(i / 5), rnd() < 0.1
            ? { ...changed('Suplování: Ing. Jana Cvičná za Mgr. Hana Náčrtová, učebna A104'), type: rnd() < 0.4 ? 'removed' : 'atom' }
            : {})),
    }));
    const rooms = Array.from({ length: 28 }, (_, r) => ({
        id: `R${r}`, name: `U${100 + r}`, weekStart: WEEK,
        lessons: Array.from({ length: 25 }, () => L(Math.floor(rnd() * 5), Math.floor(rnd() * 13))),
    }));
    const changes = buildChangesAggregate(classes, { generatedAt: GEN });
    const free = buildFreeRoomsAggregate(rooms, { generatedAt: GEN, hours: Array.from({ length: 13 }, (_, i) => i) });
    const size = (o) => Buffer.byteLength(JSON.stringify(o));
    const ONE_MIB = 1024 * 1024;
    assert.ok(size(changes) < 20 * 1024, `changes ${size(changes)} B`);
    assert.ok(size(free) < 30 * 1024, `freeRooms ${size(free)} B`);
    assert.ok(size(changes) < ONE_MIB && size(free) < ONE_MIB);
    // even the worst case — every lesson of every class changed — fits into one document
    const worst = classes.map(c => ({ ...c, lessons: c.lessons.map(l => ({ ...l, ...changed('x'.repeat(200)) })) }));
    assert.ok(size(buildChangesAggregate(worst, { generatedAt: GEN })) < ONE_MIB / 4);
});

test('sameAggregateContent ignoruje generatedAt a pořadí klíčů (Firestore ho nezaručuje)', () => {
    const a = buildFreeRoomsAggregate([{ id: 'R', name: 'R', weekStart: WEEK, lessons: [L(0, 1)] }], { generatedAt: GEN, hours: [1] });
    const b = { ...structuredClone(a), generatedAt: '2030-01-01T00:00:00.000Z' };
    const reordered = { free: b.free, rooms: b.rooms.map(r => ({ name: r.name, id: r.id })), generatedAt: b.generatedAt, weekStart: b.weekStart };
    assert.equal(sameAggregateContent(a, reordered), true);
    assert.equal(sameAggregateContent(a, { ...b, weekStart: '2026-11-16' }), false);
    assert.equal(sameAggregateContent(null, a), false);
    assert.equal(stableStringify({ b: 1, a: [undefined, { d: 2, c: 3 }] }), '{"a":[null,{"c":3,"d":2}],"b":1}');
});
