// Debug API (/api/debug/*): it lists every user with their FCM tokens and
// pushes any text to every device, without a login. Reachable only with
// DEBUG=true, outside production (never on Vercel, Preview included) and from
// this machine; otherwise the ordinary 404, as if it did not exist.
// Firebase is the in-memory fake, nothing leaves 127.0.0.1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeFirestore, stubFirebase, listen } = require('./helpers/fake-firestore');

process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
// Loaded with DEBUG=true as on the deployment from the review; every test
// sets the variables it is about (the gate reads them on each request).
process.env.DEBUG = 'true';
delete process.env.CRON_SECRET;

const VICTIM = 'anon-0b7f6c1e-8a1d-4c3b-9f2e-1a2b3c4d5e6f';
const db = createFakeFirestore({
    [`users/${VICTIM}`]: {
        tokens: ['fcm-victim'], notificationsEnabled: true,
        preferences: { watchedTimetables: [{ type: 'Class', id: 'C2A', scheduleType: 'Actual', name: '2.A' }] },
        watchedKeys: ['Class_C2A_Actual'], watchedTypes: ['Class'], hasReminders: false,
    },
});
const { sent } = stubFirebase(db);

const { createApp, listenHost } = require('../routes');
const { isDebugAllowed } = require('../routes/debug');

let base, close;
test.before(async () => {
    console.log = () => {};   // route logs would mix with the runner's stdout
    ({ base, close } = await listen(createApp({ staticDir: null })));
});
test.after(() => close());

/** Run fn with these environment variables, then put the old values back. */
async function withEnv(vars, fn) {
    const old = {};
    for (const [k, v] of Object.entries(vars)) {
        old[k] = process.env[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    try { return await fn(); } finally {
        for (const [k, v] of Object.entries(old)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    }
}

const ROUTES = [
    ['GET', '/api/debug/status'],
    ['GET', '/api/debug/users'],
    ['GET', '/api/debug/pending-changes'],
    ['POST', '/api/debug/test-notification-all'],
    ['POST', '/api/debug/simulate-change', { timetableType: 'Class', timetableId: 'C2A', scheduleType: 'Actual', timetableName: 'Výuka zrušena, přihlaste se na evil.example' }],
];
const call = (method, p, body) => fetch(base + p, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
});

/** The answer for a path that does not exist at all, with the path blanked out. */
async function notFoundShape(method, p) {
    const r = await call(method, p);
    return { status: r.status, type: r.headers.get('content-type'), body: (await r.text()).replace(p, '<path>') };
}

async function assertHidden(label) {
    const before = sent.length;
    for (const [method, p, body] of ROUTES) {
        const r = await call(method, p, body);
        const text = await r.text();
        assert.equal(r.status, 404, `${label}: ${method} ${p}`);
        assert.doesNotMatch(text.replace(p, '<path>'), /fcm-victim|debug/i, `${label}: ${method} ${p} must not reveal anything`);
        const unknown = await notFoundShape(method, `/api/no-such-route-${p.length}`);
        assert.deepEqual(
            { status: r.status, type: r.headers.get('content-type'), body: text.replace(p, '<path>') },
            unknown,
            `${label}: ${method} ${p} answers exactly like a path that does not exist`,
        );
    }
    assert.equal(sent.length, before, `${label}: no push was sent`);
}

test('ladění vypnuté (bez DEBUG): všechny /api/debug/* včetně /status jsou 404', async () => {
    await withEnv({ DEBUG: undefined }, () => assertHidden('DEBUG unset'));
    await withEnv({ DEBUG: 'false' }, () => assertHidden('DEBUG=false'));
});

test('DEBUG=true na Vercelu (Production i Preview mají VERCEL=1): 404, žádné tokeny ani push', async () => {
    await withEnv({ DEBUG: 'true', VERCEL: '1' }, () => assertHidden('VERCEL=1'));
    await withEnv({ DEBUG: 'true', VERCEL: 'true' }, () => assertHidden('VERCEL=true'));
});

test('DEBUG=true s NODE_ENV=production (Docker, systemd): 404', async () => {
    await withEnv({ DEBUG: 'true', NODE_ENV: 'production' }, () => assertHidden('NODE_ENV=production'));
});

test('DEBUG=true lokálně z 127.0.0.1: ladění funguje', async () => {
    await withEnv({ DEBUG: 'true' }, async () => {
        const status = await call('GET', '/api/debug/status');
        assert.equal(status.status, 200);
        assert.equal((await status.json()).debugMode, true);

        const users = await call('GET', '/api/debug/users');
        assert.equal(users.status, 200);
        assert.deepEqual((await users.json()).users[0].tokens, ['fcm-victim']);
    });
});

test('brána ladění: jen adresa soketu z loopbacku, X-Forwarded-For se nebere v potaz', async () => {
    const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });
    await withEnv({ DEBUG: 'true' }, () => {
        for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isDebugAllowed(req(a)), true, a);
        for (const a of ['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', 'fe80::1', '172.17.0.1', undefined]) {
            assert.equal(isDebugAllowed(req(a)), false, String(a));
        }
        const spoofed = req('192.168.1.20', { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' });
        assert.equal(isDebugAllowed(spoofed), false, 'client controlled headers do not count');
        assert.equal(isDebugAllowed({ headers: {} }), false, 'no socket → closed');
    });
    await withEnv({ DEBUG: 'true', VERCEL: '1' }, () => assert.equal(isDebugAllowed(req('127.0.0.1')), false));
    await withEnv({ DEBUG: undefined }, () => assert.equal(isDebugAllowed(req('127.0.0.1')), false));
});

test('server poslouchá ve výchozím stavu jen na 127.0.0.1, LAN až s HOST=0.0.0.0', () => {
    assert.equal(listenHost({}), '127.0.0.1');
    assert.equal(listenHost({ HOST: '' }), '127.0.0.1');
    assert.equal(listenHost({ HOST: '0.0.0.0' }), '0.0.0.0');
    assert.equal(listenHost({ HOST: ' 0.0.0.0 ' }), '0.0.0.0');
    // On Vercel the platform runs the server: keep listening as before.
    assert.equal(listenHost({ VERCEL: '1' }), '0.0.0.0');

    // index.js must use it (not a hard-coded address).
    const ROOT = path.join(__dirname, '..');
    const index = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    assert.match(index, /listenHost\(\)/);
    assert.doesNotMatch(index, /HOST\s*=\s*['"]0\.0\.0\.0['"]/);
});

test('kontejner a služba systemd dál poslouchají na všech rozhraních (HOST=0.0.0.0)', () => {
    const ROOT = path.join(__dirname, '..');
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    // Docker publishes the port from outside the container: 127.0.0.1 inside
    // would make it unreachable.
    assert.match(read('Dockerfile'), /^ENV HOST=0\.0\.0\.0$/m);
    assert.match(read('docker-compose.yml'), /^\s+HOST: ["']?0\.0\.0\.0["']?$/m);
    assert.match(read('deploy/lepsi-rozvrh.service'), /^Environment=HOST=0\.0\.0\.0$/m);
});
