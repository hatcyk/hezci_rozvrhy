// Operational records (contract S4): runs/{auto}, system/health, /api/status.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
// Job logs go to stdout, which the test runner shares with its own binary
// messages; keep them out (see test/auth.test.js).
console.log = () => {};
const { createFakeFirestore, stubFirebase, stubModule, listen } = require('./helpers/fake-firestore');

const db = createFakeFirestore();
stubFirebase(db);
let prefetchImpl = async () => ({ success: true, status: 'ok' });
stubModule('backend/prefetch.js', { prefetchAllData: () => prefetchImpl() });

const cron = require('../backend/cron');
const {
    getTrigger, classifyError, classifyPrefetchResult, prefetchCounts, nextHealth, recordRun,
    computeStatus, maxDataAgeMinutes, cleanupOldRuns, runPrefetchJob, failedCleanup,
} = cron;

const quiet = () => { const e = console.error, l = console.log; console.error = console.log = () => {}; return () => { console.error = e; console.log = l; }; };

test('spouštěč běhu z GITHUB_EVENT_NAME / RUN_TRIGGER / terminálu', () => {
    assert.equal(getTrigger({ GITHUB_EVENT_NAME: 'schedule' }, false), 'schedule');
    assert.equal(getTrigger({ GITHUB_EVENT_NAME: 'workflow_dispatch' }, false), 'dispatch');
    assert.equal(getTrigger({ GITHUB_EVENT_NAME: 'push' }, false), 'manual');
    assert.equal(getTrigger({ RUN_TRIGGER: 'cron', GITHUB_EVENT_NAME: 'schedule' }, false), 'cron');
    assert.equal(getTrigger({}, true), 'manual');
    assert.equal(getTrigger({}, false), 'cron');
});

test('výsledek prefetche: nový tvar se status i starý tvar jen se success/error', () => {
    assert.equal(classifyPrefetchResult({ success: true, status: 'ok' }), 'ok');
    assert.equal(classifyPrefetchResult({ success: false, status: 'guard_no_lessons' }), 'guard_no_lessons');
    assert.equal(classifyPrefetchResult({ success: true }), 'ok');
    assert.equal(classifyPrefetchResult({ success: false, error: 'No definitions fetched - check cookie validity' }), 'guard_no_definitions');
    assert.equal(classifyPrefetchResult({ success: false, error: 'No lessons parsed from Bakaláři - timetable not published' }), 'guard_no_lessons');
    assert.equal(classifyPrefetchResult({ success: false, status: 'nonsense' }), 'error');
    assert.equal(classifyPrefetchResult(null), 'error');

    assert.equal(classifyError(new Error('Bakalari login failed after 3 attempts: 500')), 'login_failed');
    assert.equal(classifyError(new Error('connect ETIMEDOUT 1.2.3.4:443')), 'network');
    assert.equal(classifyError(new Error('Cannot read properties of undefined')), 'error');

    assert.deepEqual(prefetchCounts({ success: true, totalRequests: 5, successCount: 4, duration: 9, error: 'x' }), { totalRequests: 5, successCount: 4 });
    assert.deepEqual(prefetchCounts({ stats: { writes: 3 }, totalRequests: 9 }), { writes: 3 });
});

test('system/health: lastSuccessAt se posune JEN při skutečném úspěchu', () => {
    const ok = nextHealth(null, { status: 'ok', finishedAt: '2026-11-04T08:00:00.000Z', error: null });
    assert.equal(ok.lastSuccessAt, '2026-11-04T08:00:00.000Z');
    assert.equal(ok.consecutiveFailures, 0);

    const guard = nextHealth(ok, { status: 'guard_no_definitions', finishedAt: '2026-11-04T08:15:00.000Z', error: 'No definitions' });
    assert.equal(guard.lastSuccessAt, '2026-11-04T08:00:00.000Z', 'pojistka není úspěch');
    assert.equal(guard.lastRunAt, '2026-11-04T08:15:00.000Z');
    assert.equal(guard.lastStatus, 'guard_no_definitions');
    assert.equal(guard.consecutiveFailures, 1);
    assert.equal(guard.lastError, 'No definitions');

    const again = nextHealth(guard, { status: 'network', finishedAt: '2026-11-04T08:30:00.000Z', error: 'ETIMEDOUT' });
    assert.equal(again.consecutiveFailures, 2);
    assert.equal(nextHealth(again, { status: 'ok', finishedAt: '2026-11-04T08:45:00.000Z' }).consecutiveFailures, 0);
});

test('CHYBA (opraveno): běh s pojistkou „0 definic“ dřív zapsal lastSuccess = teď', async () => {
    const restore = quiet();
    try {
        prefetchImpl = async () => ({ success: true, status: 'ok', totalRequests: 3, successCount: 3 });
        const first = await runPrefetchJob({ trigger: 'schedule' });
        assert.equal(first.run.status, 'ok');
        const successAt = db._get('system/health').lastSuccessAt;
        assert.ok(successAt);

        // Old-shape guard result (prefetch.js before S4): no `status` field.
        prefetchImpl = async () => ({ success: false, definitionsCount: 0, error: 'No definitions fetched - check cookie validity' });
        const guarded = await runPrefetchJob({ trigger: 'dispatch' });
        assert.equal(guarded.run.status, 'guard_no_definitions');
        assert.equal(db._get('system/health').lastSuccessAt, successAt);
        assert.equal(db._get('system/health').consecutiveFailures, 1);

        prefetchImpl = async () => { throw new Error('Bakalari login failed after 3 attempts: 401'); };
        const failed = await runPrefetchJob({ trigger: 'schedule' });
        assert.equal(failed.run.status, 'login_failed');
        assert.match(failed.run.error, /login failed/);
        assert.equal(db._get('system/health').consecutiveFailures, 2);

        const runs = db._docs('runs').filter(r => r.job === 'prefetch');
        assert.deepEqual(runs.map(r => r.status), ['ok', 'guard_no_definitions', 'login_failed']);
        assert.deepEqual(runs.map(r => r.trigger), ['schedule', 'dispatch', 'schedule']);
        for (const r of runs) {
            assert.equal(typeof r.durationMs, 'number');
            assert.ok(Date.parse(r.finishedAt) >= Date.parse(r.startedAt));
        }
    } finally {
        restore();
    }
});

test('záznam běhu nikdy neshodí úlohu, ani když Firestore selže', async () => {
    const restore = quiet();
    try {
        const broken = { collection: () => ({ add: async () => { throw new Error('UNAVAILABLE'); } }) };
        const run = await recordRun({ job: 'notify', startedAt: new Date(), status: 'ok' }, { db: broken });
        assert.equal(run.job, 'notify');
    } finally {
        restore();
    }
});

test('úklid smaže jen runs starší 30 dní a nahlásí selhání pomocných funkcí', async () => {
    const now = new Date('2026-11-04T10:00:00Z');
    const local = createFakeFirestore({
        'runs/a': { startedAt: '2026-10-01T10:00:00.000Z' },
        'runs/b': { startedAt: '2026-10-10T10:00:00.000Z' },
        'runs/c': { startedAt: '2026-11-04T09:00:00.000Z' },
    });
    const restore = quiet();
    try {
        assert.deepEqual(await cleanupOldRuns(30, { db: local, now }), { deleted: 1, errors: 0 });
    } finally {
        restore();
    }
    assert.deepEqual(local._paths('runs').sort(), ['runs/b', 'runs/c']);

    assert.deepEqual(failedCleanup([{ deleted: 1, errors: 0 }]), {});
    assert.equal(failedCleanup([{ deleted: 0, errors: 1, error: 'index missing' }]).status, 'error');
});

test('stáří dat: ve školní den 6–18 h pražského času limit 120 min, jinak 12 h', () => {
    // Wednesday 2026-11-04, CET (UTC+1)
    assert.equal(maxDataAgeMinutes(new Date('2026-11-04T09:00:00Z')), 120);   // 10:00
    assert.equal(maxDataAgeMinutes(new Date('2026-11-04T04:30:00Z')), 720);   // 5:30
    assert.equal(maxDataAgeMinutes(new Date('2026-11-04T17:00:00Z')), 720);   // 18:00
    assert.equal(maxDataAgeMinutes(new Date('2026-11-07T09:00:00Z')), 720);   // Saturday

    const now = new Date('2026-11-04T09:00:00Z');
    const at = (minAgo) => new Date(now.getTime() - minAgo * 60000).toISOString();

    const fresh = computeStatus({ lastSuccessAt: at(60), lastStatus: 'ok' }, now);
    assert.equal(fresh.isHealthy, true);
    assert.equal(fresh.dataAgeMin, 60);
    assert.equal(fresh.lastSuccessAt, at(60));

    const stale = computeStatus({ lastSuccessAt: at(130), lastStatus: 'network', lastError: 'ETIMEDOUT', consecutiveFailures: 5 }, now);
    assert.equal(stale.isHealthy, false);
    assert.equal(stale.consecutiveFailures, 5);
    assert.equal(stale.lastError, 'ETIMEDOUT');

    // The same 130 min on a Saturday morning is fine.
    const saturday = new Date('2026-11-07T09:00:00Z');
    assert.equal(computeStatus({ lastSuccessAt: new Date(saturday.getTime() - 130 * 60000).toISOString() }, saturday).isHealthy, true);

    const never = computeStatus(null, now);
    assert.equal(never.isHealthy, false);
    assert.equal(never.dataAgeMin, null);

    // Until the first S4 run only the legacy system/prefetchStatus exists.
    const legacy = computeStatus(null, now, { isHealthy: true, lastSuccess: at(30), lastRun: at(30) });
    assert.equal(legacy.isHealthy, true);
    assert.equal(legacy.dataAgeMin, 30);
});

test('/api/status: klient dostane 200 i se zastaralými daty, monitor s ?strict=1 dostane 503', async () => {
    db._store.set('system/health', { lastSuccessAt: new Date(Date.now() - 13 * 3600 * 1000).toISOString(), lastStatus: 'network' });
    const app = express();
    app.use('/api', require('../routes/status'));
    const { base, close } = await listen(app);
    try {
        const plain = await fetch(base + '/api/status');
        assert.equal(plain.status, 200);
        assert.equal(plain.headers.get('cache-control'), 'no-store');
        const body = await plain.json();
        assert.equal(body.isHealthy, false);
        assert.ok(body.dataAgeMin >= 13 * 60);

        assert.equal((await fetch(base + '/api/status?strict=1')).status, 503);

        db._store.set('system/health', { lastSuccessAt: new Date(Date.now() - 5 * 60000).toISOString(), lastStatus: 'ok' });
        const healthy = await fetch(base + '/api/status?strict=1');
        assert.equal(healthy.status, 200);
        assert.equal((await healthy.json()).isHealthy, true);
    } finally {
        await close();
    }
});
