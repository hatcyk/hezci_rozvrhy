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
stubFirebase(db);

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

test('/api/auth převede starý anonymous-<ms> s ID tokenem jeho relace: dokument se přesune pod nové ID', async () => {
    const r = await postJson('/api/auth', { userId: LEGACY }, bearer(LEGACY));
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.migratedFrom, LEGACY);
    assert.equal(isValidUserId(body.userId), true);
    assert.equal(body.token, `custom:${body.userId}`);

    assert.equal(db._get(`users/${LEGACY}`), undefined, 'starý dokument je smazaný');
    const moved = db._get(`users/${body.userId}`);
    assert.deepEqual(moved.tokens, ['fcm-1']);
    assert.equal(moved.preferences.watchedTimetables[0].id, 'ZL');
    assert.equal(moved.migratedFrom, LEGACY);

    // Second call with the same legacy session: nothing left to move, a fresh ID.
    const again = await (await postJson('/api/auth', { userId: LEGACY }, bearer(LEGACY))).json();
    assert.notEqual(again.userId, body.userId);
    assert.equal(db._get(`users/${again.userId}`), undefined);
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
