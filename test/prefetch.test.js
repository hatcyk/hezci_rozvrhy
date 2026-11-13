// prefetchAllData() proti atrapám: Bakaláři = podstrčené axios.get/post, Firestore = paměťová atrapa.
// Žádná síť, žádné skutečné přihlašovací údaje (jen syntetické hodnoty v process.env tohoto procesu).
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

delete process.env.PREFETCH_CONCURRENCY; // test the built-in default
delete process.env.VERCEL;
delete process.env.BAKALARI_USER_AGENT;
process.env.BAKALARI_USERNAME = 'syntheticky-uzivatel';
process.env.BAKALARI_PASSWORD = 'syntheticke-heslo';

const prefetch = require('../backend/prefetch');
const { prefetchAllData, assessLoginResponse, parseSetCookies, classifyError, requestConfig, DEFAULT_CONCURRENCY, CONCURRENT_REQUESTS } = prefetch;
const { parseTimetablePage, addRemovedLessonsFromPermanent } = require('../backend/bakalari-parser');

// Monday of week 46/2026, 6:00 Prague time
const NOW = new Date('2026-11-09T05:00:00Z');
const W45 = '2026-11-02';
const W46 = '2026-11-09';
const W47 = '2026-11-16';

// ─── atrapa Firestore ───────────────────────────────────────────────────────

function fakeFirestore(initial = {}) {
    const store = new Map(Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]));
    const writes = [];
    const snap = (path) => ({
        id: path.split('/')[1],
        exists: store.has(path),
        data: () => structuredClone(store.get(path)),
    });
    const ref = (collection, id) => ({
        id,
        path: `${collection}/${id}`,
        async set(data) {
            assert.ok(!JSON.stringify(data, (k, v) => (v === undefined ? '__undefined__' : v)).includes('__undefined__'),
                `undefined value written to ${collection}/${id} (Firestore rejects it)`);
            store.set(`${collection}/${id}`, structuredClone(data));
            writes.push(`${collection}/${id}`);
        },
        async get() { return snap(`${collection}/${id}`); },
    });
    return {
        store,
        writes,
        collection: (collection) => ({
            doc: (id) => ref(collection, id),
            where: (field, op, value) => ({
                select: () => ({
                    async get() {
                        const docs = [...store.keys()]
                            .filter(p => p.startsWith(`${collection}/`) && store.get(p)[field] === value)
                            .map(snap);
                        return { docs, forEach: (fn) => docs.forEach(fn) };
                    },
                }),
            }),
        }),
        async getAll(...refs) { return refs.map(r => snap(r.path)); },
    };
}

// ─── atrapa stránek Bakalářů ────────────────────────────────────────────────

const HOURS = [
    { Caption: '1', BeginTime: '8:00', EndTime: '8:45' },
    { Caption: '2', BeginTime: '8:50', EndTime: '9:35' },
    { Caption: '3', BeginTime: '9:45', EndTime: '10:30' },
];
const BEGIN = { 1: '08:00:00', 2: '08:50:00', 3: '09:45:00' };
const ABBR = ['po', 'út', 'st', 'čt', 'pá'];
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dm = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}.`; };

/** Embedded-JSON page of one week (weekStart null = permanent: no dates). */
function page(weekStart, lessons = [], { dayOff = [] } = {}) {
    const Days = [0, 1, 2, 3, 4].map(day => ({
        DayAbbrev: ABBR[day],
        Date: weekStart ? dm(addDays(weekStart, day)) : '',
        DayOff: dayOff.includes(day),
        Hours: [1, 2, 3].map(hour => ({
            Begin: BEGIN[hour],
            Atoms: lessons.filter(l => l.day === day && l.hour === hour).map(l => ({
                Room: l.room,
                GroupsNames: l.group || '',
                TeacherFullname: l.teacher,
                TooltipDetails: JSON.stringify({
                    type: l.type || 'atom', subjecttext: l.subject, teacher: l.teacher,
                    room: l.room, group: l.group || '', changeinfo: l.changeinfo || '',
                }),
            })),
        })).filter(h => h.Atoms.length),
    }));
    return `<html><body><script>const timetableData = ${JSON.stringify({ Days, Hours: HOURS })};</script></body></html>`;
}

const DEFINITIONS_PAGE = `<html><body>
<select id="selectedClass"><option value="">-</option><option value="C1">1.A</option></select>
<select id="selectedTeacher"><option value="T1">Cvičná Jana</option></select>
<select id="selectedRoom"><option value="R1">A101</option><option value="R2">A102</option></select>
</body></html>`;
const LOGIN_FORM = '<form method="post"><input name="__RequestVerificationToken" value="tok"><input name="username"><input type="password" name="password"></form>';

// Class 1.A: permanent schedule and its weeks
const LESSON = (day, hour, subject, teacher, room, extra = {}) => ({ day, hour, subject, teacher, room, ...extra });
const PERM = [
    LESSON(0, 1, 'Matematika', 'Ing. Jana Cvičná', 'A101'),
    LESSON(0, 2, 'Český jazyk', 'Mgr. Hana Náčrtová', 'A102'),
    LESSON(1, 1, 'Angličtina', 'Lee Sample', 'A101'),
];
const withMods = (mods) => PERM.map(l => {
    const m = mods.find(x => x.day === l.day && x.hour === l.hour);
    return m ? { ...l, ...m, changeinfo: 'Změna (syntetická)' } : l;
});
const A45 = withMods([{ day: 0, hour: 2, teacher: 'Mgr. Karel Smyšlený' }]);             // supl. minulý týden
const N46_OLD = withMods([{ day: 1, hour: 1, room: 'A105' }]);                            // předem známá změna
const A46 = withMods([{ day: 1, hour: 1, room: 'A105' }, { day: 0, hour: 1, teacher: 'Ing. Radim Příkladovič Ph.D.' }]);
const N47 = withMods([]);

/** Stored snapshot doc exactly as an earlier prefetch run would have written it. */
function storedDoc(type, id, scheduleType, lessons, weekStart, { withWeek = true, permanent = null } = {}) {
    let data = parseTimetablePage(page(weekStart, lessons), { now: NOW }).lessons;
    if (scheduleType === 'Permanent') data = data.map(l => ({ ...l, date: null }));
    if (permanent) data = addRemovedLessonsFromPermanent(data, permanent, { weekStart });
    const doc = { type, id, name: id, scheduleType, data, lessonCount: data.length, lastUpdate: 'x' };
    if (withWeek) doc.weekStart = scheduleType === 'Permanent' ? null : weekStart;
    return doc;
}

function initialStore({ withWeek = true } = {}) {
    const permanentLessons = storedDoc('Class', 'C1', 'Permanent', PERM, null).data;
    return {
        'timetables/Class_C1_Permanent': storedDoc('Class', 'C1', 'Permanent', PERM, null),
        'timetables/Teacher_T1_Permanent': storedDoc('Teacher', 'T1', 'Permanent', PERM, null),
        'timetables/Room_R1_Permanent': storedDoc('Room', 'R1', 'Permanent', PERM, null),
        'timetables/Room_R2_Permanent': storedDoc('Room', 'R2', 'Permanent', PERM.slice(0, 1), null),
        'timetables/Class_C1_Actual': storedDoc('Class', 'C1', 'Actual', A45, W45, { withWeek, permanent: permanentLessons }),
        'timetables/Class_C1_Next': storedDoc('Class', 'C1', 'Next', N46_OLD, W46, { withWeek }),
    };
}

/** Default pages: Class 1.A week 46/47, teacher and rooms with a few lessons. */
function defaultPages() {
    return {
        'Actual/Class/C1': page(W46, A46),
        'Next/Class/C1': page(W47, N47),
        'Actual/Teacher/T1': page(W46, [A46[0]]),
        'Next/Teacher/T1': page(W47, [N47[0]]),
        'Actual/Room/R1': page(W46, [A46[0], A46[2]]),
        'Next/Room/R1': page(W47, [N47[0]]),
        'Actual/Room/R2': page(W46, []),
        'Next/Room/R2': page(W47, []),
    };
}

/**
 * Install the Bakaláři fake on axios for one test.
 * @returns {{ calls: Array, maxInFlight: () => Number }}
 */
function fakeBakalari(t, { pages = defaultPages(), login = 'ok', definitions = DEFINITIONS_PAGE, failures = {} } = {}) {
    const calls = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const respond = async (fn) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
            await new Promise(resolve => setTimeout(resolve, 1));
            return fn();
        } finally {
            inFlight--;
        }
    };
    const httpError = (status, headers = {}) => Object.assign(new Error(`Request failed with status code ${status}`),
        { isAxiosError: true, response: { status, headers } });
    const netError = (code) => Object.assign(new Error(`${code} (synthetic)`), { isAxiosError: true, code });

    t.mock.method(axios, 'get', (url, config) => respond(() => {
        calls.push({ method: 'GET', url, ua: config && config.headers && config.headers['User-Agent'] });
        const path = new URL(url).pathname;
        const failure = failures[path];
        if (failure && failure.remaining > 0) {
            failure.remaining--;
            throw failure.status ? httpError(failure.status) : netError(failure.code);
        }
        if (path === '/login') {
            if (login === 'network') throw netError('ECONNRESET');
            return { status: 200, headers: { 'set-cookie': ['pre=1; path=/'] }, data: LOGIN_FORM };
        }
        if (path === '/Timetable/Public/Actual/Class/ZL') return { status: 200, headers: {}, data: definitions };
        const key = path.replace('/Timetable/Public/', '');
        if (pages[key] !== undefined) return { status: 200, headers: {}, data: pages[key] };
        throw httpError(404);
    }));
    t.mock.method(axios, 'post', (url) => respond(() => {
        calls.push({ method: 'POST', url });
        if (login === 'ok') return { status: 302, headers: { location: '/dashboard', 'set-cookie': ['BakaAuth=c2Vzc2lvbg==; path=/; HttpOnly'] }, data: '' };
        if (login === 'wrong_password') return { status: 200, headers: {}, data: `<p>Neplatné přihlašovací údaje</p>${LOGIN_FORM}` };
        if (login === 'redirect_login') return { status: 302, headers: { location: '/login?error=1' }, data: '' };
        if (login === 'no_cookie') return { status: 302, headers: { location: '/dashboard' }, data: '' };
        throw new Error('unexpected');
    }));
    return { calls, maxInFlight: () => maxInFlight };
}

const quiet = (t) => {
    for (const level of ['log', 'warn', 'error']) t.mock.method(console, level, () => {});
};
const run = (db, extra = {}) => prefetchAllData({ db, now: NOW, retryDelayMs: 0, ...extra });
const changeDocs = (db) => [...db.store.keys()].filter(p => p.startsWith('changes/'));

// ─── přihlášení ─────────────────────────────────────────────────────────────

test('assessLoginResponse pozná odmítnuté přihlášení', () => {
    assert.deepEqual(assessLoginResponse({ status: 302, headers: { location: '/dashboard', 'set-cookie': ['a=b'] } }), { ok: true });
    assert.equal(assessLoginResponse({ status: 302, headers: { location: '/login?ReturnUrl=%2F', 'set-cookie': ['a=b'] } }).ok, false);
    assert.equal(assessLoginResponse({ status: 302, headers: { location: 'https://mot-spsd.bakalari.cz/Login', 'set-cookie': ['a=b'] } }).ok, false);
    assert.match(assessLoginResponse({ status: 200, headers: { 'set-cookie': ['a=b'] }, data: LOGIN_FORM }).reason, /login form/);
    assert.match(assessLoginResponse({ status: 302, headers: { location: '/dashboard' } }).reason, /no session cookie/);
    assert.equal(assessLoginResponse({ status: 200, headers: { 'set-cookie': 'a=b' }, data: '<h1>Rozvrh</h1>' }).ok, true);
    assert.equal(assessLoginResponse(null).ok, false);
});

test('parseSetCookies nechá "=" v hodnotě (base64), ignoruje atributy', () => {
    assert.deepEqual(parseSetCookies(['BakaAuth=YWJj==; path=/; HttpOnly', 'x=1', 'bad', '=nojmeno']), { BakaAuth: 'YWJj==', x: '1' });
    assert.deepEqual(parseSetCookies(undefined), {});
});

for (const [login, why] of [['wrong_password', 'vrácený formulář'], ['redirect_login', 'přesměrování na /login'], ['no_cookie', 'chybějící cookie']]) {
    test(`špatné přihlášení (${why}) → status login_failed, bez opakování a bez zápisu`, async (t) => {
        quiet(t);
        const bak = fakeBakalari(t, { login });
        const db = fakeFirestore(initialStore());
        const result = await run(db);
        assert.equal(result.status, 'login_failed');
        assert.equal(result.success, false);
        assert.match(result.error, /login rejected/);
        assert.equal(bak.calls.filter(c => c.method === 'POST').length, 1, 'wrong credentials are not retried');
        assert.deepEqual(db.writes, []);
    });
}

test('stránka definic je přihlašovací formulář (relace nepřijata) → login_failed', async (t) => {
    quiet(t);
    fakeBakalari(t, { definitions: LOGIN_FORM });
    const db = fakeFirestore();
    const result = await run(db);
    assert.equal(result.status, 'login_failed');
    assert.deepEqual(db.writes, []);
});

test('nedostupný server při přihlášení → status network po 3 pokusech', async (t) => {
    quiet(t);
    const bak = fakeBakalari(t, { login: 'network' });
    const result = await run(fakeFirestore());
    assert.equal(result.status, 'network');
    assert.match(result.error, /login failed after 3 attempts/);
    assert.equal(bak.calls.filter(c => c.url.endsWith('/login')).length, 3);
});

// ─── pojistky ───────────────────────────────────────────────────────────────

test('0 definic → guard_no_definitions, Firestore beze změny', async (t) => {
    quiet(t);
    fakeBakalari(t, { definitions: '<html><body><h1>Rozvrh</h1><select id="selectedClass"></select></body></html>' });
    const db = fakeFirestore(initialStore());
    const result = await run(db);
    assert.equal(result.status, 'guard_no_definitions');
    assert.equal(result.success, false);
    assert.deepEqual(db.writes, []);
});

test('0 hodin ve všech třídách → guard_no_lessons, Firestore beze změny', async (t) => {
    quiet(t);
    fakeBakalari(t, { pages: { ...defaultPages(), 'Actual/Class/C1': page(W46, []), 'Next/Class/C1': page(W47, []) } });
    const db = fakeFirestore(initialStore());
    const result = await run(db);
    assert.equal(result.status, 'guard_no_lessons');
    assert.deepEqual(db.writes, []);
});

test('stažení všech tříd selže (síť) → network, ne guard_no_lessons', async (t) => {
    quiet(t);
    fakeBakalari(t, { failures: {
        '/Timetable/Public/Actual/Class/C1': { code: 'ETIMEDOUT', remaining: 99 },
    } });
    const db = fakeFirestore(initialStore());
    const result = await run(db);
    assert.equal(result.status, 'network');
    assert.deepEqual(db.writes, []);
});

// ─── hlavní běh: přechod týdne, snímky, agregáty ────────────────────────────

test('pondělní běh: nový Actual se porovná se starým Next téhož týdne → jen skutečná nová změna', async (t) => {
    quiet(t);
    const bak = fakeBakalari(t);
    const db = fakeFirestore(initialStore());
    const result = await run(db);

    assert.equal(result.status, 'ok');
    assert.equal(result.success, true);
    assert.equal(result.errorCount, 0);
    assert.equal(result.definitionsCount, 4);

    // jediný dokument změn: Class_C1_Actual, jen nové suplování po 1. hod.
    const docs = changeDocs(db);
    assert.equal(docs.length, 1, docs.join(', '));
    assert.match(docs[0], /^changes\/Class_C1_Actual_\d+$/);
    const changeDoc = db.store.get(docs[0]);
    assert.equal(changeDoc.weekStart, W46);
    assert.equal(changeDoc.sent, false);
    assert.deepEqual(changeDoc.changes.map(c => `${c.type} ${c.day}-${c.hour}`), ['substitution 0-1']);
    assert.equal(changeDoc.changes[0].lesson.date, '2026-11-09');
    assert.equal(result.changesDetected, 1);

    // snímky mají weekStart a hodiny datum (S2)
    const actual = db.store.get('timetables/Class_C1_Actual');
    assert.equal(actual.weekStart, W46);
    assert.ok(actual.data.every(l => /^2026-11-(09|1[0-3])$/.test(l.date)));
    assert.equal(db.store.get('timetables/Class_C1_Next').weekStart, W47);
    assert.equal(db.store.get('timetables/Class_C1_Permanent').weekStart, null, 'permanent not refetched outside September');

    // agregáty (S3)
    const changesAgg = db.store.get('aggregates/changes_Actual');
    assert.equal(changesAgg.weekStart, W46);
    // S3 filter taken literally: a substitution = the substitute (changed) + the struck-through
    // original copied from the permanent schedule (removed), exactly as the timetable shows it
    assert.deepEqual(changesAgg.days[0].items.map(i => `${i.className} ${i.hour} ${i.kind} ${i.teacher}`).sort(),
        ['1.A 1 changed Ing. Radim Příkladovič Ph.D.', '1.A 1 removed Ing. Jana Cvičná']);
    assert.deepEqual(changesAgg.days[1].items.map(i => `${i.hour} ${i.room}`), ['1 A105']);
    assert.equal(db.store.get('aggregates/changes_Next').weekStart, W47);
    const free = db.store.get('aggregates/freeRooms_Actual');
    assert.deepEqual(free.rooms, [{ id: 'R1', name: 'A101' }, { id: 'R2', name: 'A102' }]);
    assert.deepEqual(free.free['0-1'], ['R2'], 'A101 hosts 1.A in Mon 1st hour');
    assert.deepEqual(free.free['0-2'], ['R1', 'R2']);
    assert.deepEqual(Object.keys(free.free).length, 5 * 3, 'raster hours 1–3');
    assert.equal(result.aggregatesWritten, 4);

    // šetrnost: výchozí souběžnost 3 a nikdy víc požadavků najednou
    assert.equal(DEFAULT_CONCURRENCY, 3);
    assert.equal(CONCURRENT_REQUESTS, 3);
    assert.ok(bak.maxInFlight() <= 3, `max in flight ${bak.maxInFlight()}`);
    // Class Actual/Next pages are downloaded once (reused from the group step)
    assert.equal(bak.calls.filter(c => c.url.endsWith('/Actual/Class/C1')).length, 1);
});

test('druhý běh se stejnými stránkami: žádné zápisy snímků, změn ani agregátů', async (t) => {
    quiet(t);
    fakeBakalari(t);
    const db = fakeFirestore(initialStore());
    await run(db);
    const before = db.writes.length;
    const result = await run(db);
    assert.equal(result.status, 'ok');
    assert.equal(result.timetablesWritten, 0);
    assert.equal(result.changeDocs, 0);
    assert.equal(result.aggregatesWritten, 0);
    assert.deepEqual(db.writes.slice(before).sort(), ['definitions/current', 'metadata/lastPrefetch']);
});

test('první běh po nasazení: staré snímky bez weekStart → nic se nehlásí, snímky se přepíšou s týdnem', async (t) => {
    quiet(t);
    fakeBakalari(t);
    const db = fakeFirestore(initialStore({ withWeek: false }));
    const result = await run(db);
    assert.equal(result.status, 'ok');
    assert.deepEqual(changeDocs(db), []);
    assert.ok(result.comparisonsSkipped >= 2);
    assert.equal(db.store.get('timetables/Class_C1_Actual').weekStart, W46);
});

test('prázdná stránka jednoho rozvrhu nepřepíše neprázdný snímek; celý týden volna ano', async (t) => {
    quiet(t);
    // the week after (Monday 16. 11.): 1.A Actual comes back empty (glitch); room A101 has a holiday week next
    const db = fakeFirestore(initialStore());
    {
        fakeBakalari(t);
        await run(db);
    }
    t.mock.restoreAll();
    quiet(t);
    fakeBakalari(t, { pages: {
        ...defaultPages(),
        'Actual/Class/C1': page(W47, []),
        'Next/Class/C1': page('2026-11-23', N47),
        'Actual/Room/R1': page(W47, [N47[0]]),
        'Next/Room/R1': page('2026-11-23', [], { dayOff: [0, 1, 2, 3, 4] }),
    } });
    const beforeActual = db.store.get('timetables/Class_C1_Actual');
    const result = await run(db, { now: new Date('2026-11-16T05:00:00Z') });

    assert.equal(result.status, 'ok');
    assert.equal(result.emptyGuarded, 1);
    assert.deepEqual(db.store.get('timetables/Class_C1_Actual'), beforeActual, 'kept as it was');
    const roomNext = db.store.get('timetables/Room_R1_Next');
    assert.equal(roomNext.lessonCount, 0, 'holiday week (all DayOff) replaces the non-empty snapshot');
    assert.equal(roomNext.weekStart, '2026-11-23');
    assert.equal(changeDocs(db).filter(p => p.includes('Class_C1_Actual')).length, 1, 'only the one from the first run');
    // the kept snapshot is from another week than the other classes' → left out of the board
    assert.equal(db.store.get('aggregates/changes_Actual').weekStart, W46, 'only 1 class: its (kept) week');
});

test('opakování stahování: 503 a výpadek se zopakují, 404 ne', async (t) => {
    quiet(t);
    const bak = fakeBakalari(t, { failures: {
        '/Timetable/Public/Actual/Teacher/T1': { status: 503, remaining: 1 },
        '/Timetable/Public/Next/Teacher/T1': { code: 'ECONNRESET', remaining: 2 },
    }, pages: (() => { const p = defaultPages(); delete p['Next/Room/R2']; return p; })() });
    const db = fakeFirestore(initialStore());
    const result = await run(db);
    assert.equal(result.status, 'ok');
    assert.equal(bak.calls.filter(c => c.url.endsWith('/Actual/Teacher/T1')).length, 2);
    assert.equal(bak.calls.filter(c => c.url.endsWith('/Next/Teacher/T1')).length, 3);
    assert.equal(bak.calls.filter(c => c.url.endsWith('/Next/Room/R2')).length, 1, '404 is not retried');
    assert.equal(result.errorCount, 1);
    assert.ok(db.store.has('timetables/Teacher_T1_Next'));
});

test('User-Agent: výchozí zůstává, BAKALARI_USER_AGENT ho přepíše', async (t) => {
    assert.match(requestConfig().headers['User-Agent'], /^Mozilla\/5\.0/);
    t.after(() => { delete process.env.BAKALARI_USER_AGENT; });
    process.env.BAKALARI_USER_AGENT = 'LepsiRozvrh-test/1.0 (+https://example.invalid/kontakt)';
    quiet(t);
    const bak = fakeBakalari(t);
    await run(fakeFirestore(initialStore()));
    const agents = new Set(bak.calls.filter(c => c.method === 'GET').map(c => c.ua));
    assert.deepEqual([...agents], ['LepsiRozvrh-test/1.0 (+https://example.invalid/kontakt)']);
});

test('classifyError mapuje chyby na status S4', () => {
    const e = (props) => Object.assign(new Error('x'), props);
    assert.equal(classifyError(e({ code: 'BAKALARI_LOGIN_FAILED' })), 'login_failed');
    assert.equal(classifyError(e({ code: 'ECONNRESET' })), 'network');
    assert.equal(classifyError(e({ cause: e({ code: 'ENOTFOUND' }) })), 'network');
    assert.equal(classifyError(e({ response: { status: 502 } })), 'network');
    assert.equal(classifyError(e({ response: { status: 429 } })), 'network');
    assert.equal(classifyError(e({ response: { status: 404 } })), 'error');
    assert.equal(classifyError(new TypeError('bug')), 'error');
    assert.equal(classifyError(null), 'error');
});

test('neočekávaná chyba (Firestore) → status error, funkce nevyhazuje', async (t) => {
    quiet(t);
    fakeBakalari(t);
    const db = fakeFirestore(initialStore());
    db.getAll = async () => { throw new Error('Firestore unavailable (synthetic)'); };
    const result = await run(db);
    assert.equal(result.status, 'error');
    assert.equal(result.success, false);
    assert.match(result.error, /Firestore unavailable/);
});

test('září: stálé rozvrhy se stáhnou znovu, bez týdne a bez dat; skupiny jdou do definic', async (t) => {
    quiet(t);
    const grouped = [...PERM, LESSON(2, 3, 'Programování', 'Ing. Jana Cvičná', 'A102', { group: 'sk1 - 1. skupina' })];
    const pages = {
        ...defaultPages(),
        'Actual/Class/C1': page('2026-09-07', grouped),
        'Next/Class/C1': page('2026-09-14', grouped),
        'Permanent/Class/C1': page('2026-09-07', grouped), // even if the page had dates, Permanent has no week
        'Permanent/Teacher/T1': page(null, PERM),
        'Permanent/Room/R1': page(null, PERM),
        'Permanent/Room/R2': page(null, []),
    };
    fakeBakalari(t, { pages });
    const db = fakeFirestore(initialStore());
    const result = await run(db, { now: new Date('2026-09-08T05:00:00Z') });
    assert.equal(result.status, 'ok');
    const permanent = db.store.get('timetables/Class_C1_Permanent');
    assert.equal(permanent.weekStart, null);
    assert.ok(permanent.data.every(l => l.date === null));
    assert.deepEqual(db.store.get('definitions/current').classGroups, { C1: ['1.sk'] });
    assert.equal(db.store.get('timetables/Class_C1_Actual').weekStart, '2026-09-07');
});

test('chybějící přihlašovací údaje → login_failed', async (t) => {
    quiet(t);
    fakeBakalari(t);
    const saved = process.env.BAKALARI_PASSWORD;
    t.after(() => { process.env.BAKALARI_PASSWORD = saved; });
    delete process.env.BAKALARI_PASSWORD;
    const result = await run(fakeFirestore());
    assert.equal(result.status, 'login_failed');
    assert.match(result.error, /must be set/);
});

test('selhání zápisu agregátů nezmění úspěšný běh, jen se ohlásí', async (t) => {
    quiet(t);
    fakeBakalari(t);
    const db = fakeFirestore(initialStore());
    const getAll = db.getAll;
    db.getAll = async (...refs) => {
        if (refs.some(r => r.path.startsWith('aggregates/'))) throw new Error('aggregates read failed (synthetic)');
        return getAll(...refs);
    };
    const result = await run(db);
    assert.equal(result.status, 'ok');
    assert.match(result.aggregatesError, /synthetic/);
    assert.ok(db.store.has('timetables/Class_C1_Actual'));
});

test('den volna: žádné „odpadlé“ hodiny ze stálého rozvrhu, žádné řádky na tabuli změn, daysOff v dokumentu', async (t) => {
    quiet(t);
    // Monday of week 46 is a day off. Bakaláři shows no lessons that day in
    // both the old Next snapshot and the new Actual page.
    const tuesdayOnly = A46.filter(l => l.day !== 0);
    const store = initialStore();
    store['timetables/Class_C1_Next'] = storedDoc('Class', 'C1', 'Next', N46_OLD.filter(l => l.day !== 0), W46);
    fakeBakalari(t, { pages: { ...defaultPages(), 'Actual/Class/C1': page(W46, tuesdayOnly, { dayOff: [0] }) } });
    const db = fakeFirestore(store);
    const result = await run(db);

    assert.equal(result.status, 'ok');
    const actual = db.store.get('timetables/Class_C1_Actual');
    assert.deepEqual(actual.daysOff, [{ day: 0, date: W46, name: '' }]);
    assert.deepEqual(actual.data.filter(l => l.day === 0), [], 'used to hold Matematika + Český jazyk as "Hodina odpadla"');
    assert.equal(changeDocs(db).filter(p => p.includes('Class_C1_Actual')).length, 0);
    assert.deepEqual(db.store.get('aggregates/changes_Actual').days[0].items, []);
    // the other snapshots carry an empty list, the permanent one too
    assert.deepEqual(db.store.get('timetables/Class_C1_Next').daysOff, []);
});
