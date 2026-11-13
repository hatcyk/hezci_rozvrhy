/**
 * In-memory stand-in for the parts of the Firestore Admin API the backend
 * uses, plus a helper that swaps backend/firebase-admin-init.js for it in
 * require.cache. Tests never touch the real Firebase project.
 *
 * Not a test file itself (no .test.js suffix), so `npm test` does not run it.
 */

const path = require('node:path');

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function alreadyExists(docPath) {
    const err = new Error(`6 ALREADY_EXISTS: Document already exists: ${docPath}`);
    err.code = 6;
    return err;
}

function notFound(docPath) {
    const err = new Error(`5 NOT_FOUND: No document to update: ${docPath}`);
    err.code = 5;
    return err;
}

function setPath(obj, dotted, value) {
    const parts = dotted.split('.');
    let cur = obj;
    for (const p of parts.slice(0, -1)) {
        if (cur[p] === null || typeof cur[p] !== 'object') cur[p] = {};
        cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
}

function getPath(obj, dotted) {
    return dotted.split('.').reduce((cur, p) => (cur == null ? undefined : cur[p]), obj);
}

function matches(data, { field, op, value }) {
    const v = getPath(data, field);
    switch (op) {
        case '==': return v === value;
        case '!=': return v !== value;
        case '<': return v < value;
        case '<=': return v <= value;
        case '>': return v > value;
        case '>=': return v >= value;
        case 'array-contains': return Array.isArray(v) && v.includes(value);
        case 'in': return Array.isArray(value) && value.includes(v);
        default: throw new Error(`fake-firestore: unsupported operator ${op}`);
    }
}

let autoId = 0;

function createFakeFirestore(initial = {}) {
    const store = new Map(); // "collection/docId" → data
    const log = [];          // [{ op, path }]

    for (const [p, data] of Object.entries(initial)) store.set(p, clone(data));

    function snapshot(ref) {
        const data = store.get(ref.path);
        return {
            id: ref.id,
            ref,
            exists: data !== undefined,
            data: () => clone(data),
        };
    }

    function docRef(collection, id) {
        const ref = {
            id,
            path: `${collection}/${id}`,
            async get() { log.push({ op: 'get', path: ref.path }); return snapshot(ref); },
            async set(data, options = {}) {
                log.push({ op: 'set', path: ref.path });
                const base = options.merge ? clone(store.get(ref.path)) || {} : {};
                store.set(ref.path, { ...base, ...clone(data) });
            },
            async create(data) {
                log.push({ op: 'create', path: ref.path });
                if (store.has(ref.path)) throw alreadyExists(ref.path);
                store.set(ref.path, clone(data));
            },
            async update(data) {
                log.push({ op: 'update', path: ref.path });
                if (!store.has(ref.path)) throw notFound(ref.path);
                const next = clone(store.get(ref.path));
                for (const [k, v] of Object.entries(data)) setPath(next, k, clone(v));
                store.set(ref.path, next);
            },
            async delete() { log.push({ op: 'delete', path: ref.path }); store.delete(ref.path); },
        };
        return ref;
    }

    // Query state: filters, orderBy list, limit. Supports what the backend
    // uses: where / orderBy / limit / select / get / count() / aggregate().
    // `db._failQuery(state)` may return an Error to simulate e.g. a missing
    // composite index (FAILED_PRECONDITION) for a given query shape.
    function query(collection, state = { filters: [], orders: [], limit: null }) {
        const next = (patch) => query(collection, { ...state, ...patch });
        const run = () => {
            const hookError = typeof db._failQuery === 'function' ? db._failQuery({ collection, ...state }) : null;
            if (hookError) throw hookError;
            let rows = [];
            for (const [p, data] of store) {
                const [col, id] = p.split('/');
                if (col !== collection) continue;
                if (state.filters.every(f => matches(data, f))) rows.push({ id, data });
            }
            // Firestore leaves out documents without the orderBy field.
            for (const { field } of state.orders) rows = rows.filter(r => getPath(r.data, field) !== undefined);
            if (state.orders.length) {
                rows.sort((a, b) => {
                    for (const { field, dir } of state.orders) {
                        const x = getPath(a.data, field);
                        const y = getPath(b.data, field);
                        if (x === y) continue;
                        const cmp = x < y ? -1 : 1;
                        return dir === 'desc' ? -cmp : cmp;
                    }
                    return 0;
                });
            }
            if (state.limit != null) rows = rows.slice(0, state.limit);
            return rows;
        };
        return {
            where(field, op, value) { return next({ filters: [...state.filters, { field, op, value }] }); },
            orderBy(field, dir = 'asc') { return next({ orders: [...state.orders, { field, dir }] }); },
            limit(n) { return next({ limit: n }); },
            select() { return next({}); },
            async get() {
                log.push({ op: 'query', path: collection });
                const docs = run().map(r => snapshot(docRef(collection, r.id)));
                return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
            },
            count() {
                return {
                    async get() {
                        log.push({ op: 'count', path: collection });
                        const n = run().length;
                        return { data: () => ({ count: n }) };
                    },
                };
            },
            // spec values are real AggregateField objects (aggregateType + _field).
            aggregate(spec) {
                return {
                    async get() {
                        log.push({ op: 'aggregate', path: collection });
                        const rows = run();
                        const out = {};
                        for (const [key, agg] of Object.entries(spec)) {
                            const values = agg._field === undefined ? []
                                : rows.map(r => getPath(r.data, agg._field)).filter(v => typeof v === 'number');
                            if (agg.aggregateType === 'count') out[key] = rows.length;
                            else if (agg.aggregateType === 'sum') out[key] = values.reduce((a, b) => a + b, 0);
                            else if (agg.aggregateType === 'avg') out[key] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
                            else throw new Error(`fake-firestore: unsupported aggregate ${agg.aggregateType}`);
                        }
                        return { data: () => out };
                    },
                };
            },
        };
    }

    const db = {
        collection(name) {
            return {
                ...query(name),
                doc(id) { return docRef(name, id || `auto${++autoId}`); },
                async add(data) {
                    const ref = docRef(name, `auto${++autoId}`);
                    await ref.create(data);
                    return ref;
                },
            };
        },
        async getAll(...refs) { return Promise.all(refs.map(r => r.get())); },
        batch() {
            const ops = [];
            return {
                set(ref, data, opts) { ops.push(() => ref.set(data, opts)); return this; },
                create(ref, data) { ops.push(() => ref.create(data)); return this; },
                update(ref, data) { ops.push(() => ref.update(data)); return this; },
                delete(ref) { ops.push(() => ref.delete()); return this; },
                async commit() { for (const op of ops) await op(); },
            };
        },
        // Writes are buffered and applied after the callback, like Firestore.
        // No isolation between concurrent transactions - tests that need
        // atomicity use create().
        async runTransaction(fn) {
            const ops = [];
            const tx = {
                get: (ref) => ref.get(),
                set(ref, data, opts) { ops.push(() => ref.set(data, opts)); return tx; },
                create(ref, data) { ops.push(() => ref.create(data)); return tx; },
                update(ref, data) { ops.push(() => ref.update(data)); return tx; },
                delete(ref) { ops.push(() => ref.delete()); return tx; },
            };
            const result = await fn(tx);
            for (const op of ops) await op();
            return result;
        },

        // ── test helpers ──
        _store: store,
        _log: log,
        _get: (p) => clone(store.get(p)),
        _paths: (collection) => [...store.keys()].filter(p => p.startsWith(`${collection}/`)),
        _docs: (collection) => [...store.entries()].filter(([p]) => p.startsWith(`${collection}/`)).map(([, d]) => clone(d)),
    };
    return db;
}

/**
 * Put a module into require.cache before anything loads the real one.
 * @param {string} rel - path from the project root, e.g. 'backend/fcm.js'
 */
function stubModule(rel, exportsObj) {
    const file = require.resolve(path.join(__dirname, '..', '..', rel));
    require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
    return exportsObj;
}

/**
 * Replace backend/firebase-admin-init.js with the fake.
 * ID tokens are "valid:<uid>"; anything else fails verification.
 */
function stubFirebase(db = createFakeFirestore(), extra = {}) {
    const sent = [];
    const messaging = {
        async sendEachForMulticast(message) {
            sent.push(message);
            return {
                successCount: message.tokens.length,
                failureCount: 0,
                responses: message.tokens.map(() => ({ success: true })),
            };
        },
    };
    const stub = stubModule('backend/firebase-admin-init.js', {
        initializeFirebaseAdmin: () => ({ app: {}, db }),
        getFirestore: () => db,
        getMessaging: () => messaging,
        createCustomToken: async (uid) => `custom:${uid}`,
        verifyIdToken: async (token) => {
            if (typeof token === 'string' && token.startsWith('valid:')) return { uid: token.slice(6) };
            const err = new Error('Firebase ID token has invalid signature');
            err.code = 'auth/argument-error';
            throw err;
        },
        ...extra,
    });
    return { db, stub, messaging, sent };
}

/**
 * Start an express app on a free localhost port.
 * @returns {Promise<{ base: string, close: () => Promise<void> }>}
 */
async function listen(app) {
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    return {
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

module.exports = { createFakeFirestore, stubModule, stubFirebase, listen };
