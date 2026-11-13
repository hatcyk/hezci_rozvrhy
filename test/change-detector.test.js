// Testy detektoru změn. Syntetická data, žádná síť.
// Vychází z návrhu rz_ux (test/proposed/change-detector.proposed.test.js); testy,
// které tam byly označené `todo` (známé chyby), po opravě procházejí bez `todo`.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    detectTimetableChanges,
    selectComparisonBaseline,
    inferWeekStart,
    createChangeSummary,
    createDetailedChangeSummary,
    fitFcmDataPayload,
    truncateToBytes,
    FCM_MAX_PAYLOAD_BYTES,
    FCM_SAFE_DATA_BYTES,
    DETAILED_BODY_MAX_BYTES,
} = require('../backend/change-detector');

const META = { type: 'Class', id: 'XX', name: '9.Z', scheduleType: 'Actual' };
const L = (day, hour, subject, teacher, extra = {}) => ({
    day, dayName: ['Po', 'Út', 'St', 'Čt', 'Pá'][day], hour, subject, teacher,
    room: 'A210', group: null, type: 'normal', ...extra,
});
const types = (changes) => changes.map(c => c.type).sort();
const bytes = (s) => Buffer.byteLength(s, 'utf8');

// ─── párování hodin ve slotu ────────────────────────────────────────────────

test('stejné snímky → žádná změna', () => {
    const week = [L(0, 1, 'Matematika', 'Novák'), L(0, 2, 'Fyzika', 'Svoboda')];
    assert.deepEqual(detectTimetableChanges(week, structuredClone(week), META), []);
});

test('jiný učitel, stejný předmět → jedno „substitution“', () => {
    const c = detectTimetableChanges([L(0, 1, 'Matematika', 'Novák')], [L(0, 1, 'Matematika', 'Dvořák')], META);
    assert.deepEqual(types(c), ['substitution']);
    assert.match(c[0].description, /Novák → Dvořák/);
    assert.equal(c[0].timetable, META);
    assert.equal(c[0].change.oldValue, 'Novák');
});

test('suplování + jiná učebna → substitution i room_change', () => {
    const c = detectTimetableChanges([L(0, 1, 'Matematika', 'Novák')],
        [L(0, 1, 'Matematika', 'Dvořák', { room: 'B105' })], META);
    assert.deepEqual(types(c), ['room_change', 'substitution']);
    assert.match(c.find(x => x.type === 'room_change').description, /A210 → B105/);
});

test('jiný předmět ve slotu → subject_change (bez současného hlášení učitele)', () => {
    const c = detectTimetableChanges([L(0, 1, 'Matematika', 'Novák')], [L(0, 1, 'Fyzika', 'Svoboda')], META);
    assert.deepEqual(types(c), ['subject_change']);
    assert.match(c[0].description, /Matematika → Fyzika/);
});

test('zrušená hodina → jen type_change (nehlásí se zároveň učitel/učebna)', () => {
    const c = detectTimetableChanges([L(2, 3, 'Fyzika', 'Svoboda')],
        [L(2, 3, 'Fyzika', '', { type: 'removed', room: null })], META);
    assert.deepEqual(types(c), ['type_change']);
    assert.match(c[0].description, /^Odpadla hodina: Fyzika/);
});

test('absence → type_change s popisem „Absence“; trvající zrušení se znovu nehlásí', () => {
    const absent = detectTimetableChanges([L(3, 1, 'Exkurze', '')], [L(3, 1, 'Exkurze', '', { type: 'absent' })], META);
    assert.deepEqual(types(absent), ['type_change']);
    assert.match(absent[0].description, /^Absence: Exkurze/);

    const stillRemoved = [L(2, 3, 'Fyzika', 'Svoboda', { type: 'removed' })];
    assert.deepEqual(detectTimetableChanges(stillRemoved, [L(2, 3, 'Fyzika', 'Svoboda', { type: 'removed', room: 'X' })], META), []);
});

test('slot zmizel → lesson_removed; nový slot → lesson_added; zrušené hodiny se jako přidané/odebrané nehlásí', () => {
    assert.deepEqual(types(detectTimetableChanges([L(1, 5, 'Chemie', 'Malá')], [], META)), ['lesson_removed']);
    assert.deepEqual(types(detectTimetableChanges([], [L(1, 6, 'Chemie', 'Malá')], META)), ['lesson_added']);
    assert.deepEqual(detectTimetableChanges([L(1, 5, 'Chemie', 'Malá', { type: 'removed' })], [], META), []);
    assert.deepEqual(detectTimetableChanges([], [L(1, 6, 'Chemie', 'Malá', { type: 'removed' })], META), []);
});

test('„1. sk“ a „1.sk“ je stejná skupina; velikost písmen a mezery se ignorují', () => {
    const c = detectTimetableChanges([L(0, 1, 'Matematika ', 'NOVÁK', { group: '1. sk' })],
        [L(0, 1, 'matematika', 'Novák', { group: '1.sk' })], META);
    assert.deepEqual(c, []);
    // kód skupiny z Bakalářů 2026 i starý zápis vedou na stejný slot
    assert.deepEqual(detectTimetableChanges([L(0, 1, 'M', 'N', { group: 'sk1 - 1. skupina' })],
        [L(0, 1, 'M', 'N', { group: 'skupina 1' })], META), []);
});

test('obě skupiny dělené hodiny se hlídají zvlášť', () => {
    const old = [L(0, 1, 'Programování', 'Novák', { group: '1.sk' }), L(0, 1, 'Programování', 'Malá', { group: '2.sk' })];
    const neu = [L(0, 1, 'Programování', 'Novák', { group: '1.sk' }), L(0, 1, 'Programování', 'Černý', { group: '2.sk' })];
    const c = detectTimetableChanges(old, neu, META);
    assert.deepEqual(types(c), ['substitution']);
    assert.equal(c[0].lesson.group, '2.sk');
});

test('dvě hodiny ve stejném slotu, změní se ta druhá (dřív se porovnávala jen první)', () => {
    const old = [L(0, 1, 'Programování', 'Novák', { group: 'TVk1' }), L(0, 1, 'Tělesná výchova', 'Malá', { group: 'TVk1' })];
    const neu = [L(0, 1, 'Programování', 'Novák', { group: 'TVk1' }), L(0, 1, 'Tělesná výchova', 'Černý', { group: 'TVk1' })];
    const c = detectTimetableChanges(old, neu, META);
    assert.deepEqual(types(c), ['substitution']);
    assert.match(c[0].description, /Tělesná výchova - Malá → Černý/);
});

test('dvě hodiny ve slotu v obráceném pořadí → žádná změna', () => {
    const a = L(0, 1, 'Programování', 'Novák', { group: 'TVk1' });
    const b = L(0, 1, 'Tělesná výchova', 'Malá', { group: 'TVk1', room: 'TV' });
    assert.deepEqual(detectTimetableChanges([a, b], [b, a], META), []);
});

test('dvě hodiny ve slotu: jedna zrušená (zkratka z removedinfo), druhá beze změny', () => {
    const old = [L(1, 2, 'Modelování', 'Vzorová Věra'), L(1, 2, 'Programování', 'Novák')];
    const neu = [L(1, 2, 'MOD', 'V. Vzorová', { type: 'removed' }), L(1, 2, 'Programování', 'Novák')];
    const c = detectTimetableChanges(old, neu, META);
    assert.deepEqual(types(c), ['type_change']);
    assert.equal(c[0].lesson.subject, 'MOD');
});

test('stejný učitel, jiný předmět v dvouhodinovém slotu se páruje podle učitele', () => {
    const old = [L(0, 3, 'Matematika', 'Novák', { group: '1.sk' }), L(0, 3, 'Fyzika', 'Malá', { group: '1.sk' })];
    const neu = [L(0, 3, 'Fyzika', 'Malá', { group: '1.sk' }), L(0, 3, 'Seminář', 'Novák', { group: '1.sk' })];
    const c = detectTimetableChanges(old, neu, META);
    assert.deepEqual(types(c), ['subject_change']);
    assert.match(c[0].description, /Matematika → Seminář/);
});

test('suplování vedle přeškrtnuté kopie původní hodiny (addRemovedLessonsFromPermanent) → jen substitution', () => {
    const old = [L(0, 1, 'Matematika', 'Cvičná')];
    const neu = [L(0, 1, 'Matematika', 'Příkladovič'), L(0, 1, 'Matematika', 'Cvičná', { type: 'removed' })];
    const c = detectTimetableChanges(old, neu, META);
    assert.deepEqual(types(c), ['substitution'], 'not "odpadla" + "přidána"');
    assert.match(c[0].description, /Cvičná → Příkladovič/);
    // zrušení suplování ve stejném týdnu: zpět k původnímu učiteli, kopie zmizí
    const back = detectTimetableChanges(neu, old, META);
    assert.deepEqual(types(back), ['substitution']);
    assert.match(back[0].description, /Příkladovič → Cvičná/);
});

test('celodenní absence vedle přeškrtnuté kopie → type_change „absence“, ne „přidána Exkurze“', () => {
    const old = [L(3, 1, 'Matematika', 'Cvičná')];
    const neu = [L(3, 1, 'Exkurze', '', { type: 'absent' }), L(3, 1, 'Matematika', 'Cvičná', { type: 'removed' })];
    const c = detectTimetableChanges(old, neu, META);
    assert.deepEqual(types(c), ['type_change']);
    assert.equal(c[0].change.newValue, 'absent');
});

test('ve slotu přibyla druhá hodina → lesson_added jen pro ni', () => {
    const old = [L(0, 1, 'Matematika', 'Novák')];
    const neu = [L(0, 1, 'Matematika', 'Novák'), L(0, 1, 'Fyzika', 'Malá')];
    const c = detectTimetableChanges(old, neu, META);
    assert.deepEqual(types(c), ['lesson_added']);
    assert.equal(c[0].lesson.subject, 'Fyzika');
});

test('změny jsou seřazené podle dne a hodiny', () => {
    const old = [L(4, 1, 'A', 'x'), L(0, 5, 'B', 'x'), L(0, 2, 'C', 'x')];
    const neu = [L(4, 1, 'A', 'y'), L(0, 5, 'B', 'y'), L(0, 2, 'C', 'y')];
    const c = detectTimetableChanges(old, neu, META);
    assert.deepEqual(c.map(x => `${x.day}-${x.hour}`), ['0-2', '0-5', '4-1']);
});

// ─── týden snímku (S2) ──────────────────────────────────────────────────────

test('přechod týdne: rozdílné týdny se neporovnávají (dřív falešné „Suplování Dvořák → Novák“)', () => {
    // Pátek: snímek týdne 45 (v pondělí suplovala Dvořák). Pondělí ráno: „Actual“ už je týden 46.
    const week45 = [L(0, 1, 'Matematika', 'Dvořák', { date: '2026-11-02' })];
    const week46 = [L(0, 1, 'Matematika', 'Novák', { date: '2026-11-09' })];
    assert.deepEqual(detectTimetableChanges(week45, week46, META), []);
});

test('návrat ke stálému rozvrhu po přechodu týdne nevyvolá notifikaci', () => {
    // Původní návrh testu neměl data hodin, takže nešlo poznat „minulý týden“ od „stejný týden“.
    // Situace z komentáře návrhu: výjimka minulý týden, tento týden zase podle stálého rozvrhu.
    const permanent = [L(0, 1, 'Český jazyk', 'Novák')];
    const lastWeek = [L(0, 1, 'Německý jazyk', 'Malá', { date: '2026-11-02' })];
    const thisWeek = [L(0, 1, 'Český jazyk', 'Novák', { date: '2026-11-09' })];
    // 4. argument (dřív permanentData) se kvůli zpětné kompatibilitě ignoruje
    assert.deepEqual(detectTimetableChanges(lastWeek, thisWeek, META, permanent), []);
});

test('návrat k normálu ve STEJNÉM týdnu je skutečná změna a hlásí se', () => {
    // Pondělí: na středu ohlášené suplování; úterý: suplování zrušeno, učí zase Novák.
    const monday = [L(2, 1, 'Matematika', 'Dvořák', { date: '2026-11-11' })];
    const tuesday = [L(2, 1, 'Matematika', 'Novák', { date: '2026-11-11' })];
    const c = detectTimetableChanges(monday, tuesday, META);
    assert.deepEqual(types(c), ['substitution']);
    assert.match(c[0].description, /Dvořák → Novák/);
});

test('explicitní oldWeekStart/newWeekStart má přednost před daty hodin', () => {
    const old = [L(0, 1, 'M', 'A')];
    const neu = [L(0, 1, 'M', 'B')];
    assert.deepEqual(detectTimetableChanges(old, neu, META, { oldWeekStart: '2026-11-02', newWeekStart: '2026-11-09' }), []);
    assert.equal(detectTimetableChanges(old, neu, META, { oldWeekStart: '2026-11-09', newWeekStart: '2026-11-09' }).length, 1);
    // neznámý týden na jedné straně → detektor porovnává (o tom, zda porovnat, rozhoduje selectComparisonBaseline)
    assert.equal(detectTimetableChanges(old, neu, META, { oldWeekStart: null, newWeekStart: '2026-11-09' }).length, 1);
});

test('inferWeekStart bere pondělí z data první datované hodiny', () => {
    assert.equal(inferWeekStart([L(0, 1, 'M', 'A'), L(3, 1, 'M', 'A', { date: '2026-11-12' })]), '2026-11-09');
    assert.equal(inferWeekStart([L(0, 1, 'M', 'A')]), null);
    assert.equal(inferWeekStart(null), null);
});

test('selectComparisonBaseline: pravidla S2', () => {
    const snap = (weekStart, n = 1) => ({ lessons: Array.from({ length: n }, (_, i) => L(0, i, 'M', 'A')), weekStart });

    // stejný týden
    let r = selectComparisonBaseline({ scheduleType: 'Actual', newWeekStart: '2026-11-09', previous: snap('2026-11-09') });
    assert.equal(r.source, 'same');
    // nový Actual = starý Next
    const oldNext = snap('2026-11-09');
    r = selectComparisonBaseline({ scheduleType: 'Actual', newWeekStart: '2026-11-09', previous: snap('2026-11-02'), previousNext: oldNext });
    assert.equal(r.source, 'previousNext');
    assert.equal(r.baseline, oldNext);
    // nový Next týden nemá základ
    r = selectComparisonBaseline({ scheduleType: 'Next', newWeekStart: '2026-11-16', previous: snap('2026-11-09'), previousNext: snap('2026-11-16') });
    assert.equal(r.baseline, null, 'Next se se „starým Next“ jiného týdne nesrovnává a previousNext se u Next nepoužívá');
    assert.equal(r.reason, 'week_changed');
    r = selectComparisonBaseline({ scheduleType: 'Next', newWeekStart: '2026-11-16', previous: snap('2026-11-16') });
    assert.equal(r.source, 'same');
    // první běh po nasazení: staré snímky nemají weekStart → nic se nehlásí
    r = selectComparisonBaseline({ scheduleType: 'Actual', newWeekStart: '2026-11-09', previous: snap(null), previousNext: snap(undefined) });
    assert.equal(r.baseline, null);
    assert.equal(r.reason, 'previous_without_week');
    // neznámý týden nové stránky
    assert.equal(selectComparisonBaseline({ scheduleType: 'Actual', newWeekStart: null, previous: snap(null) }).reason, 'unknown_week');
    // bez předchozího / s prázdným předchozím
    assert.equal(selectComparisonBaseline({ scheduleType: 'Actual', newWeekStart: '2026-11-09', previous: null }).reason, 'no_previous');
    assert.equal(selectComparisonBaseline({ scheduleType: 'Actual', newWeekStart: '2026-11-09', previous: snap('2026-11-09', 0) }).baseline, null);
    // stálý rozvrh nemá týden a porovnává se se svou předchozí verzí
    assert.equal(selectComparisonBaseline({ scheduleType: 'Permanent', newWeekStart: null, previous: snap(null) }).source, 'same');
    assert.equal(selectComparisonBaseline({ scheduleType: 'Permanent', newWeekStart: null, previous: null }).baseline, null);
});

test('scénář přechodu týdne z pokusu rz_feat: Actual 4 → 1 hlášení, Next 1 → 0', () => {
    // Stejná data jako rz_feat/exp/week_transition.js
    const SUBJ = ['MAT', 'CJL', 'ANJ', 'PRG', 'SIT', 'DBS'];
    const permanent = [];
    for (let d = 0; d < 5; d++) for (let h = 1; h <= 6; h++) {
        const s = SUBJ[(d + h) % SUBJ.length];
        permanent.push({ ...L(d, h, s, `Ucitel-${s}`), room: `U${100 + h}` });
    }
    const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    const week = (weekStart, mods) => permanent.map(l => {
        const m = mods.find(x => x.day === l.day && x.hour === l.hour);
        const lesson = { ...l, date: addDays(weekStart, l.day) };
        return m ? { ...lesson, ...m.patch, changed: true } : lesson;
    });
    const A45 = week('2026-11-02', [
        { day: 2, hour: 3, patch: { teacher: 'Ucitel-SUPL' } },
        { day: 3, hour: 5, patch: { type: 'removed' } },
        { day: 4, hour: 2, patch: { room: 'U999' } },
    ]);
    const N46old = week('2026-11-09', [{ day: 1, hour: 4, patch: { room: 'U555' } }]);
    const A46 = week('2026-11-09', [
        { day: 1, hour: 4, patch: { room: 'U555' } },
        { day: 0, hour: 1, patch: { teacher: 'Ucitel-NOVY' } },
    ]);
    const N47 = week('2026-11-16', []);

    // dřívější chování (bez týdne): 4 hlášení, z toho 3 falešná
    const strip = (lessons) => lessons.map(({ date, ...rest }) => rest);
    assert.equal(detectTimetableChanges(strip(A45), strip(A46), META).length, 4);

    // nové chování
    const actual = selectComparisonBaseline({
        scheduleType: 'Actual', newWeekStart: '2026-11-09',
        previous: { lessons: A45, weekStart: '2026-11-02' }, previousNext: { lessons: N46old, weekStart: '2026-11-09' },
    });
    const changes = detectTimetableChanges(actual.baseline.lessons, A46, META);
    assert.deepEqual(changes.map(c => `${c.type} ${c.day}-${c.hour}`), ['substitution 0-1']);
    assert.match(changes[0].description, /Ucitel-CJL → Ucitel-NOVY/);

    const next = selectComparisonBaseline({
        scheduleType: 'Next', newWeekStart: '2026-11-16', previous: { lessons: N46old, weekStart: '2026-11-09' },
    });
    assert.equal(next.baseline, null);
    // i kdyby volající základ nevybral, detektor rozdílné týdny sám nesrovná
    assert.deepEqual(detectTimetableChanges(N46old, N47, { ...META, scheduleType: 'Next' }), []);
});

// ─── texty notifikací ───────────────────────────────────────────────────────

const ch = (day, hour, extra = {}) => ({
    type: 'lesson_removed', day, dayName: ['Po', 'Út', 'St', 'Čt', 'Pá'][day], hour, lesson: { subject: 'M' + hour }, ...extra,
});

test('souhrn notifikace hlásí přesný počet skrytých změn', () => {
    const changes = [ch(0, 1), ch(0, 2), ch(0, 3), ch(0, 4), ch(0, 5), ch(1, 1)];
    const summary = createChangeSummary(changes);
    // dřív: „… a 3 dalších změn“ za pondělí a navíc „a 3 dalších...“ — skrytá přitom byla jiná čísla
    assert.doesNotMatch(summary, /a 3 dalších\.\.\./);
    // viditelné: Po 1., Po 2. (max. 2 za den) a Út 1. (max. 3 celkem) → skryté 3 (Po 3.–5.)
    assert.equal(summary, 'Po 1.h: M1 odpadla; Po 2.h: M2 odpadla; Út 1.h: M1 odpadla; a 3 další změny');
});

test('souhrn: české tvary čísla a bez přípony do tří změn', () => {
    assert.equal(createChangeSummary([ch(0, 1), ch(1, 1), ch(2, 1)]), 'Po 1.h: M1 odpadla; Út 1.h: M1 odpadla; St 1.h: M1 odpadla');
    assert.match(createChangeSummary([ch(0, 1), ch(1, 1), ch(2, 1), ch(3, 1)]), /; a 1 další změna$/);
    assert.match(createChangeSummary([ch(0, 1), ch(0, 2), ch(0, 3), ch(0, 4), ch(0, 5), ch(0, 6), ch(0, 7)]), /; a 5 dalších změn$/);
    // každý viditelný údaj + počet skrytých = všechny změny
    const many = Array.from({ length: 23 }, (_, i) => ch(i % 5, 1 + Math.floor(i / 5)));
    const s = createChangeSummary(many);
    const shown = s.split('; ').filter(p => /\d\.h:/.test(p)).length;
    assert.equal(shown + Number(s.match(/a (\d+) dalš/)[1]), 23);
});

test('souhrn: všechny typy změn a náhradní zkratka dne', () => {
    const lesson = { subject: 'Fyzika', teacher: 'J. Nová', room: 'B2' };
    const mk = (type, change) => ({ type, day: 0, hour: 2, lesson, change });
    assert.equal(createChangeSummary([mk('substitution', { newValue: 'P. Malý' })]), 'Po 2.h: Fyzika - supluje P. Malý');
    assert.equal(createChangeSummary([mk('room_change', { newValue: 'C3' })]), 'Po 2.h: Fyzika - učebna C3');
    assert.equal(createChangeSummary([mk('lesson_added')]), 'Po 2.h: Přidána Fyzika');
    assert.equal(createChangeSummary([mk('subject_change', { newValue: 'Chemie' })]), 'Po 2.h: Změna na Chemie');
    assert.equal(createChangeSummary([mk('type_change', { newValue: 'absent' })]), 'Po 2.h: Fyzika - absence');
    assert.equal(createChangeSummary([mk('type_change', { newValue: 'removed' })]), 'Po 2.h: Fyzika odpadla');
    assert.equal(createChangeSummary([mk('unknown_type')]), '', 'neznámý typ se nezobrazí ani nezapočítá');
});

test('podrobný text: dny s datem, staré → nové hodnoty', () => {
    const lesson = (date) => ({ subject: 'Fyzika', teacher: 'J. Nová', room: 'B2', date });
    const text = createDetailedChangeSummary([
        { type: 'room_change', day: 1, dayName: 'Út', hour: 3, lesson: lesson('2026-11-10'), change: { oldValue: 'A1', newValue: 'B2' } },
        { type: 'substitution', day: 0, dayName: 'Po', hour: 1, lesson: lesson('2026-11-09'), change: { oldValue: 'P. Malý', newValue: 'J. Nová' } },
        { type: 'lesson_added', day: 0, dayName: 'Po', hour: 7, lesson: lesson('2026-11-09') },
        { type: 'subject_change', day: 1, dayName: 'Út', hour: 4, lesson: lesson('2026-11-10'), change: { oldValue: 'Chemie', newValue: 'Fyzika' } },
        { type: 'lesson_removed', day: 2, dayName: 'St', hour: 1, lesson: lesson(null) },
    ]);
    assert.equal(text, [
        'Po 9. 11.:', '  1.h: Fyzika - P. Malý → J. Nová', '  7.h: Přidána Fyzika (J. Nová)', '',
        'Út 10. 11.:', '  3.h: Fyzika - učebna A1 → B2', '  4.h: Chemie → Fyzika', '',
        'St:', '  1.h: Fyzika odpadla',
    ].join('\n'));
});

test('podrobný text se zkrátí na celé řádky a správně spočítá zbytek', () => {
    const many = Array.from({ length: 200 }, (_, i) => ch(i % 5, i, { lesson: { subject: `Předmět s dlouhým názvem číslo ${i}` } }));
    const text = createDetailedChangeSummary(many);
    assert.ok(bytes(text) <= DETAILED_BODY_MAX_BYTES, `${bytes(text)} B`);
    const shownLines = text.split('\n').filter(line => /^ {2}\d+\.h:/.test(line)).length;
    const hidden = Number(text.match(/… a (\d+) dalš/)[1]);
    assert.equal(shownLines + hidden, 200);
    // žádný useknutý řádek
    assert.ok(text.split('\n').every(line => line === '' || /^(Po|Út|St|Čt|Pá):$|^ {2}\d+\.h: .+ odpadla$|^… a \d+ dalš/.test(line)), text);

    const small = createDetailedChangeSummary(many, { maxBytes: 300 });
    assert.ok(bytes(small) <= 300);
    assert.match(small, /… a \d+ dalších změn$/);
    // extrémně malý limit: pořád v limitu
    assert.ok(bytes(createDetailedChangeSummary(many, { maxBytes: 10 })) <= 10);
});

test('datová zpráva FCM se vejde pod limit 4096 B i při 200 změnách', () => {
    assert.equal(FCM_MAX_PAYLOAD_BYTES, 4096);
    const many = Array.from({ length: 200 }, (_, i) => ch(i % 5, i, { lesson: { subject: `Žluťoučký kůň ${i}` } }));
    const data = {
        type: 'timetable_change', timetableType: 'Class', timetableId: 'ZL', scheduleType: 'Actual',
        changeCount: String(many.length), day: '0', timestamp: new Date(0).toISOString(),
        title: '4.A AKTUÁLNÍ: Změny v rozvrhu', body: createChangeSummary(many), icon: '/icon-192.png',
        detailedBody: createDetailedChangeSummary(many),
    };
    assert.ok(bytes(JSON.stringify(data)) <= FCM_SAFE_DATA_BYTES, 'už výchozí rozpočet podrobného textu stačí');

    // i nadměrný text (např. bez limitu) zkrátí fitFcmDataPayload
    const huge = { ...data, detailedBody: createDetailedChangeSummary(many, { maxBytes: 50000 }) };
    assert.ok(bytes(JSON.stringify(huge)) > FCM_MAX_PAYLOAD_BYTES);
    const fitted = fitFcmDataPayload(huge);
    assert.ok(bytes(JSON.stringify(fitted)) <= FCM_SAFE_DATA_BYTES, `${bytes(JSON.stringify(fitted))} B`);
    assert.equal(fitted.title, data.title, 'ostatní pole zůstanou');
    assert.match(fitted.detailedBody, /…$/);
    assert.ok(huge.detailedBody.startsWith(fitted.detailedBody.slice(0, -1)), 'zkrácený text je začátek původního');

    // malá zpráva se nemění
    assert.equal(fitFcmDataPayload(data), data);
    // když nestačí zkrátit detailedBody, zkrátí se i body
    const bodyTooLong = fitFcmDataPayload({ title: 't', body: 'š'.repeat(5000), detailedBody: 'x'.repeat(5000) }, { maxBytes: 1000 });
    assert.ok(bytes(JSON.stringify(bodyTooLong)) <= 1000);
});

test('truncateToBytes nerozdělí znak a přednostně řeže na konci řádku', () => {
    const text = 'Řádek jedna\nŘádek dva 😀 a ještě dál';
    for (let max = 0; max < bytes(text) + 2; max++) {
        const out = truncateToBytes(text, max);
        assert.ok(bytes(out) <= max || (max === 0 && out === ''), `max ${max}`);
        assert.ok(!out.includes('\uFFFD'));
    }
    assert.equal(truncateToBytes(text, 1000), text);
    assert.equal(truncateToBytes(text, 25), 'Řádek jedna\n…', 'zlom řádku, když zachová většinu textu');
    assert.equal(truncateToBytes(text, 30), 'Řádek jedna\nŘádek dva …', 'jinak řez uprostřed řádku');
});
