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
    const req = (remoteAddress, headers = { host: '127.0.0.1:3000' }) => ({ method: 'GET', socket: { remoteAddress }, headers });
    await withEnv({ DEBUG: 'true' }, () => {
        for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isDebugAllowed(req(a)), true, a);
        for (const a of ['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', 'fe80::1', '172.17.0.1', undefined]) {
            assert.equal(isDebugAllowed(req(a)), false, String(a));
        }
        const spoofed = req('192.168.1.20', { host: 'localhost:3000', 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' });
        assert.equal(isDebugAllowed(spoofed), false, 'client controlled headers do not count');
        assert.equal(isDebugAllowed({ method: 'GET', headers: {} }), false, 'no socket → closed');
    });
    await withEnv({ DEBUG: 'true', VERCEL: '1' }, () => assert.equal(isDebugAllowed(req('127.0.0.1')), false));
    await withEnv({ DEBUG: undefined }, () => assert.equal(isDebugAllowed(req('127.0.0.1')), false));
});

test('brána ladění: Host jen localhost / 127.0.0.1 / [::1] a žádné přeposílací hlavičky (tunel, DNS rebinding)', async () => {
    const req = (headers) => ({ method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers });
    await withEnv({ DEBUG: 'true' }, () => {
        for (const host of ['localhost', 'localhost:3000', '127.0.0.1', '127.0.0.1:3000', '[::1]', '[::1]:3000', 'LOCALHOST:3000']) {
            assert.equal(isDebugAllowed(req({ host })), true, host);
        }
        for (const host of ['abcd-1234.ngrok-free.app', 'rebind.attacker.example:3000', 'localhost.attacker.example',
            '127.0.0.1.nip.io', 'localhost:3000@evil', '192.168.1.20:3000', '[::1].evil', '', undefined]) {
            assert.equal(isDebugAllowed(req({ host })), false, String(host));
        }
        // a tunnel that rewrites Host to localhost still adds its forwarding headers
        for (const h of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'via', 'cf-connecting-ip']) {
            assert.equal(isDebugAllowed(req({ host: 'localhost:3000', [h]: '198.51.100.9' })), false, h);
        }
    });
});

test('brána ladění přes HTTP: požadavek z 127.0.0.1 s cizím Host nebo z tunelu je 404, s Host localhost projde', async () => {
    const http = require('node:http');
    const { port } = new URL(base);
    const get = (headers) => new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, path: '/api/debug/users', headers }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        r.on('error', reject);
        r.end();
    });
    await withEnv({ DEBUG: 'true' }, async () => {
        const tunnel = await get({ Host: 'abcd-1234.ngrok-free.app', 'X-Forwarded-For': '198.51.100.9', 'X-Forwarded-Host': 'abcd-1234.ngrok-free.app' });
        assert.equal(tunnel.status, 404);
        assert.doesNotMatch(tunnel.body, /fcm-victim/);
        assert.equal((await get({ Host: `rebind.attacker.example:${port}` })).status, 404, 'DNS rebinding');
        assert.equal((await get({ Host: `localhost:${port}`, 'X-Forwarded-For': '198.51.100.9' })).status, 404, 'tunnel with Host rewritten');
        const local = await get({ Host: `localhost:${port}` });
        assert.equal(local.status, 200);
        assert.match(local.body, /fcm-victim/);
    });
});

// ---- CSRF: a page the developer visits posts to http://127.0.0.1:3000 ------------
// Host and socket are then loopback, so the browser's own headers decide.
function rawRequest(method, p, headers, body) {
    const http = require('node:http');
    const { port } = new URL(base);
    return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, method, path: p,
            headers: { Host: `localhost:${port}`, ...headers, ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}) } }, (res) => {
            let text = '';
            res.on('data', (c) => { text += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: text }));
        });
        r.on('error', reject);
        if (body !== undefined) r.write(body);
        r.end();
    });
}
const CHANGE = JSON.stringify({ timetableType: 'Class', timetableId: 'C2A', scheduleType: 'Actual', timetableName: 'CSRF' });

test('brána ladění: cizí Origin a Sec-Fetch-Site jiný než same-origin/none se odmítnou', async () => {
    const req = (headers) => ({ method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:3000', ...headers } });
    await withEnv({ DEBUG: 'true' }, () => {
        for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://localhost', 'http://LOCALHOST:3000']) {
            assert.equal(isDebugAllowed(req({ origin })), true, origin);
        }
        for (const origin of ['https://evil.example', 'null', 'http://localhost.evil.example', 'http://127.0.0.1.nip.io:3000', 'file://', 'http://localhost:3000/x', '']) {
            assert.equal(isDebugAllowed(req({ origin })), false, origin);
        }
        for (const site of ['same-origin', 'none']) assert.equal(isDebugAllowed(req({ 'sec-fetch-site': site })), true, site);
        for (const site of ['cross-site', 'same-site', 'bogus']) assert.equal(isDebugAllowed(req({ 'sec-fetch-site': site })), false, site);
    });
});

test('brána ladění: měnící akce jen POST s Content-Type application/json; formulář ani text/plain cizí stránky nic nepošle', async () => {
    await withEnv({ DEBUG: 'true' }, async () => {
        const before = sent.length;
        // "simple" requests a foreign page can send without a CORS preflight
        const simple = [
            ['text/plain', CHANGE],
            ['application/x-www-form-urlencoded', 'timetableType=Class&timetableId=C2A&scheduleType=Actual&timetableName=CSRF'],
            ['multipart/form-data; boundary=x', '--x\r\nContent-Disposition: form-data; name="a"\r\n\r\nb\r\n--x--\r\n'],
        ];
        for (const [type, body] of simple) {
            for (const p of ['/api/debug/simulate-change', '/api/debug/test-notification-all']) {
                const r = await rawRequest('POST', p, { 'Content-Type': type }, body);
                assert.equal(r.status, 404, `${p} ${type}`);
            }
        }
        assert.equal((await rawRequest('POST', '/api/debug/test-notification-all', {})).status, 404, 'no body, no type');
        // JSON from a foreign page (would need a preflight, but the gate must not rely on CORS alone)
        assert.equal((await rawRequest('POST', '/api/debug/simulate-change', { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, CHANGE)).status, 404);
        assert.equal((await rawRequest('POST', '/api/debug/simulate-change', { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, CHANGE)).status, 404);
        // sending reminders by a plain GET (an <img> on a foreign page) is gone
        assert.equal((await rawRequest('GET', '/api/debug/test-lesson-reminder?dryRun=1', {})).status, 404);
        for (const p of ['/api/debug/clear-changes', '/api/debug/clear-lesson-notifications']) {
            assert.equal((await rawRequest('DELETE', p, {})).status, 404, `${p} without JSON`);
        }
        assert.equal(sent.length, before, 'no push was sent');
    });
});

test('vlastní ladicí panel aplikace (stejný původ) funguje dál, jak ho volá notifications-modal.js', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'notifications-modal.js'), 'utf8');
    // The panel posts JSON to simulate-change and reads /status with a plain GET.
    assert.match(client, /fetch\('\/api\/debug\/simulate-change', \{\s*method: 'POST',\s*headers: \{ 'Content-Type': 'application\/json' \}/);
    assert.match(client, /fetch\('\/api\/debug\/status'\)/);

    const { port } = new URL(base);
    // What Chrome sends from http://localhost:3000 for those two calls.
    const sameOrigin = { Origin: `http://localhost:${port}`, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' };
    await withEnv({ DEBUG: 'true' }, async () => {
        const status = await rawRequest('GET', '/api/debug/status', { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' });
        assert.equal(status.status, 200);
        assert.equal(JSON.parse(status.body).debugMode, true);
        const before = sent.length;
        const change = await rawRequest('POST', '/api/debug/simulate-change', { ...sameOrigin, 'Content-Type': 'application/json' }, CHANGE);
        assert.equal(change.status, 200);
        assert.ok(sent.length > before, 'the simulated change was sent');
        // curl from the terminal (no Origin, no Sec-Fetch-*) works too, with JSON
        const reminder = await rawRequest('POST', '/api/debug/test-lesson-reminder', { 'Content-Type': 'application/json' }, JSON.stringify({ dryRun: true }));
        assert.equal(reminder.status, 200);
    });
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

test('vlastní server za nginx: kontejner na všech rozhraních, služba systemd jen lokálně, obě s TRUST_PROXY=1', () => {
    const ROOT = path.join(__dirname, '..');
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    // Docker publishes the port from outside the container: 127.0.0.1 inside
    // would make it unreachable. Who reaches it decides `ports` (localhost only).
    assert.match(read('Dockerfile'), /^ENV HOST=0\.0\.0\.0$/m);
    const compose = read('docker-compose.yml');
    assert.match(compose, /^\s+HOST: ["']?0\.0\.0\.0["']?$/m);
    assert.match(compose, /^\s+- "127\.0\.0\.1:3000:3000"$/m, 'the port is not exposed past the proxy');
    assert.match(compose, /^\s+TRUST_PROXY: ["']1["']$/m);
    // systemd: nginx on the same machine, so the port is not reachable around it
    // (with TRUST_PROXY=1 a reachable port would let anybody pick their IP).
    const unit = read('deploy/lepsi-rozvrh.service');
    assert.match(unit, /^Environment=HOST=127\.0\.0\.1$/m);
    assert.match(unit, /^Environment=TRUST_PROXY=1$/m);
    // nginx sets both headers to the address it sees; the client's own values never pass.
    const nginx = read('deploy/nginx.conf.example');
    assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
    assert.match(nginx, /^\s+proxy_set_header X-Real-IP\s+\$remote_addr;$/m);
    assert.match(nginx, /^\s+proxy_set_header X-Forwarded-For\s+\$remote_addr;$/m);
    assert.doesNotMatch(nginx, /\$proxy_add_x_forwarded_for/);
});

test('za nginx podle vzoru si klient IP nepodvrhne (X-Real-IP i X-Forwarded-For přepíše proxy)', () => {
    const { clientIp } = require('../routes/admin');
    // What the app gets from deploy/nginx.conf.example for a client at 203.0.113.7
    // that sent X-Real-IP: 1.2.3.4 and X-Forwarded-For: 1.2.3.4 itself.
    const fromNginx = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7' } };
    assert.equal(clientIp(fromNginx, { TRUST_PROXY: '1' }), '203.0.113.7');
    // Without TRUST_PROXY (a port exposed directly) the headers are ignored.
    const direct = { socket: { remoteAddress: '198.51.100.9' }, headers: { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '1.2.3.4' } };
    assert.equal(clientIp(direct, {}), '198.51.100.9');
});
