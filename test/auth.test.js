// Identity and authorization (contract S1): /api/auth, requireUser, cron guard.
// Firebase is replaced by an in-memory fake (test/helpers/fake-firestore.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createFakeFirestore, stubFirebase, listen } = require('./helpers/fake-firestore');

const LEGACY = 'anonymous-1733212345678';
const db = createFakeFirestore({
    [`users/${LEGACY}`]: { tokens: ['fcm-1'], preferences: { watchedTimetables: [{ type: 'Class', id: 'ZL', scheduleType: 'Actual' }] } },
});
let signFails = false; // one test simulates a failing token signature
stubFirebase(db, {
    createCustomToken: async (uid) => {
        if (signFails) throw new Error('signBlob unavailable (synthetic)');
        return `custom:${uid}`;
    },
});

const {
    isValidUserId, isLegacyUserId, newUserId, safeEqual, createRequireUser, verifyCronRequest,
} = require('../backend/auth-middleware');

const A = 'anon-0b7f6c1e-8a1d-4c3b-9f2e-1a2b3c4d5e6f';
const B = 'anon-1c8e7d2f-9b2e-4d4c-8a3f-2b3c4d5e6f70';

let base, close;
test.before(async () => {
    // Route logs go to stdout, which the test runner also uses for its own
    // (binary) messages; with coverage on, a log line can break that stream
    // ("Unable to deserialize cloned data"). Keep the tests silent.
    console.log = () => {};
    const app = express();
    app.use(express.json({ limit: '50kb' }));
    app.use('/api', require('../routes/auth'));
    const requireUser = createRequireUser();
    app.get('/probe/:userId', requireUser, (req, res) => res.json({ uid: req.uid }));
    app.post('/probe', requireUser, (req, res) => res.json({ uid: req.uid }));
    ({ base, close } = await listen(app));
});
test.after(() => close());

const postJson = (p, body, headers = {}) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
});
const bearer = (uid) => ({ authorization: `Bearer valid:${uid}` });

test('formát userId: jen anon-<uuid v4>, starý anonymous-<ms> se pozná zvlášť', () => {
    assert.equal(isValidUserId(A), true);
    assert.equal(isValidUserId(newUserId()), true);
    assert.equal(isValidUserId('anon-not-a-uuid'), false);
    assert.equal(isValidUserId('anon-0b7f6c1e-8a1d-1c3b-9f2e-1a2b3c4d5e6f'), false, 'UUID v1 není v4');
    assert.equal(isValidUserId(LEGACY), false);
    assert.equal(isValidUserId('admin'), false);
    assert.equal(isValidUserId(undefined), false);
    assert.equal(isLegacyUserId(LEGACY), true);
    assert.equal(isLegacyUserId('anonymous-abc'), false);
    assert.notEqual(newUserId(), newUserId());
});

test('/api/auth bez userId vytvoří nové anon-<uuid> a vrátí na něj token', async () => {
    const r = await postJson('/api/auth', {});
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(isValidUserId(body.userId), true);
    assert.equal(body.token, `custom:${body.userId}`);
    assert.equal(body.migratedFrom, undefined);
});

test('/api/auth s anon-<uuid> a ID tokenem téže identity vrátí token pro ni', async () => {
    const body = await (await postJson('/api/auth', { userId: A }, bearer(A))).json();
    assert.deepEqual(body, { token: `custom:${A}`, userId: A });
});

test('/api/auth: samotná znalost cizího anon-<uuid> nestačí, volající dostane novou prázdnou identitu', async () => {
    for (const headers of [{}, bearer(B), { authorization: 'Bearer forged' }, { authorization: 'Basic x' }]) {
        const body = await (await postJson('/api/auth', { userId: A }, headers)).json();
        assert.notEqual(body.userId, A);
        assert.equal(isValidUserId(body.userId), true);
        assert.equal(body.token, `custom:${body.userId}`);
    }
});

test('/api/auth už nepodepíše libovolné uid z těla (dřív šlo vyrobit token třeba pro „admin“)', async () => {
    for (const userId of ['admin', 'anon-x', 'users/../x', 42, { a: 1 }]) {
        const body = await (await postJson('/api/auth', { userId })).json();
        assert.notEqual(body.userId, userId);
        assert.equal(isValidUserId(body.userId), true);
    }
});

test('/api/auth: uhodnutý starý anonymous-<ms> bez přihlášení jeho majitele nic nepřevede', async () => {
    for (const headers of [{}, bearer(A), { authorization: 'Bearer forged' }]) {
        const body = await (await postJson('/api/auth', { userId: LEGACY }, headers)).json();
        assert.equal(body.migratedFrom, undefined);
        assert.equal(isValidUserId(body.userId), true);
        assert.equal(db._get(`users/${body.userId}`), undefined, 'nová identita je prázdná');
    }
    assert.deepEqual(db._get(`users/${LEGACY}`).tokens, ['fcm-1'], 'starý dokument zůstal netknutý');
});

test('/api/auth převede starý anonymous-<ms> s ID tokenem jeho relace: nastavení se přesune pod nové ID, tokeny zařízení ne', async () => {
    const r = await postJson('/api/auth', { userId: LEGACY }, bearer(LEGACY));
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.migratedFrom, LEGACY);
    assert.equal(isValidUserId(body.userId), true);
    assert.equal(body.token, `custom:${body.userId}`);

    assert.equal(db._get(`users/${LEGACY}`), undefined, 'starý dokument je smazaný');
    const moved = db._get(`users/${body.userId}`);
    assert.equal(moved.preferences.watchedTimetables[0].id, 'ZL');
    assert.equal(moved.migratedFrom, LEGACY);
    // Device tokens stay behind: whoever holds a session of the old ID gets the
    // settings, not somebody's phone. The owner's browser registers its token
    // again (notificationsEnabled says it should).
    assert.deepEqual(moved.tokens, []);
    assert.equal(moved.notificationsEnabled, true);
    assert.equal(db._get(`userMigrations/${LEGACY}`).migratedTo, body.userId);
});

test('/api/auth: opakovaná migrace téže relace (ztracená odpověď) vrátí totéž nové ID, žádné osiřelé nastavení', async () => {
    const OLD = 'anonymous-1733299999001';
    db._store.set(`users/${OLD}`, { tokens: ['fcm-9'], preferences: { watchedTimetables: [{ type: 'Class', id: 'ZK', scheduleType: 'Actual' }] } });
    const session = { authorization: `Bearer valid:${OLD}#1762500000` };

    const first = await (await postJson('/api/auth', { userId: OLD }, session)).json();
    // The response got lost: the browser still has the old ID and its 1.x session, and asks again.
    const again = await (await postJson('/api/auth', { userId: OLD }, session)).json();
    const third = await (await postJson('/api/auth', { userId: OLD }, session)).json();

    assert.equal(again.userId, first.userId, 'used to be a new, empty identity');
    assert.equal(third.userId, first.userId);
    assert.equal(again.migratedFrom, OLD);
    assert.equal(again.token, `custom:${first.userId}`);
    assert.equal(db._get(`users/${first.userId}`).preferences.watchedTimetables[0].id, 'ZK');
    assert.equal(db._paths('users').filter(p => db._get(p).migratedFrom === OLD).length, 1);
});

test('/api/auth: chyba při podpisu tokenu po migraci → 500, další pokus dostane převedené nastavení', async () => {
    const OLD = 'anonymous-1733299999002';
    db._store.set(`users/${OLD}`, { tokens: [], preferences: { watchedTimetables: [{ type: 'Room', id: 'R7', scheduleType: 'Actual' }] } });
    const origError = console.error;
    console.error = () => {};
    signFails = true;
    try {
        assert.equal((await postJson('/api/auth', { userId: OLD }, bearer(OLD))).status, 500);
    } finally {
        signFails = false;
        console.error = origError;
    }
    const body = await (await postJson('/api/auth', { userId: OLD }, bearer(OLD))).json();
    assert.equal(body.migratedFrom, OLD);
    assert.equal(db._get(`users/${body.userId}`).preferences.watchedTimetables[0].id, 'R7');
    assert.equal(db._get(`users/${body.userId}`).notificationsEnabled, false, 'no token before → still off');
});

test('/api/auth: jiná relace téhož starého ID po migraci nedostane převedenou identitu (jen novou prázdnou)', async () => {
    const OLD = 'anonymous-1733299999003';
    db._store.set(`users/${OLD}`, { tokens: ['fcm-3'], preferences: { watchedTimetables: [] } });
    const owner = await (await postJson('/api/auth', { userId: OLD }, { authorization: `Bearer valid:${OLD}#1762500100` })).json();

    // A second Firebase session for the legacy uid (e.g. obtained from the 1.x
    // endpoint that signed any ID) signed in at another time.
    const other = await (await postJson('/api/auth', { userId: OLD }, { authorization: `Bearer valid:${OLD}#1762400000` })).json();
    assert.notEqual(other.userId, owner.userId);
    assert.equal(isValidUserId(other.userId), true);
    assert.equal(db._get(`users/${other.userId}`), undefined, 'nová identita je prázdná');
    assert.equal(db._get(`userMigrations/${OLD}`).migratedTo, owner.userId, 'záznam o migraci se nepřepíše');
    // and still nothing without the ID token of the legacy identity
    for (const headers of [{}, bearer(A), { authorization: 'Bearer forged' }]) {
        const body = await (await postJson('/api/auth', { userId: OLD }, headers)).json();
        assert.notEqual(body.userId, owner.userId);
        assert.equal(body.migratedFrom, undefined);
    }
});

test('/api/auth: starý uživatel bez uloženého nastavení dostane při opakování stejné ID', async () => {
    const OLD = 'anonymous-1733299999004';
    const first = await (await postJson('/api/auth', { userId: OLD }, bearer(OLD))).json();
    const again = await (await postJson('/api/auth', { userId: OLD }, bearer(OLD))).json();
    assert.equal(first.migratedFrom, OLD);
    assert.equal(again.userId, first.userId);
    assert.equal(db._get(`users/${first.userId}`), undefined, 'nic se nezakládá');
});

// ---- limit on new identities (security review, point 3) --------------------
// Behind a proxy the client address comes from X-Real-IP (TRUST_PROXY=1, as
// on Vercel), so every test uses its own documentation addresses.
const fromIp = (ip, headers = {}) => ({ 'x-real-ip': ip, ...headers });
async function withTrustProxy(fn) {
    process.env.TRUST_PROXY = '1';
    try { return await fn(); } finally { delete process.env.TRUST_PROXY; }
}
async function createIdentities(ip, n) {
    for (let i = 0; i < n; i++) {
        const r = await postJson('/api/auth', {}, fromIp(ip));
        assert.equal(r.status, 200, `identity ${i + 1} from ${ip}`);
    }
}

test('/api/auth: nejvýš 60 nových identit z jedné adresy za 10 min, pak 429 s Retry-After a českou hláškou', async () => {
    await withTrustProxy(async () => {
        await createIdentities('198.51.100.7', 60);
        const r = await postJson('/api/auth', {}, fromIp('198.51.100.7'));
        assert.equal(r.status, 429);
        const retry = Number(r.headers.get('retry-after'));
        assert.ok(retry > 0 && retry <= 600, `Retry-After ${retry}`);
        const body = await r.json();
        assert.match(body.error, /Příliš mnoho nových přihlášení/);
        assert.equal(body.token, undefined);
        assert.equal(body.userId, undefined);

        // Another address is not affected.
        assert.equal((await postJson('/api/auth', {}, fromIp('203.0.113.9'))).status, 200);
    });
});

test('/api/auth: obnova vlastní relace a migrace s důkazem se do limitu nepočítají, cizí „důkaz“ ano', async () => {
    await withTrustProxy(async () => {
        const ip = '198.51.100.8';
        await createIdentities(ip, 60);

        const own = await postJson('/api/auth', { userId: A }, fromIp(ip, bearer(A)));
        assert.equal(own.status, 200);
        assert.equal((await own.json()).userId, A);

        const OLD = 'anonymous-1733299999005';
        const migrated = await postJson('/api/auth', { userId: OLD }, fromIp(ip, bearer(OLD)));
        assert.equal(migrated.status, 200);
        assert.equal((await migrated.json()).migratedFrom, OLD);

        // Knowing an ID without its session means a new identity: counted.
        assert.equal((await postJson('/api/auth', { userId: A }, fromIp(ip, bearer(B)))).status, 429);
        assert.equal((await postJson('/api/auth', { userId: A }, fromIp(ip))).status, 429);
    });
});

test('/api/auth: IPv6 se počítá po prefixu /64 (jinak by stačilo měnit adresu)', async () => {
    await withTrustProxy(async () => {
        await createIdentities('2001:db8:aa:bb::1', 60);
        assert.equal((await postJson('/api/auth', {}, fromIp('2001:db8:aa:bb:ffff:1:2:3'))).status, 429, 'same /64');
        assert.equal((await postJson('/api/auth', {}, fromIp('2001:DB8:AA:BB:0::9'))).status, 429, 'same /64, other spelling');
        assert.equal((await postJson('/api/auth', {}, fromIp('2001:db8:aa:cc::1'))).status, 200, 'other /64');
    });
});

test('limit nových identit: AUTH_NEW_ID_LIMIT, výchozí 60', () => {
    const { newIdentityLimit } = require('../routes/auth');
    assert.equal(newIdentityLimit({}), 60);
    assert.equal(newIdentityLimit({ AUTH_NEW_ID_LIMIT: '200' }), 200);
    for (const bad of ['', '0', '-5', '2.5', 'abc']) assert.equal(newIdentityLimit({ AUTH_NEW_ID_LIMIT: bad }), 60, bad);
});

test('rateLimitKey: IPv4 celá adresa, IPv6 prefix /64, IPv4 v IPv6 jako IPv4', () => {
    const { rateLimitKey } = require('../routes/admin');
    assert.equal(rateLimitKey('203.0.113.5'), '203.0.113.5');
    assert.equal(rateLimitKey('::ffff:203.0.113.5'), '203.0.113.5');
    assert.equal(rateLimitKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
    assert.equal(rateLimitKey('2001:DB8:1:2::abcd'), '2001:db8:1:2::/64');
    assert.equal(rateLimitKey('2001:0db8:0001:0002::'), '2001:db8:1:2::/64');
    assert.equal(rateLimitKey('2001:db8::1'), '2001:db8:0:0::/64');
    assert.equal(rateLimitKey('fe80::1%en0'), 'fe80:0:0:0::/64');
    assert.equal(rateLimitKey('::1'), '0:0:0:0::/64');
    assert.equal(rateLimitKey('unknown'), 'unknown');
    assert.equal(rateLimitKey(undefined), 'unknown');
});

test('requireUser: bez tokenu 401, s neplatným tokenem 401', async () => {
    assert.equal((await fetch(`${base}/probe/${A}`)).status, 401);
    assert.equal((await fetch(`${base}/probe/${A}`, { headers: { authorization: 'Bearer forged' } })).status, 401);
    assert.equal((await fetch(`${base}/probe/${A}`, { headers: { authorization: `Basic valid:${A}` } })).status, 401);
});

test('requireUser: cizí userId v cestě nebo v těle 403, vlastní projde', async () => {
    assert.equal((await fetch(`${base}/probe/${B}`, { headers: bearer(A) })).status, 403);
    assert.equal((await postJson('/probe', { userId: B }, bearer(A))).status, 403);

    const ok = await fetch(`${base}/probe/${A}`, { headers: bearer(A) });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { uid: A });
    assert.equal((await postJson('/probe', { userId: A }, bearer(A))).status, 200);
});

test('requireUser: userId ve špatném formátu 400 (i starý anonymous-<ms>)', async () => {
    assert.equal((await fetch(`${base}/probe/${LEGACY}`, { headers: bearer(LEGACY) })).status, 400);
    assert.equal((await postJson('/probe', { userId: 'x' }, bearer(A))).status, 400);
});

test('safeEqual porovná tajemství bez ohledu na délku a typ', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual(undefined, 'abc'), false);
});

test('verifyCronRequest: v produkci bez CRON_SECRET 503, se špatným 401, se správným projde', () => {
    const KEYS = ['NODE_ENV', 'VERCEL', 'CRON_SECRET'];
    const run = (headers, env) => {
        const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
        for (const k of KEYS) {
            if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
        }
        let status = 200, nextCalled = false;
        const res = { status(c) { status = c; return this; }, json() { return this; } };
        verifyCronRequest({ headers }, res, () => { nextCalled = true; });
        for (const k of KEYS) {
            if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
        }
        return nextCalled ? 'next' : status;
    };
    const origWarn = console.warn, origErr = console.error;
    console.warn = console.error = () => {};
    try {
        assert.equal(run({}, { NODE_ENV: 'production', CRON_SECRET: undefined }), 503);
        assert.equal(run({}, { NODE_ENV: 'development' }), 'next');
        assert.equal(run({ authorization: 'Bearer wrong' }, { CRON_SECRET: 's3cret' }), 401);
        assert.equal(run({}, { CRON_SECRET: 's3cret' }), 401);
        assert.equal(run({ authorization: 'Bearer s3cret' }, { CRON_SECRET: 's3cret' }), 'next');
    } finally {
        console.warn = origWarn; console.error = origErr;
    }
});
