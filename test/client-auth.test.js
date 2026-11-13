/**
 * Client side of contract S1 (public/js/firebase-client.js + api.js):
 * the server-issued userId is stored (also after migrating an old ID), every
 * per-user call carries `Authorization: Bearer <ID token>`, and a 401 leads to
 * one re-sign-in and a retry with a fresh token. Firebase and fetch are fakes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

// ---- fake Firebase compat SDK ---------------------------------------------
let currentUser = null;
let signIns = 0;
const fakeFirebase = {
    initializeApp: () => ({}),
    firestore: () => ({}),
    auth: () => ({
        get currentUser() { return currentUser; },
        async signInWithCustomToken(token) {
            signIns++;
            const uid = token.replace(/^custom-/, '');
            let n = 0;
            currentUser = { uid, getIdToken: async (force) => `id-${uid}-${force ? 'fresh' : 'cached'}-${++n}` };
        },
    }),
};
globalThis.firebase = fakeFirebase;

// ---- fake fetch -----------------------------------------------------------
const calls = [];
let routes = {};
globalThis.fetch = async (url, init = {}) => {
    const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers || {});
    calls.push({ url, method: init.method || 'GET', auth: headers.get('Authorization'), body: init.body ? JSON.parse(init.body) : undefined });
    const handler = routes[url] || routes['*'];
    const [status, body] = handler ? handler(calls[calls.length - 1]) : [404, {}];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
};

const NEW_ID = 'anon-0b5f6c1e-7d3a-4c2b-9e8f-1a2b3c4d5e6f';

test('first visit: no stored ID → server issues anon-<uuid>, client stores it', async () => {
    const { authenticateWithFirebase } = await import('../public/js/firebase-client.js');
    routes = { '/api/auth': () => [200, { token: `custom-${NEW_ID}`, userId: NEW_ID }] };
    calls.length = 0;
    await authenticateWithFirebase();
    assert.equal(calls[0].url, '/api/auth');
    assert.equal(calls[0].body.userId, undefined, 'client must not invent an ID');
    assert.equal(localStorage.getItem('userId'), NEW_ID);
    assert.equal(currentUser.uid, NEW_ID);
});

test('legacy anonymous-<ms> ID is replaced by the migrated ID from /api/auth', async () => {
    const { authenticateWithFirebase } = await import('../public/js/firebase-client.js');
    const LEGACY = 'anonymous-1730000000000';
    localStorage.setItem('userId', LEGACY);
    currentUser = { uid: LEGACY, getIdToken: async () => `id-${LEGACY}` }; // session left by version 1.x
    const MIGRATED = 'anon-11111111-2222-4333-8444-555555555555';
    routes = { '/api/auth': (c) => [200, { token: `custom-${MIGRATED}`, userId: MIGRATED, migratedFrom: c.body.userId }] };
    calls.length = 0;
    await authenticateWithFirebase({ force: true });
    assert.equal(calls[0].body.userId, LEGACY, 'old ID is sent once for migration');
    assert.equal(calls[0].auth, `Bearer id-${LEGACY}`, 'and proven with the ID token of its 1.x session');
    assert.equal(localStorage.getItem('userId'), MIGRATED);
});

test('apiFetch sends Bearer ID token and builds the URL from the signed-in uid', async () => {
    const { apiFetch } = await import('../public/js/api.js');
    routes = { '*': () => [200, { ok: true }] };
    calls.length = 0;
    const res = await apiFetch((uid) => [`/api/favorites/${uid}`]);
    assert.equal(res.status, 200);
    assert.equal(calls[0].url, `/api/favorites/${currentUser.uid}`);
    assert.match(calls[0].auth, /^Bearer id-anon-[0-9a-f-]+-cached-\d+$/);
});

test('apiFetch: 401 → sign in again once, retry with a freshly minted token', async () => {
    const { apiFetch } = await import('../public/js/api.js');
    const uid = currentUser.uid;
    let n = 0;
    routes = {
        '/api/auth': () => [200, { token: `custom-${uid}`, userId: uid }],
        '/api/fcm/update-preferences': () => (++n === 1 ? [401, { error: 'expired' }] : [200, { ok: true }]),
    };
    calls.length = 0;
    const before = signIns;
    const res = await apiFetch((u) => ['/api/fcm/update-preferences', { method: 'POST', body: JSON.stringify({ userId: u, watchedTimetables: [] }) }]);
    assert.equal(res.status, 200);
    assert.deepEqual(calls.map(c => c.url), ['/api/fcm/update-preferences', '/api/auth', '/api/fcm/update-preferences']);
    assert.match(calls[1].auth, /^Bearer id-anon-.*-fresh-/, 're-sign-in proves the identity with a refreshed ID token');
    assert.equal(signIns, before + 1);
    assert.match(calls[2].auth, /-fresh-/, 'retry forces a token refresh');
    assert.equal(calls[2].body.userId, uid);
});

test('apiFetch: a second 401 is returned to the caller (no endless loop)', async () => {
    const { apiFetch } = await import('../public/js/api.js');
    const uid = currentUser.uid;
    routes = { '/api/auth': () => [200, { token: `custom-${uid}`, userId: uid }], '/api/fcm/preferences/x': () => [401, {}] };
    calls.length = 0;
    const res = await apiFetch(() => ['/api/fcm/preferences/x']);
    assert.equal(res.status, 401);
    assert.equal(calls.filter(c => c.url === '/api/auth').length, 1);
});

test('concurrent re-sign-ins share one /api/auth request', async () => {
    const { authenticateWithFirebase } = await import('../public/js/firebase-client.js');
    const uid = currentUser.uid;
    routes = { '/api/auth': () => [200, { token: `custom-${uid}`, userId: uid }] };
    calls.length = 0;
    await Promise.all([authenticateWithFirebase({ force: true }), authenticateWithFirebase({ force: true })]);
    assert.equal(calls.filter(c => c.url === '/api/auth').length, 1);
});

test('favorites use the authenticated helper (no anonymous-<ms> IDs)', async () => {
    const { loadFavorites, saveFavorites } = await import('../public/js/favorites.js');
    const { state } = await import('../public/js/state.js');
    routes = { '*': (c) => [200, c.method === 'GET' ? { favoriteTimetables: [{ type: 'Class', id: 'ZL' }] } : { ok: true }] };
    calls.length = 0;
    await loadFavorites();
    await saveFavorites([{ type: 'Room', id: 'R1' }]);
    assert.deepEqual(state.favoriteTimetables, [{ type: 'Room', id: 'R1' }]);
    for (const c of calls) {
        assert.equal(c.url, `/api/favorites/${encodeURIComponent(currentUser.uid)}`);
        assert.match(c.auth, /^Bearer /);
    }
    assert.ok(!/^anonymous-/.test(localStorage.getItem('userId')));
});

test('missing Firebase SDK → readable Czech message instead of SDK internals', async () => {
    const fc = await import('../public/js/firebase-client.js');
    assert.throws(() => fc.getFirestore(), (err) => err.message === fc.FIREBASE_UNAVAILABLE_MESSAGE && /připojit/.test(err.message));
    delete globalThis.firebase;
    try {
        assert.equal(fc.isFirebaseSdkLoaded(), false);
        await assert.rejects(fc.initializeFirebase({}), { message: fc.FIREBASE_UNAVAILABLE_MESSAGE });
    } finally {
        globalThis.firebase = fakeFirebase;
    }
});

// ---- sign-in with a session restored by the SDK (fresh module instances) ----
const STORED = 'anon-22222222-3333-4444-8555-666666666666';

test('restored session for the stored anon ID: waits for it and makes no /api/auth call', async () => {
    const saved = globalThis.firebase;
    localStorage.setItem('userId', STORED);
    let restored = null;
    let listeners = 0;
    globalThis.firebase = {
        ...saved,
        auth: () => ({
            get currentUser() { return restored; },
            onAuthStateChanged(cb) {
                listeners++;
                setTimeout(() => { restored = { uid: STORED, getIdToken: async () => `id-${STORED}` }; cb(restored); }, 10);
                return () => {};
            },
            async signInWithCustomToken() { throw new Error('must not sign in again'); },
        }),
    };
    try {
        const fc = await import('../public/js/firebase-client.js?restored-session');
        calls.length = 0;
        assert.equal(await fc.authenticateWithFirebase(), true);
        assert.equal(listeners, 1, 'waited for Firebase to restore the session');
        assert.equal(calls.length, 0);
    } finally {
        globalThis.firebase = saved;
    }
});

test('stored ID without its own session: no foreign ID token is sent, the server issues a new identity', async () => {
    const saved = globalThis.firebase;
    const OTHER = 'anon-77777777-8888-4999-8aaa-bbbbbbbbbbbb';
    try {
        for (const session of [null, { uid: OTHER, getIdToken: async () => `id-${OTHER}` }]) {
            let user = session;
            globalThis.firebase = {
                ...saved,
                auth: () => ({
                    get currentUser() { return user; },
                    async signInWithCustomToken(token) { user = { uid: token.replace(/^custom-/, ''), getIdToken: async () => 'x' }; },
                }),
            };
            localStorage.setItem('userId', STORED);
            const fc = await import(`../public/js/firebase-client.js?no-session-${session ? 'foreign' : 'none'}`);
            routes = { '/api/auth': () => [200, { token: `custom-${NEW_ID}`, userId: NEW_ID }] };
            calls.length = 0;
            await fc.authenticateWithFirebase();
            assert.equal(calls[0].url, '/api/auth');
            assert.equal(calls[0].auth, null);
            assert.equal(calls[0].body.userId, STORED);
            assert.equal(localStorage.getItem('userId'), NEW_ID);
        }
    } finally {
        globalThis.firebase = saved;
    }
});
