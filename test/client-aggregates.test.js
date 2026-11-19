/**
 * Live aggregates for the kiosk (public/js/api.js watchAggregate): when the
 * document cannot be read at all (Firestore rules, SDK not loaded, offline
 * without a stored copy) the caller learns about it, so the board can say so
 * instead of "Načítám změny…" forever. Firebase is a fake; no network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

console.log = () => {};
console.warn = () => {};

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
globalThis.navigator = { onLine: true };

let docs = {};
const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
globalThis.firebase = {
    initializeApp: () => ({}),
    firestore: () => ({
        collection: (c) => ({
            doc: (id) => ({
                get: async () => {
                    const d = docs[`${c}/${id}`];
                    if (d === 'denied') throw denied();
                    return { exists: d != null, data: () => d };
                },
                onSnapshot(next, error) {
                    const d = docs[`${c}/${id}`];
                    setTimeout(() => (d === 'denied' ? error(denied()) : next({ exists: d != null, data: () => d })), 0);
                    return () => {};
                },
            }),
        }),
    }),
};

const tick = () => new Promise((r) => setTimeout(r, 20));

test('Firestore not initialised (SDK blocked): onError, no value', async () => {
    const { watchAggregate } = await import('../public/js/api.js');
    const values = [];
    const errors = [];
    const stop = watchAggregate('changes_Actual', (v) => values.push(v), (e) => errors.push(e));
    await tick();
    stop();
    assert.equal(values.length, 0);
    assert.equal(errors.length, 1);
});

test('rules deny the read: onError; a missing document is an answer, not an error', async () => {
    const { initializeFirebase } = await import('../public/js/firebase-client.js');
    await initializeFirebase({});
    const { watchAggregate } = await import('../public/js/api.js');
    docs = { 'aggregates/changes_Actual': 'denied' };
    let values = [];
    let errors = [];
    let stop = watchAggregate('changes_Actual', (v) => values.push(v), (e) => errors.push(e));
    await tick();
    stop();
    assert.equal(values.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'permission-denied');

    docs = {};
    values = [];
    errors = [];
    stop = watchAggregate('changes_Next', (v) => values.push(v), (e) => errors.push(e));
    await tick();
    stop();
    assert.deepEqual(values, [{ data: null, fromCache: false, cacheAgeMs: null }]);
    assert.equal(errors.length, 0);
});
