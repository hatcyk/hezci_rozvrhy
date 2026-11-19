/**
 * Start of the app without an endless "Načítám…": every step (sign-in,
 * /api/auth, definitions, timetable) has a time limit, /api/auth gets one
 * retry, a read past its limit falls back to the saved copy, and the saved
 * timetable can be shown before the sign-in is over
 * (public/js/firebase-client.js, api.js, offline.js). Firebase and fetch are
 * fakes; time is mocked (node:test mock.timers), so nothing really waits.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

// The client logs to stdout, which the test runner uses for its own messages
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis;
Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => true });

// ---- fake Firebase compat SDK ---------------------------------------------
const NEW_ID = 'anon-0b5f6c1e-7d3a-4c2b-9e8f-1a2b3c4d5e6f';
const order = [];          // settings / collection calls, in order
const reads = [];          // Firestore document paths read
const hang = new Set();    // paths (or 'signIn') that never answer
const docs = {
    'definitions/current': { classes: [{ id: 'C2A', name: '2.A' }], teachers: [], rooms: [] },
    'timetables/Class_C2A_Actual': { data: [{ day: 0, hour: 1, subject: 'Čerstvá' }] },
};
let currentUser = null;
const never = () => new Promise(() => {});
const fakeDb = {
    settings: (s) => order.push(['settings', s]),
    collection: (c) => {
        order.push(['collection', c]);
        return {
            doc: (id) => ({
                get: () => {
                    const p = `${c}/${id}`;
                    reads.push(p);
                    if (hang.has(p)) return never();
                    return Promise.resolve({ exists: p in docs, data: () => JSON.parse(JSON.stringify(docs[p])) });
                },
            }),
        };
    },
};
globalThis.firebase = {
    initializeApp: () => ({}),
    firestore: () => fakeDb,
    auth: () => ({
        get currentUser() { return currentUser; },
        signInWithCustomToken(token) {
            if (hang.has('signIn')) return never();
            const uid = token.replace(/^custom-/, '');
            currentUser = { uid, getIdToken: async () => `id-${uid}` };
            return Promise.resolve({ user: currentUser });
        },
    }),
};

// ---- fake fetch: a handler per call (queue), honours AbortSignal -----------
const calls = [];
let queue = [];
const reply = (status, body) => () => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const hangReply = () => (init) => new Promise((_, reject) => {
    if (init.signal) init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});
globalThis.fetch = (url, init = {}) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) return Promise.resolve(new Response('{}', { status: 404 }));
    return next(init);
};

/** A session restored by the SDK for the stored ID (repeat visit). */
function signedInAs(uid) {
    store.set('userId', uid);
    currentUser = { uid, getIdToken: async () => `id-${uid}` };
}

/** Let pending promise chains run (setImmediate is not mocked). */
async function settle() {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
}
/** Run the code up to its next timer, then move the mocked clock by `ms`. */
async function advance(ms) {
    await settle();
    mock.timers.tick(ms);
    await settle();
}

test.beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
    calls.length = 0;
    queue = [];
    hang.clear();
});
test.afterEach(() => mock.timers.reset());

test('Firestore: long-polling auto-detection is set before the first read', async () => {
    const { initializeFirebase } = await import('../public/js/firebase-client.js');
    await initializeFirebase({});
    assert.deepEqual(order[0], ['settings', { experimentalAutoDetectLongPolling: true, merge: true }]);
    assert.equal(order.filter(([k]) => k === 'collection').length, 0, 'no read before the settings');
});

test('/api/auth: no answer within the limit → aborted and tried once more', async () => {
    const { authenticateWithFirebase, STEP_LIMITS } = await import('../public/js/firebase-client.js');
    signedInAs(NEW_ID);
    queue = [hangReply(), reply(200, { token: `custom-${NEW_ID}`, userId: NEW_ID })];
    const done = authenticateWithFirebase({ force: true });
    await advance(STEP_LIMITS.authFetch);
    assert.equal(await done, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.signal.aborted, true, 'the hanging request is cancelled');
    assert.equal(calls[1].init.headers.Authorization, `Bearer id-${NEW_ID}`, 'the retry proves the same ID');
});

test('/api/auth: 503 (cold start, lost answer) → one retry; 429 is final', async () => {
    const { authenticateWithFirebase } = await import('../public/js/firebase-client.js');
    signedInAs(NEW_ID);
    queue = [reply(503, { error: 'x' }), reply(200, { token: `custom-${NEW_ID}`, userId: NEW_ID })];
    assert.equal(await authenticateWithFirebase({ force: true }), true);
    assert.equal(calls.length, 2);

    calls.length = 0;
    queue = [reply(429, { error: 'Příliš mnoho nových uživatelů z této sítě, zkuste to později.', retryAfterSec: 120 }), reply(200, {})];
    await assert.rejects(authenticateWithFirebase({ force: true }), /Příliš mnoho nových uživatelů/);
    assert.equal(calls.length, 1);
});

test('/api/auth: two attempts without an answer end with a Czech timeout error, not an endless wait', async () => {
    const { authenticateWithFirebase, STEP_LIMITS, TIMEOUT_MESSAGE } = await import('../public/js/firebase-client.js');
    signedInAs(NEW_ID);
    queue = [hangReply(), hangReply()];
    const done = authenticateWithFirebase({ force: true });
    const outcome = done.then(() => 'resolved', (e) => e);
    await advance(STEP_LIMITS.authFetch);
    await advance(STEP_LIMITS.authFetch);
    const err = await outcome;
    assert.equal(err.code, 'timeout');
    assert.equal(err.message, TIMEOUT_MESSAGE);
    assert.equal(calls.length, 2);
    assert.equal(localStorage.getItem('userId'), NEW_ID, 'the stored ID stays for the next start');
});

test('signInWithCustomToken without an answer ends after its limit', async () => {
    const { authenticateWithFirebase, STEP_LIMITS } = await import('../public/js/firebase-client.js');
    signedInAs(NEW_ID);
    hang.add('signIn');
    queue = [reply(200, { token: `custom-${NEW_ID}`, userId: NEW_ID })];
    const outcome = authenticateWithFirebase({ force: true }).then(() => 'resolved', (e) => e);
    await advance(STEP_LIMITS.signIn);
    assert.equal((await outcome).code, 'timeout');
});

const saved = (data, at = Date.now() - 5 * 60e3) => JSON.stringify({ data, timestamp: at, ttl: 1 });

test('timetable read without an answer: after the limit the saved copy is used', async () => {
    const { fetchTimetable, clearSessionCache } = await import('../public/js/api.js');
    const { STEP_LIMITS } = await import('../public/js/firebase-client.js');
    clearSessionCache();
    hang.add('timetables/Class_C2A_Actual');
    localStorage.setItem('bakalari_cache_timetable_Class_C2A_actual', saved([{ day: 0, hour: 1, subject: 'Uložená' }]));
    const result = fetchTimetable('Class', 'C2A', 'actual', '2026-11-02');
    await advance(STEP_LIMITS.read);
    assert.deepEqual(await result, [{ day: 0, hour: 1, subject: 'Uložená' }]);
});

test('timetable / definitions read without an answer and nothing saved: Czech timeout error', async () => {
    const { fetchTimetable, fetchDefinitions, clearSessionCache } = await import('../public/js/api.js');
    const { STEP_LIMITS, TIMEOUT_MESSAGE } = await import('../public/js/firebase-client.js');
    clearSessionCache();
    store.delete('bakalari_cache_timetable_Class_C2A_actual');
    store.delete('bakalari_cache_definitions');
    hang.add('timetables/Class_C2A_Actual');
    hang.add('definitions/current');
    const tt = fetchTimetable('Class', 'C2A', 'actual', '2026-11-02').then(() => 'resolved', (e) => e);
    const defs = fetchDefinitions().then(() => 'resolved', (e) => e);
    await advance(STEP_LIMITS.read);
    for (const err of [await tt, await defs]) {
        assert.equal(err.code, 'timeout');
        assert.equal(err.message, TIMEOUT_MESSAGE);
    }
});

test('/api/status without an answer: after the limit the start goes on (treated as healthy)', async () => {
    const { fetchBackendStatus } = await import('../public/js/api.js');
    const { STEP_LIMITS } = await import('../public/js/firebase-client.js');
    queue = [hangReply()];
    const status = fetchBackendStatus();
    await advance(STEP_LIMITS.read);
    assert.equal((await status).isHealthy, true);
    assert.equal(calls[0].init.signal.aborted, true);
});

test('banner text of the saved copy says from when it is', async () => {
    const { savedCopyText } = await import('../public/js/offline.js');
    const now = new Date(2026, 10, 19, 14, 20);
    assert.equal(savedCopyText(17 * 60e3, now), 'Aktuální data se nepodařilo načíst – zobrazuji uložený rozvrh z dnes v 14:03.');
    assert.equal(savedCopyText(26 * 3600e3, now), 'Aktuální data se nepodařilo načíst – zobrazuji uložený rozvrh z 18. 11. v 12:20.');
    assert.equal(savedCopyText(null, now), 'Aktuální data se nepodařilo načíst – zobrazuji uložený rozvrh.');
});
