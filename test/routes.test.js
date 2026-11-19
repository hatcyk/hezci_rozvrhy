// REST routes on the real app (routes/index.js createApp) with Firebase,
// Bakaláři and the reminder job replaced by fakes. No network besides localhost.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeFirestore, stubFirebase, stubModule, listen } = require('./helpers/fake-firestore');

process.env.CRON_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';   // Express then skips logging the expected 413
delete process.env.CORS_ORIGINS;

const { db, messaging, checked } = stubFirebase(createFakeFirestore());
const calls = { prefetch: 0 };
let prefetchDelayMs = 0;
stubModule('backend/prefetch.js', {
    prefetchAllData: async () => {
        calls.prefetch++;
        if (prefetchDelayMs) await new Promise(r => setTimeout(r, prefetchDelayMs));
        return { success: true, status: 'ok', totalRequests: 2, successCount: 2, errorCount: 0, definitionsCount: 3 };
    },
});
// Reminder job whose duration the test controls (budget / 202 test).
let reminderDelayMs = 0;
stubModule('backend/lesson-reminder.js', {
    sendLessonReminders: () => new Promise(r => setTimeout(() => r({ sent: 1, users: 1, skipped: 0 }), reminderDelayMs)),
    getPragueTime: () => new Date(),
    lessonTimes: [],
});

const { createApp, parseCorsOrigins } = require('../routes');

const A = 'anon-0b7f6c1e-8a1d-4c3b-9f2e-1a2b3c4d5e6f';
const B = 'anon-1c8e7d2f-9b2e-4d4c-8a3f-2b3c4d5e6f70';
const asUser = (uid) => ({ authorization: `Bearer valid:${uid}` });
const CRON = { authorization: 'Bearer test-secret' };

let base, close;
test.before(async () => {
    console.log = () => {};   // keep the test output readable
    ({ base, close } = await listen(createApp({ staticDir: null })));
});
test.after(() => close());

const post = (p, body, headers = {}) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
});
const waitFor = async (cond, ms = 2000) => {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end) throw new Error('timeout');
        await new Promise(r => setTimeout(r, 10));
    }
};

test('Vercel najde index.js jako vstup Expressu (jinak build spadne)', () => {
    // Same check as @vercel/express 25.0.0 (dist/index.js: REGEX, validFilenames):
    // the first of app/index/server(.js…) that imports express is the entry point.
    const fs = require('node:fs');
    const path = require('node:path');
    const ROOT = path.join(__dirname, '..');
    const IMPORTS_EXPRESS = /(?:from|require|import)\s*(?:\(\s*)?["']express["']\s*(?:\))?/;
    const candidates = ['app', 'index', 'server', 'src/app', 'src/index', 'src/server']
        .flatMap(f => ['js', 'cjs', 'mjs', 'ts', 'cts', 'mts'].map(ext => `${f}.${ext}`))
        .filter(f => fs.existsSync(path.join(ROOT, f)));
    const entry = candidates.find(f => IMPORTS_EXPRESS.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    assert.equal(entry, 'index.js', `kandidáti: ${candidates.join(', ') || 'žádní'}`);
});

test('bezpečnostní hlavičky jsou na každé odpovědi', async () => {
    const r = await fetch(base + '/api/debug/status');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(r.headers.get('x-powered-by'), null);
});

/** Request with a Host of our choice (fetch cannot set it): the address bar of the page. */
function raw(method, p, headers = {}, body) {
    const http = require('node:http');
    const { port } = new URL(base);
    return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, method, path: p,
            headers: { ...headers, ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}) } }, (res) => {
            let text = '';
            res.on('data', (c) => { text += c; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
        });
        r.on('error', reject);
        if (body !== undefined) r.write(body);
        r.end();
    });
}

test('CORS: stránka na kterékoli doméně volá své API bez CORS_ORIGINS (Origin = vlastní Host)', async () => {
    assert.equal(process.env.CORS_ORIGINS, undefined);
    // The browser sends Origin on every POST and on fetch() even to its own
    // origin; such a request is same-origin and needs no Access-Control-* answer.
    for (const host of ['rozvrh.baratslab.eu', 'spsd-rozvrhy.vercel.app', 'spsd-rozvrhy-git-dev-hatcyk.vercel.app', 'rozvrh.skola.cz']) {
        const page = { Host: host, Origin: `https://${host}`, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' };
        const auth = await raw('POST', '/api/auth', { ...page, 'Content-Type': 'application/json' }, '{}');
        assert.equal(auth.status, 200, `${host}: ${auth.body}`);
        const { token, userId } = JSON.parse(auth.body);
        assert.match(userId, /^anon-/, host);
        assert.equal(token, `custom:${userId}`, host);
        const favorites = await raw('GET', `/api/favorites/${A}`, { ...page, ...asUser(A) });
        assert.equal(favorites.status, 200, `${host}: ${favorites.body}`);
    }
});

test('CORS: cizí původ povolení nedostane, ani s podvrženým Host / X-Forwarded-Host', async () => {
    const acao = (r) => r.headers['access-control-allow-origin'];
    const evil = 'https://evil.example';
    assert.equal(acao(await raw('GET', '/api/status', { Host: 'rozvrh.baratslab.eu', Origin: evil })), undefined);
    // the server never derives "its own" origin from the request, so neither header can make it match
    assert.equal(acao(await raw('GET', '/api/status', { Host: 'rozvrh.baratslab.eu', Origin: evil, 'X-Forwarded-Host': 'evil.example' })), undefined);
    assert.equal(acao(await raw('GET', '/api/status', { Host: 'evil.example', Origin: evil })), undefined);
    // the two domains of one deployment do not call each other: each page talks to its own origin
    assert.equal(acao(await raw('GET', '/api/status', { Host: 'rozvrh.baratslab.eu', Origin: 'https://spsd-rozvrhy.vercel.app' })), undefined);

    const preflight = (origin) => raw('OPTIONS', '/api/fcm/subscribe', {
        Host: 'rozvrh.baratslab.eu', Origin: origin,
        'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type',
    });
    assert.equal(acao(await preflight(evil)), undefined, 'preflight of a foreign page fails: the POST is never sent');
    const dev = await preflight('http://localhost:3000');
    assert.equal(acao(dev), 'http://localhost:3000');
    assert.match(dev.headers['access-control-allow-headers'], /Authorization/i);
});

test('CORS_ORIGINS přepíše výchozí seznam; výchozí obsahuje jen vývojové původy, žádnou doménu nasazení', () => {
    assert.deepEqual(parseCorsOrigins('https://a.cz, https://b.cz/ ,'), ['https://a.cz', 'https://b.cz']);
    assert.deepEqual(parseCorsOrigins(''), ['http://localhost:3000', 'http://127.0.0.1:3000']);
});

test('nechráněné /api/prefetch/trigger a /status už neexistují', async () => {
    assert.equal((await post('/api/prefetch/trigger', {})).status, 404);
    assert.equal((await fetch(base + '/api/prefetch/status')).status, 404);
    assert.equal(calls.prefetch, 0);
});

test('/api/fcm/process-changes vyžaduje CRON_SECRET', async () => {
    assert.equal((await post('/api/fcm/process-changes', {})).status, 401);
    assert.equal((await post('/api/fcm/process-changes', {}, { authorization: 'Bearer nope' })).status, 401);
    assert.equal((await post('/api/fcm/process-changes', {}, CRON)).status, 200);
});

test('subscribe: bez tokenu 401, za cizího uživatele 403, vlastní uloží token', async () => {
    assert.equal((await post('/api/fcm/subscribe', { userId: A, token: 'fcm-a' })).status, 401);
    assert.equal((await post('/api/fcm/subscribe', { userId: B, token: 'fcm-a' }, asUser(A))).status, 403);
    assert.equal(db._get(`users/${B}`), undefined);

    const ok = await post('/api/fcm/subscribe', { userId: A, token: 'fcm-a' }, asUser(A));
    assert.equal(ok.status, 200);
    assert.deepEqual(db._get(`users/${A}`).tokens, ['fcm-a']);

    assert.equal((await post('/api/fcm/subscribe', { userId: A, token: 42 }, asUser(A))).status, 400);
    assert.equal((await post('/api/fcm/subscribe', { userId: A, token: 'x'.repeat(5000) }, asUser(A))).status, 400);
});

test('update-preferences: validuje položky a uloží index watchedKeys', async () => {
    const bad = [
        'x',
        [{ type: 'Hacker', id: 'ZL', scheduleType: 'Actual' }],
        [{ type: 'Class', id: 'ZL', scheduleType: 'Tomorrow' }],
        [{ type: 'Class', id: '', scheduleType: 'Actual' }],
        [{ type: 'Class', id: 'ZL', scheduleType: 'Actual', groupFilters: 'all' }],
        Array.from({ length: 201 }, (_, i) => ({ type: 'Class', id: `C${i}`, scheduleType: 'Actual' })),
    ];
    for (const watchedTimetables of bad) {
        const r = await post('/api/fcm/update-preferences', { userId: A, watchedTimetables }, asUser(A));
        assert.equal(r.status, 400, JSON.stringify(watchedTimetables).slice(0, 80));
    }

    const watched = [{
        type: 'Class', id: 'ZL', name: 'ZL', scheduleType: 'Actual', groupFilters: [],
        notificationTypes: { reminders: { next_lesson_room: true } },
    }];
    assert.equal((await post('/api/fcm/update-preferences', { userId: A, watchedTimetables: watched }, asUser(A))).status, 200);
    const doc = db._get(`users/${A}`);
    assert.deepEqual(doc.watchedKeys, ['Class_ZL_Actual']);
    assert.equal(doc.hasReminders, true);
    assert.deepEqual(doc.watchedTypes, ['Class'], 'index for the admin statistics (count per type)');
});

test('preferences/:userId a unsubscribe chrání stejně', async () => {
    assert.equal((await fetch(`${base}/api/fcm/preferences/${A}`)).status, 401);
    assert.equal((await fetch(`${base}/api/fcm/preferences/${A}`, { headers: asUser(B) })).status, 403);
    const r = await fetch(`${base}/api/fcm/preferences/${A}`, { headers: asUser(A) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).watchedTimetables[0].id, 'ZL');

    assert.equal((await post('/api/fcm/unsubscribe', { userId: A }, asUser(B))).status, 403);
    assert.equal((await post('/api/fcm/unsubscribe', { userId: A }, asUser(A))).status, 200);
    assert.deepEqual(db._get(`users/${A}`).tokens, []);

    assert.equal((await post('/api/fcm/update-global-preferences', { userId: A, notificationTypes: [] }, asUser(A))).status, 400);
    assert.equal((await post('/api/fcm/update-global-preferences', { userId: A, notificationTypes: { systemStatus: true } }, asUser(B))).status, 403);
});

test('oblíbené: přihlášení, vlastnictví, validace a limit těla 50 kB', async () => {
    assert.equal((await fetch(`${base}/api/favorites/${A}`)).status, 401);
    assert.equal((await post(`/api/favorites/${B}`, { favoriteTimetables: [] }, asUser(A))).status, 403);
    assert.equal((await post(`/api/favorites/${A}`, { favoriteTimetables: 'x' }, asUser(A))).status, 400);
    assert.equal((await post(`/api/favorites/${A}`, { favoriteTimetables: [{ type: 'Hacker', id: '1' }] }, asUser(A))).status, 400);
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ type: 'Class', id: 'C' + i }));
    assert.equal((await post(`/api/favorites/${A}`, { favoriteTimetables: tooMany }, asUser(A))).status, 400);
    const big = { favoriteTimetables: [{ type: 'Class', id: 'x'.repeat(60 * 1024) }] };
    assert.equal((await post(`/api/favorites/${A}`, big, asUser(A))).status, 413);

    assert.equal((await post(`/api/favorites/${A}`, { favoriteTimetables: [{ type: 'Room', id: 'A102' }] }, asUser(A))).status, 200);
    const r = await fetch(`${base}/api/favorites/${A}`, { headers: asUser(A) });
    assert.deepEqual((await r.json()).favoriteTimetables, [{ type: 'Room', id: 'A102' }]);
});

// ---- /api/fcm/subscribe: dry-run token check, one owner per token ----------
const C = 'anon-2d9f8e3a-0c3f-4e5d-9b4a-3c4d5e6f7081';
const fcmError = (code) => Object.assign(new Error(`synthetic ${code}`), { code });

test('subscribe: token se nanečisto ověří u FCM; token, který FCM odmítne, je 400 a nic se neuloží', async () => {
    const realSend = messaging.send;
    try {
        checked.length = 0;
        assert.equal((await post('/api/fcm/subscribe', { userId: C, token: 'fcm-c' }, asUser(C))).status, 200);
        assert.deepEqual(checked, [{ message: { token: 'fcm-c', data: {} }, dryRun: true }], 'dry run, nothing is delivered');

        for (const code of ['messaging/invalid-argument', 'messaging/invalid-registration-token', 'messaging/registration-token-not-registered']) {
            messaging.send = async () => { throw fcmError(code); };
            const r = await post('/api/fcm/subscribe', { userId: C, token: 'x'.repeat(4096) }, asUser(C));
            assert.equal(r.status, 400, code);
            assert.deepEqual(db._get(`users/${C}`).tokens, ['fcm-c'], `${code}: the stored token stays`);
        }
    } finally {
        messaging.send = realSend;
    }
});

test('subscribe: výpadek FCM uživatele nezablokuje, token se přijme a zaloguje', async () => {
    const realSend = messaging.send;
    const realWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        for (const failure of [fcmError('messaging/internal-error'), fcmError('messaging/server-unavailable'), new Error('getaddrinfo ENOTFOUND fcm.googleapis.com')]) {
            messaging.send = async () => { throw failure; };
            const r = await post('/api/fcm/subscribe', { userId: C, token: 'fcm-c2' }, asUser(C));
            assert.equal(r.status, 200, failure.message);
            assert.deepEqual(db._get(`users/${C}`).tokens, ['fcm-c2']);
        }
        assert.equal(warnings.length, 3);
        assert.ok(warnings.every(w => !w.includes('fcm-c2')), 'the log does not contain the token');
    } finally {
        messaging.send = realSend;
        console.warn = realWarn;
    }
});

test('subscribe: týž token se odebere jen z osiřelých dokumentů 1.x (anonymous-…), cizí anon-… zůstane netknutý', async () => {
    const ORPHAN = 'anonymous-1733211111111';   // left behind by a migration that could not be proven
    const OTHER = 'anon-3e0a9f4b-1d4a-4f6e-8c5b-4d5e6f708192';
    db._store.set(`users/${ORPHAN}`, { tokens: ['fcm-shared', 'fcm-orphan-own'], notificationsEnabled: true, hasReminders: true });
    db._store.set(`users/${OTHER}`, { tokens: ['fcm-shared'], notificationsEnabled: true, lastUpdated: '2026-11-01T00:00:00.000Z' });
    const otherBefore = db._get(`users/${OTHER}`);
    const realBatch = db.batch;
    let commits = 0;
    db.batch = () => { const b = realBatch(); const commit = b.commit; b.commit = async () => { commits++; return commit(); }; return b; };
    try {
        assert.equal((await post('/api/fcm/subscribe', { userId: C, token: 'fcm-shared' }, asUser(C))).status, 200);
    } finally {
        db.batch = realBatch;
    }
    assert.deepEqual(db._get(`users/${C}`).tokens, ['fcm-shared']);
    assert.deepEqual(db._get(`users/${ORPHAN}`).tokens, ['fcm-orphan-own'], 'only the shared token goes');
    // Knowing somebody's token must not let anyone switch off their notifications.
    assert.deepEqual(db._get(`users/${OTHER}`), otherBefore, 'another anon-<uuid> document is never written');
    assert.equal(commits, 1, 'removal and the own write in one batch');
    db._store.delete(`users/${OTHER}`);
});

test('subscribe: když dotaz na ostatní držitele tokenu selže, token se stejně uloží', async () => {
    const realError = console.error;
    console.error = () => {};
    db._failQuery = (q) => (q.collection === 'users' && q.filters.some(f => f.field === 'tokens')
        ? Object.assign(new Error('9 FAILED_PRECONDITION: index disabled (synthetic)'), { code: 9 }) : null);
    try {
        assert.equal((await post('/api/fcm/subscribe', { userId: C, token: 'fcm-c3' }, asUser(C))).status, 200);
        assert.deepEqual(db._get(`users/${C}`).tokens, ['fcm-c3']);
    } finally {
        db._failQuery = null;
        console.error = realError;
    }
});

// ---- writes per signed-in user ------------------------------------------------
test('zápisy upozornění: nejvýš 60 za 10 min na uživatele (uid, ne IP), pak 429 s Retry-After; čtení a jiný uživatel nedotčeni', async () => {
    const D = 'anon-4f1b0a5c-2e5b-4a7f-9d6c-5e6f708192a3';
    const E = 'anon-5a2c1b6d-3f6c-4b8a-ae7d-6f708192a3b4';
    for (let i = 0; i < 60; i++) {
        const r = await post('/api/fcm/update-global-preferences', { userId: D, notificationTypes: { systemStatus: i % 2 === 0 } }, asUser(D));
        assert.equal(r.status, 200, `write ${i + 1}`);
    }
    const limited = await post('/api/fcm/update-global-preferences', { userId: D, notificationTypes: { systemStatus: true } }, asUser(D));
    assert.equal(limited.status, 429);
    const retry = Number(limited.headers.get('retry-after'));
    assert.ok(retry > 0 && retry <= 600, `Retry-After ${retry}`);
    assert.match((await limited.json()).error, /Příliš mnoho/);
    for (const [p, body] of [
        ['/api/fcm/subscribe', { userId: D, token: 'fcm-d' }],
        ['/api/fcm/unsubscribe', { userId: D }],
        ['/api/fcm/update-preferences', { userId: D, watchedTimetables: [] }],
    ]) {
        assert.equal((await post(p, body, asUser(D))).status, 429, p);
    }
    assert.equal(db._get(`users/${D}`).tokens.length, 0, 'the refused subscribe stored nothing');
    assert.equal((await fetch(`${base}/api/fcm/preferences/${D}`, { headers: asUser(D) })).status, 200, 'reading is not limited');
    assert.equal((await post('/api/fcm/update-global-preferences', { userId: E, notificationTypes: { systemStatus: true } }, asUser(E))).status, 200, 'another user');
});

// ---- first users/{uid} document per address (review 3, point 1) -------------
// /api/auth issues identities to everybody; what is limited per client address
// (IPv6: per /64) is creating a users document, whichever write does it.
const newUid = (n) => `anon-${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CREATE = [
    (uid) => [`/api/favorites/${uid}`, { favoriteTimetables: [{ type: 'Class', id: 'ZL' }] }],
    (uid) => ['/api/fcm/update-preferences', { userId: uid, watchedTimetables: [] }],
    (uid) => ['/api/fcm/update-global-preferences', { userId: uid, notificationTypes: { systemStatus: true } }],
    (uid) => ['/api/fcm/subscribe', { userId: uid, token: `fcm-${uid}` }],
];
async function withTrustProxy(fn) {
    process.env.TRUST_PROXY = '1';
    try { return await fn(); } finally { delete process.env.TRUST_PROXY; }
}
const createFrom = (ip, uid, i = 0) => {
    const [p, body] = CREATE[i % CREATE.length](uid);
    return post(p, body, { ...asUser(uid), 'x-real-ip': ip });
};

test('noví uživatelé: z jedné adresy nejvýš 60 nových dokumentů users za 10 min (jakoukoli cestou), další 429; existující uživatel zapisuje dál', async () => {
    await withTrustProxy(async () => {
        const ip = '198.51.100.20';
        for (let i = 0; i < 60; i++) {
            const uid = newUid(1000 + i);
            assert.equal((await createFrom(ip, uid, i)).status, 200, `new user ${i + 1}`);
            assert.ok(db._get(`users/${uid}`), `users/${uid} created`);
        }
        const checksBefore = checked.length;
        for (let i = 0; i < CREATE.length; i++) {
            const uid = newUid(2000 + i);
            const r = await createFrom(ip, uid, i);
            assert.equal(r.status, 429, CREATE[i](uid)[0]);
            const retry = Number(r.headers.get('retry-after'));
            assert.ok(retry > 0 && retry <= 600, `Retry-After ${retry}`);
            const body = await r.json();
            assert.equal(body.error, 'Příliš mnoho nových uživatelů z této sítě, zkuste to později.');
            assert.equal(body.retryAfterSec, retry);
            assert.equal(db._get(`users/${uid}`), undefined, 'nothing created');
        }
        assert.equal(checked.length, checksBefore, 'a refused new user costs no FCM call');

        // Existing users of the same network keep writing.
        const existing = newUid(1000);
        for (let i = 0; i < CREATE.length; i++) {
            assert.equal((await createFrom(ip, existing, i)).status, 200, `existing user: ${CREATE[i](existing)[0]}`);
        }
        // Reading and writes that create nothing are not limited.
        const fresh = newUid(2100);
        const hdr = { ...asUser(fresh), 'x-real-ip': ip };
        assert.equal((await fetch(`${base}/api/fcm/preferences/${fresh}`, { headers: hdr })).status, 200);
        assert.equal((await fetch(`${base}/api/favorites/${fresh}`, { headers: hdr })).status, 200);
        assert.equal((await post('/api/fcm/unsubscribe', { userId: fresh }, hdr)).status, 200);
        assert.equal(db._get(`users/${fresh}`), undefined);
        // Another network is not affected.
        assert.equal((await createFrom('203.0.113.20', newUid(2200))).status, 200);
    });
});

test('noví uživatelé: IPv6 se počítá po prefixu /64', async () => {
    await withTrustProxy(async () => {
        for (let i = 0; i < 60; i++) assert.equal((await createFrom('2001:db8:aa:bb::1', newUid(3000 + i), i)).status, 200);
        assert.equal((await createFrom('2001:db8:aa:bb:ffff:1:2:3', newUid(3100))).status, 429, 'same /64');
        assert.equal((await createFrom('2001:db8:aa:cc::1', newUid(3101))).status, 200, 'other /64');
    });
});

test('limit nových uživatelů: NEW_USERS_PER_IP_LIMIT, výchozí 60', () => {
    const { newUsersLimit } = require('../routes/new-users');
    assert.equal(newUsersLimit({}), 60);
    assert.equal(newUsersLimit({ NEW_USERS_PER_IP_LIMIT: '200' }), 200);
    for (const bad of ['', '0', '-5', '2.5', 'abc']) assert.equal(newUsersLimit({ NEW_USERS_PER_IP_LIMIT: bad }), 60, bad);
});

test('cron: bez tajemství 401, odpověď nese skutečný UTC čas a pražský čas zvlášť', async () => {
    assert.equal((await fetch(base + '/api/cron/prefetch')).status, 401);
    assert.equal((await fetch(base + '/api/cron/prefetch', { headers: { authorization: 'Bearer spatne' } })).status, 401);

    const r = await fetch(base + '/api/cron/prefetch', { headers: CRON });
    assert.equal(r.status, 200);
    const body = await r.json();
    // Used to be Prague wall-clock time with a "Z" suffix (1-2 h off).
    assert.ok(Math.abs(Date.parse(body.timestamp) - Date.now()) < 5000, body.timestamp);
    assert.match(body.pragueTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    await waitFor(() => db._docs('runs').some(run => run.job === 'prefetch'));
    const run = db._docs('runs').find(x => x.job === 'prefetch');
    assert.equal(run.trigger, 'http');
    assert.equal(run.status, 'ok');
    assert.equal(calls.prefetch, 1);
    await waitFor(() => db._get('system/health'));
    assert.equal(db._get('system/health').lastStatus, 'ok');
});

test('cron prefetch: druhé volání během běhu dostane 409 a nic nespustí; na Vercelu bez waitUntil 501', async () => {
    // the run started by the previous test (and its notification step) has to finish first
    await waitFor(() => !require('../backend/cron').isPrefetchRunning());
    const before = calls.prefetch;
    const runsBefore = db._docs('runs').filter(run => run.job === 'prefetch').length;
    prefetchDelayMs = 150;
    try {
        const first = await fetch(base + '/api/cron/prefetch', { headers: CRON });
        assert.equal(first.status, 200);
        const second = await fetch(base + '/api/cron/prefetch', { headers: CRON });
        assert.equal(second.status, 409, 'used to answer "Prefetch started" although the run was skipped');
        assert.equal((await second.json()).skipped, true);
        await waitFor(() => db._docs('runs').filter(run => run.job === 'prefetch').length === runsBefore + 1);
        assert.equal(calls.prefetch, before + 1);
    } finally {
        prefetchDelayMs = 0;
    }

    // Serverless: work left after the response is frozen, so the run could
    // stop half-way. Without waitUntil the route refuses instead of pretending.
    process.env.VERCEL = '1';
    try {
        const r = await fetch(base + '/api/cron/prefetch', { headers: CRON });
        assert.equal(r.status, 501);
        assert.match((await r.json()).error, /prefetch\.yml/);
        assert.equal(calls.prefetch, before + 1, 'nothing started');
    } finally {
        delete process.env.VERCEL;
    }
});

test('cron upomínky: do limitu 200 s výsledkem, po vyčerpání limitu 202 a běh doběhne', async () => {
    reminderDelayMs = 0;
    const fast = await fetch(base + '/api/cron/lesson-reminders', { headers: CRON });
    assert.equal(fast.status, 200);
    assert.equal((await fast.json()).result.sent, 1);

    process.env.REMINDER_HTTP_BUDGET_MS = '30';
    reminderDelayMs = 200;
    const before = db._docs('runs').filter(x => x.job === 'reminders').length;
    const slow = await fetch(base + '/api/cron/lesson-reminders', { headers: CRON });
    assert.equal(slow.status, 202);
    assert.equal((await slow.json()).pending, true);
    await waitFor(() => db._docs('runs').filter(x => x.job === 'reminders').length === before + 1);
    delete process.env.REMINDER_HTTP_BUDGET_MS;

    const run = db._docs('runs').filter(x => x.job === 'reminders').pop();
    assert.equal(run.trigger, 'http');
    assert.equal(run.counts.sent, 1);
});

test('cron cleanup zapíše běh a smaže i staré runs', async () => {
    db._store.set('runs/old', { job: 'notify', startedAt: '2020-01-01T00:00:00.000Z' });
    const r = await fetch(base + '/api/cron/cleanup', { headers: CRON });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.runsDeleted, 1);
    assert.equal(db._get('runs/old'), undefined);
    assert.ok(db._docs('runs').some(x => x.job === 'cleanup' && x.status === 'ok'));
});
