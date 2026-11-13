// Admin API (S5) on the real app with a fake Firestore and a fake fetch for
// the GitHub API. No network besides localhost, no real secrets.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeFirestore, stubFirebase, listen } = require('./helpers/fake-firestore');

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
delete process.env.TRUST_PROXY;
const SECRET = 'admin-test-secret-0123456789';
process.env.ADMIN_SECRET = SECRET;
process.env.GITHUB_DISPATCH_TOKEN = 'github_pat_synthetic';
process.env.GITHUB_REPO = 'hatcyk/hezci_rozvrhy';
delete process.env.GITHUB_DISPATCH_REF;
delete process.env.GITHUB_DISPATCH_WORKFLOW;

const NOW = new Date('2026-11-04T09:00:00Z'); // Wednesday 10:00 Prague
const iso = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60000).toISOString();
const run = (job, minutesAgo, extra = {}) => ({
    job, trigger: 'schedule', startedAt: iso(minutesAgo), finishedAt: iso(minutesAgo - 1), durationMs: 60000, status: 'ok', counts: {}, error: null, ...extra,
});

const USER_A = 'anon-0b7f6c1e-8a1d-4c3b-9f2e-1a2b3c4d5e6f';
const USER_B = 'anon-1c8e7d2f-9b2e-4d4c-8a3f-2b3c4d5e6f70';
const db = createFakeFirestore({
    'system/health': { lastRunAt: iso(10), lastSuccessAt: iso(10), lastStatus: 'ok', consecutiveFailures: 0, lastError: null, updatedAt: iso(10) },
    'runs/p1': run('prefetch', 10, { counts: { changesDetected: 3 } }),
    'runs/p2': run('prefetch', 25, { counts: { changesDetected: 1 } }),
    'runs/p3': run('prefetch', 70, { trigger: 'dispatch', counts: { changesDetected: 0 } }),
    'runs/p-old': run('prefetch', 60 * 24 * 9),
    'runs/n1': run('notify', 5, { counts: { processed: 2, sent: 4 } }),
    'runs/n2': run('notify', 60 * 24 * 2, { counts: { processed: 1, sent: 2 } }),
    'runs/n-old': run('notify', 60 * 24 * 8, { counts: { processed: 1, sent: 100 } }),
    'runs/r1': run('reminders', 2, { counts: { sent: 7, users: 7 } }),
    'runs/c1': run('cleanup', 600, { status: 'error', error: 'synthetic' }),
    [`users/${USER_A}`]: { tokens: ['fcm-secret-token-a'], notificationsEnabled: true, hasReminders: true, watchedKeys: ['Class_ZL_Actual'], watchedTypes: ['Class'] },
    [`users/${USER_B}`]: { tokens: [], notificationsEnabled: false, hasReminders: false, watchedKeys: ['Teacher_T1_Actual', 'Class_ZL_Next'], watchedTypes: ['Class', 'Teacher'] },
    'changes/Class_ZL_Actual_1': {
        timetable: { type: 'Class', id: 'ZL', name: '2.A', scheduleType: 'Actual' }, weekStart: '2026-11-02',
        changes: [{ type: 'substitution', day: 2, hour: 3, description: 'Suplování: Matematika' }, { type: 'room_change', day: 2, hour: 4, description: 'Změna učebny' }],
        timestamp: iso(9), sent: true, sentAt: iso(5), sentToUsers: 1, sentToDevices: 1,
    },
    'changes/Class_ZL_Next_2': {
        timetable: { type: 'Class', id: 'ZL', name: '2.A', scheduleType: 'Next' }, weekStart: '2026-11-09',
        changes: [{ type: 'lesson_removed', day: 0, hour: 1, description: 'Odpadla hodina' }], timestamp: iso(8), sent: false,
    },
    'changes/Class_ZK_Actual_3': {
        timetable: { type: 'Class', id: 'ZK', name: '1.A', scheduleType: 'Actual' }, weekStart: '2026-11-02',
        changes: [], timestamp: iso(30), sent: true, sentAt: iso(25), sentToUsers: 0, sentToDevices: 0,
    },
});
stubFirebase(db);

const fetchCalls = [];
let githubReply = () => new Response(JSON.stringify({ workflow_run_id: 42, run_url: 'https://api.github.com/x', html_url: 'https://github.com/hatcyk/hezci_rozvrhy/actions/runs/42' }), { status: 200 });
const fakeFetch = async (url, init) => { fetchCalls.push({ url, init }); return githubReply(); };
let clock = NOW;

const { createApp } = require('../routes');
const admin = require('../backend/admin');
const { clientIp } = require('../routes/admin');

let limiter;
let base, close;
test.before(async () => {
    console.log = () => {};
    console.error = () => {};
    limiter = new admin.AttemptLimiter({ max: 3, windowMs: 60000, lockMs: 60000 });
    ({ base, close } = await listen(createApp({ staticDir: null, adminDeps: { limiter, fetchImpl: fakeFetch, now: () => clock } })));
});
test.after(() => close());

const AUTH = { authorization: `Bearer ${SECRET}` };
const get = (p, headers = AUTH) => fetch(base + p, { headers });
const getJson = async (p) => {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    return r.json();
};
const auditDocs = () => db._docs('audit');

test('bez ADMIN_SECRET je admin API zavřené (503), i mimo produkci', async () => {
    delete process.env.ADMIN_SECRET;
    try {
        const r = await get('/api/admin/health');
        assert.equal(r.status, 503);
        assert.match((await r.json()).error, /ADMIN_SECRET/);
    } finally {
        process.env.ADMIN_SECRET = SECRET;
    }
});

test('v produkci krátké tajemství nestačí (503)', async () => {
    process.env.ADMIN_SECRET = 'short';
    process.env.NODE_ENV = 'production';
    try {
        assert.equal((await get('/api/admin/health', { authorization: 'Bearer short' })).status, 503);
    } finally {
        process.env.ADMIN_SECRET = SECRET;
        process.env.NODE_ENV = 'test';
    }
});

test('špatné tajemství 401, po limitu 429 s Retry-After; audit bez IP v čitelné podobě', async () => {
    limiter.reset('127.0.0.1');
    limiter.reset('::ffff:127.0.0.1');
    const before = auditDocs().length;
    assert.equal((await get('/api/admin/health', {})).status, 401);
    assert.equal((await get('/api/admin/health', { authorization: 'Bearer wrong' })).status, 401);
    const locked = await get('/api/admin/health', { authorization: 'Bearer wrong-again' });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
    // Locked: even the right secret waits, so guessing cannot continue.
    assert.equal((await get('/api/admin/health')).status, 429);

    const records = auditDocs().slice(before);
    assert.deepEqual(records.map(r => r.action), ['auth_failed', 'auth_locked'], 'one record per burst, not per guess');
    for (const r of records) {
        assert.match(r.ipHash, /^[0-9a-f]{16}$/);
        assert.ok(!JSON.stringify(r).includes('127.0.0.1'));
    }
    limiter.reset('127.0.0.1');
    limiter.reset('::ffff:127.0.0.1');
    assert.equal((await get('/api/admin/health')).status, 200);
});

test('AttemptLimiter: okno vyprší, zámek vyprší, úspěch vynuluje', () => {
    let t = 0;
    const l = new admin.AttemptLimiter({ max: 2, windowMs: 1000, lockMs: 5000, now: () => t });
    assert.equal(l.fail('a').first, true);
    t = 2000; // window over → counts from 1 again
    assert.equal(l.fail('a').first, true);
    const second = l.fail('a');
    assert.equal(second.locked, true);
    assert.equal(second.lockedNow, true);
    assert.equal(l.status('a').retryAfterSec, 5);
    t = 7001;
    assert.equal(l.status('a').locked, false);
    l.fail('b');
    l.reset('b');
    assert.equal(l.entries.has('b'), false);
    const small = new admin.AttemptLimiter({ maxEntries: 2, now: () => t });
    ['x', 'y', 'z'].forEach(k => small.fail(k));
    assert.ok(small.entries.size <= 2, 'memory stays bounded under many addresses');
});

test('clientIp: X-Real-IP / X-Forwarded-For jen na Vercelu, jinak adresa spojení', () => {
    const req = { headers: { 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.9' } };
    assert.equal(clientIp(req, {}), '10.0.0.9', 'spoofable headers ignored off Vercel');
    assert.equal(clientIp(req, { VERCEL: '1' }), '203.0.113.5');
    assert.equal(clientIp({ ...req, headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' } }, { TRUST_PROXY: '1' }), '198.51.100.1');
});

test('health: stáří dat, poslední běh každé úlohy, no-store', async () => {
    const r = await get('/api/admin/health');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
    const body = await r.json();
    assert.equal(body.status.isHealthy, true);
    assert.equal(body.status.dataAgeMin, 10);
    assert.equal(body.health.lastStatus, 'ok');
    assert.equal(body.lastRuns.prefetch.id, 'p1');
    assert.equal(body.lastRuns.notify.id, 'n1');
    assert.equal(body.lastRuns.reminders.id, 'r1');
    assert.equal(body.lastRuns.cleanup.status, 'error');
    assert.equal(body.indexMissing, false);
});

test('runs: filtr úlohy, limit nejvýš 100, neznámá úloha 400', async () => {
    const prefetch = await getJson('/api/admin/runs?job=prefetch');
    assert.deepEqual(prefetch.runs.map(r => r.id), ['p1', 'p2', 'p3', 'p-old']);
    const all = await getJson('/api/admin/runs?limit=3');
    assert.deepEqual(all.runs.map(r => r.id), ['r1', 'n1', 'p1']);
    assert.equal((await getJson('/api/admin/runs?limit=5000')).limit, 100);
    assert.equal((await get('/api/admin/runs?job=hack')).status, 400);
});

test('bez složeného indexu (job, startedAt) se runs dočtou náhradní cestou a hlásí indexMissing', async () => {
    db._failQuery = (q) => (q.collection === 'runs' && q.filters.some(f => f.field === 'job') && q.orders.length
        ? Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/...'), { code: 9 })
        : null);
    try {
        const body = await getJson('/api/admin/runs?job=notify');
        assert.equal(body.indexMissing, true);
        assert.deepEqual(body.runs.map(r => r.id), ['n1', 'n2', 'n-old']);
        const health = await getJson('/api/admin/health');
        assert.equal(health.indexMissing, true);
        assert.equal(health.lastRuns.prefetch.id, 'p1');
        const stats = await getJson('/api/admin/stats');
        assert.equal(stats.lastDays.changeNotifications, null);
        assert.ok(stats.problems.some(p => p.indexMissing && p.stat === 'notify'));
        assert.equal(stats.users.pushEnabled, 1, 'other statistics still work');
    } finally {
        db._failQuery = null;
    }
});

test('intervaly prefetche za 7 dní: jen prefetch, vzestupně, medián a nejdelší mezera', async () => {
    const body = await getJson('/api/admin/runs/intervals?days=7');
    assert.equal(body.days, 7);
    assert.deepEqual(body.runs.map(r => r.startedAt), [iso(70), iso(25), iso(10)]);
    assert.deepEqual(Object.keys(body.runs[0]).sort(), ['durationMs', 'startedAt', 'status', 'trigger']);
    assert.equal(body.stats.count, 2);
    assert.equal(body.stats.medianMin, 30);
    assert.equal(body.stats.maxMin, 45);
    assert.deepEqual(body.stats.longestGap, { from: iso(70), to: iso(25), minutes: 45 });
    assert.equal((await getJson('/api/admin/runs/intervals?days=99')).days, 14);
});

test('intervalStats: prázdno, jeden běh, p95', () => {
    assert.deepEqual(admin.intervalStats([]), { count: 0, medianMin: null, p95Min: null, maxMin: null, longestGap: null });
    assert.equal(admin.intervalStats([{ startedAt: iso(1) }]).count, 0);
    const runs = Array.from({ length: 21 }, (_, i) => ({ startedAt: iso(300 - i * 15 - (i === 20 ? 60 : 0)) }));
    const s = admin.intervalStats(runs);
    assert.equal(s.medianMin, 15);
    assert.equal(s.maxMin, 75);
});

test('changes: nejnovější první, stav doručení, souhrn typů', async () => {
    const body = await getJson('/api/admin/changes?limit=10');
    assert.deepEqual(body.items.map(i => [i.id, i.delivery]), [
        ['Class_ZL_Next_2', 'pending'],
        ['Class_ZL_Actual_1', 'sent'],
        ['Class_ZK_Actual_3', 'no_watchers'],
    ]);
    const sent = body.items[1];
    assert.deepEqual(sent.types, { substitution: 1, room_change: 1 });
    assert.equal(sent.changeCount, 2);
    assert.equal(sent.sentToDevices, 1);
    assert.equal(sent.preview[0].description, 'Suplování: Matematika');
});

test('stats: jen agregované počty, žádné ID uživatelů ani tokeny', async () => {
    const body = await getJson('/api/admin/stats');
    assert.equal(body.users.pushEnabled, 1);
    assert.equal(body.users.withReminders, 1);
    assert.deepEqual(body.users.watchingByType, { Class: 2, Teacher: 1, Room: 0 });
    assert.deepEqual(body.lastDays.changeNotifications, { runs: 2, total: 6 }, 'the 8-day-old run is outside');
    assert.deepEqual(body.lastDays.reminders, { runs: 1, total: 7 });
    assert.deepEqual(body.lastDays.prefetch, { runs: 3, total: 4 });
    assert.deepEqual(body.problems, []);
    const text = JSON.stringify(body);
    for (const secret of [USER_A, USER_B, 'fcm-secret-token-a']) assert.ok(!text.includes(secret), secret);
    // count() / aggregate(), not reading the user documents
    assert.ok(!db._log.some(e => e.op === 'query' && e.path === 'users'));
});

test('dispatch: bez konfigurace 503 se seznamem chybějících proměnných', async () => {
    const saved = process.env.GITHUB_DISPATCH_TOKEN;
    delete process.env.GITHUB_DISPATCH_TOKEN;
    try {
        const r = await fetch(base + '/api/admin/prefetch/dispatch', { method: 'POST', headers: AUTH });
        assert.equal(r.status, 503);
        assert.deepEqual((await r.json()).missing, ['GITHUB_DISPATCH_TOKEN']);
        assert.equal(fetchCalls.length, 0);
    } finally {
        process.env.GITHUB_DISPATCH_TOKEN = saved;
    }
});

test('dispatch: správné volání GitHub REST, nejvýš 1× za 10 min, chyba GitHubu slot vrátí', async () => {
    const post = () => fetch(base + '/api/admin/prefetch/dispatch', { method: 'POST', headers: AUTH });
    clock = new Date(NOW.getTime() + 3600000);

    const ok = await post();
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.result, 'ok');
    assert.equal(body.workflowRunId, 42);
    assert.equal(fetchCalls.length, 1);
    const { url, init } = fetchCalls[0];
    assert.equal(url, 'https://api.github.com/repos/hatcyk/hezci_rozvrhy/actions/workflows/prefetch.yml/dispatches');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer github_pat_synthetic');
    assert.equal(init.headers.Accept, 'application/vnd.github+json');
    assert.equal(init.headers['X-GitHub-Api-Version'], '2026-03-10');
    assert.deepEqual(JSON.parse(init.body), { ref: 'main' });
    assert.ok(!JSON.stringify(body).includes('github_pat'), 'token never echoed');

    clock = new Date(clock.getTime() + 9 * 60000);
    const limited = await post();
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.equal(fetchCalls.length, 1, 'GitHub not called again');

    clock = new Date(clock.getTime() + 61000);
    githubReply = () => new Response(JSON.stringify({ message: 'Workflow does not have workflow_dispatch trigger' }), { status: 422 });
    const failed = await post();
    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).githubStatus, 422);

    githubReply = () => new Response(null, { status: 204 }); // older API versions
    const retry = await post();
    assert.equal(retry.status, 200, 'the failed attempt gave the slot back');
    assert.equal(fetchCalls.length, 3);

    githubReply = () => { throw new Error('ECONNRESET (synthetic)'); };
    clock = new Date(clock.getTime() + 11 * 60000);
    assert.equal((await post()).status, 502);

    const actions = auditDocs().filter(a => a.action === 'prefetch_dispatch').map(a => a.details.result);
    assert.deepEqual(actions, ['not_configured', 'ok', 'rate_limited', 'github_error', 'ok', 'github_error']);
});

test('dispatchConfig: vlastní ref a workflow, nesmyslné repo odmítne', () => {
    const c = admin.dispatchConfig({ GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'a/b', GITHUB_DISPATCH_REF: 'dev', GITHUB_DISPATCH_WORKFLOW: 'x.yml' });
    assert.deepEqual([c.ref, c.workflow, c.missing], ['dev', 'x.yml', []]);
    assert.deepEqual(admin.dispatchConfig({ GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'a/../../b' }).missing, ['GITHUB_REPO']);
});

test('audit: každý požadavek zapsán, výpis od nejnovějšího', async () => {
    const before = auditDocs().length;
    const tick = () => { clock = new Date(clock.getTime() + 1000); };
    tick(); await getJson('/api/admin/stats');
    tick(); await getJson('/api/admin/changes');
    tick(); const body = await getJson('/api/admin/audit?limit=2');
    assert.equal(auditDocs().length, before + 3, 'stats + changes + the audit view itself');
    // The view is recorded after it was answered, so it is not in its own list.
    assert.deepEqual(body.items.map(i => i.action), ['view_changes', 'view_stats']);
    assert.equal(auditDocs().at(-1).action, 'view_audit');
    for (const item of auditDocs()) {
        assert.ok(item.at && item.action);
        assert.ok(!JSON.stringify(item).includes(SECRET));
    }
});

test('cleanupOldAudit smaže záznamy starší 90 dní', async () => {
    const local = createFakeFirestore({
        'audit/old': { at: '2026-07-01T00:00:00.000Z', action: 'view_health' },
        'audit/new': { at: '2026-10-30T00:00:00.000Z', action: 'view_health' },
    });
    const result = await admin.cleanupOldAudit(90, { db: local, now: NOW });
    assert.deepEqual(result, { deleted: 1, errors: 0 });
    assert.deepEqual(local._paths('audit'), ['audit/new']);
});

test('hashIp: stabilní pro stejné tajemství, jiné tajemství = jiný otisk', () => {
    assert.equal(admin.hashIp('203.0.113.5', 'a'), admin.hashIp('203.0.113.5', 'a'));
    assert.notEqual(admin.hashIp('203.0.113.5', 'a'), admin.hashIp('203.0.113.5', 'b'));
    assert.equal(admin.hashIp(null, 'a'), null);
});

test('firestore.indexes.json má složený index runs (job, startedAt) a firebase.json na něj odkazuje', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '..');
    const firebase = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
    assert.equal(firebase.firestore.indexes, 'firestore.indexes.json');
    const { indexes } = JSON.parse(fs.readFileSync(path.join(root, 'firestore.indexes.json'), 'utf8'));
    assert.ok(indexes.some(i => i.collectionGroup === 'runs'
        && JSON.stringify(i.fields) === JSON.stringify([{ fieldPath: 'job', order: 'ASCENDING' }, { fieldPath: 'startedAt', order: 'DESCENDING' }])));
    const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
    for (const c of ['runs', 'system', 'audit']) assert.match(rules, new RegExp(`match /${c}/\\{docId\\} \\{\\s*allow read, write: if false;`), c);
    assert.match(rules, /match \/aggregates\/\{docId\} \{\s*allow read: if signedIn\(\);/);
});
