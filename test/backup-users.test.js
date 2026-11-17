const test = require('node:test');
const assert = require('node:assert/strict');
const { Timestamp } = require('firebase-admin/firestore');

const { exportUsers, restoreUsers, FORMAT } = require('../scripts/backup-users');

// In-memory stand-in for the part of Firestore the script uses.
function fakeDb(initial = {}) {
    const store = new Map(Object.entries(initial));
    const ref = (id) => ({
        id,
        async create(data) {
            if (store.has(id)) throw Object.assign(new Error('already exists'), { code: 6 });
            store.set(id, data);
        },
    });
    return {
        store,
        collection(name) {
            assert.equal(name, 'users');
            return {
                doc: ref,
                async get() {
                    const docs = [...store].map(([id, data]) => ({ id, data: () => data }));
                    return { forEach: (fn) => docs.forEach(fn) };
                },
            };
        },
        async getAll(...refs) {
            return refs.map((r) => ({ id: r.id, ref: r, exists: store.has(r.id) }));
        },
    };
}

const legacyUser = () => ({
    tokens: ['device-token-1'],
    watchedTimetables: [{ type: 'Class', id: 'C2A', schedule: 'Actual', preferences: { changes: { substitution: true } } }],
    notificationsEnabled: true,
    createdAt: Timestamp.fromDate(new Date('2025-09-01T07:00:00Z')),
});

test('export → restore brings back a document the migration deleted, timestamps included', async () => {
    const source = fakeDb({ 'anonymous-1700000000000': legacyUser(), 'anon-1111': { tokens: [] } });
    const backup = JSON.parse(JSON.stringify(await exportUsers(source, new Date('2026-11-20T18:00:00Z'))));

    assert.equal(backup.format, FORMAT);
    assert.equal(backup.count, 2);
    assert.equal(backup.exportedAt, '2026-11-20T18:00:00.000Z');

    // After the release: the legacy document is gone, the migrated one exists.
    const after = fakeDb({ 'anon-1111': { tokens: ['changed-since'] } });
    const result = await restoreUsers(after, backup, { write: true });

    assert.deepEqual(result, { total: 2, missing: 1, created: 1, existing: 1 });
    const restored = after.store.get('anonymous-1700000000000');
    assert.ok(restored.createdAt instanceof Timestamp);
    assert.equal(restored.createdAt.toDate().toISOString(), '2025-09-01T07:00:00.000Z');
    assert.deepEqual(restored.watchedTimetables, legacyUser().watchedTimetables);
    // A document that exists is never overwritten.
    assert.deepEqual(after.store.get('anon-1111'), { tokens: ['changed-since'] });
});

test('restore without --yes only counts', async () => {
    const backup = await exportUsers(fakeDb({ 'anonymous-1': legacyUser() }));
    const empty = fakeDb();
    const result = await restoreUsers(empty, JSON.parse(JSON.stringify(backup)));
    assert.deepEqual(result, { total: 1, missing: 1, created: 0, existing: 0 });
    assert.equal(empty.store.size, 0);
});

test('restore refuses a file that is not a complete users backup', async () => {
    await assert.rejects(restoreUsers(fakeDb(), { docs: {} }), /není záloha/);
    const backup = JSON.parse(JSON.stringify(await exportUsers(fakeDb({ a: {}, b: {} }))));
    delete backup.docs.b;
    await assert.rejects(restoreUsers(fakeDb(), backup, { write: true }), /neúplná/);
});
