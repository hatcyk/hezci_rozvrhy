// REST routes on the real app (routes/index.js createApp) with Firebase,
// Bakaláři and the reminder job replaced by fakes. No network besides localhost.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeFirestore, stubFirebase, stubModule, listen } = require('./helpers/fake-firestore');

process.env.CRON_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';   // Express then skips logging the expected 413
delete process.env.CORS_ORIGINS;

const { db } = stubFirebase(createFakeFirestore());
const calls = { prefetch: 0 };
stubModule('backend/prefetch.js', {
    prefetchAllData: async () => {
        calls.prefetch++;
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

test('CORS: vlastní původ dostane povolení, cizí web ne', async () => {
    const own = await fetch(base + '/api/debug/status', { headers: { origin: 'https://spsd-rozvrhy.vercel.app' } });
    assert.equal(own.headers.get('access-control-allow-origin'), 'https://spsd-rozvrhy.vercel.app');

    const evil = await fetch(base + '/api/debug/status', { headers: { origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);

    const preflight = await fetch(base + '/api/fcm/subscribe', {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
    });
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/i);
});

test('CORS_ORIGINS přepíše výchozí seznam', () => {
    assert.deepEqual(parseCorsOrigins('https://a.cz, https://b.cz/ ,'), ['https://a.cz', 'https://b.cz']);
    assert.ok(parseCorsOrigins('').includes('https://spsd-rozvrhy.vercel.app'));
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
