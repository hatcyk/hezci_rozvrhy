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
