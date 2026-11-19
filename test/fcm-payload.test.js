// sendNotificationToTokens fits the whole FCM data payload under the limit,
// and the watch index carries watchedTypes for the admin statistics.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeFirestore, stubFirebase } = require('./helpers/fake-firestore');

console.log = () => {};
const db = createFakeFirestore({
    'system/migrations': { watchIndexV1: true },
    'users/anon-0b7f6c1e-8a1d-4c3b-9f2e-1a2b3c4d5e6f': {
        tokens: ['t'],
        watchedKeys: ['Class_ZL_Actual'],
        hasReminders: false,
        preferences: { watchedTimetables: [
            { type: 'Class', id: 'ZL', scheduleType: 'Actual' },
            { type: 'Room', id: '17', scheduleType: 'Next' },
            { type: 'Class', id: 'ZK', scheduleType: 'Actual' },
        ] },
    },
});
const { sent } = stubFirebase(db);
const { sendNotificationToTokens, buildChangeNotification, deriveWatchIndex, ensureWatchIndexMigrated } = require('../backend/fcm');
const { FCM_SAFE_DATA_BYTES } = require('../backend/change-detector');

const change = (i) => ({
    type: 'substitution', day: i % 5, dayName: 'Po', hour: i % 10,
    lesson: { subject: `Předmět s dlouhým názvem číslo ${i}`, teacher: 'Ing. Synt. Vzorová', room: 'A102', date: '2026-11-02' },
    change: { oldValue: 'Ing. Synt. Vzorová', newValue: 'Mgr. Zástupová' },
    description: `Suplování ${i}`,
});

test('celá data zprávy (titulek, text, podrobnosti) se vejdou pod limit FCM', async () => {
    const changes = Array.from({ length: 200 }, (_, i) => change(i));
    const n = buildChangeNotification({ type: 'Class', id: 'ZL', name: 'Třída s velmi dlouhým názvem '.repeat(10), scheduleType: 'Actual' }, changes);
    n.body = 'Dlouhé shrnutí změn ✏️ '.repeat(200); // body alone ~5 kB
    await sendNotificationToTokens(['tok'], n);
    const data = sent.at(-1).data;
    assert.ok(Buffer.byteLength(JSON.stringify(data), 'utf8') <= FCM_SAFE_DATA_BYTES);
    for (const v of Object.values(data)) assert.equal(typeof v, 'string');
    assert.equal(data.timetableId, 'ZL', 'ids are never cut');
    assert.ok(data.title.startsWith('Třída s velmi dlouhým názvem'));
});

test('malá zpráva projde beze změny', async () => {
    const n = buildChangeNotification({ type: 'Class', id: 'ZL', name: '2.A', scheduleType: 'Next' }, [change(1)]);
    await sendNotificationToTokens(['tok'], n);
    const data = sent.at(-1).data;
    assert.equal(data.body, n.body);
    assert.equal(data.detailedBody, n.data.detailedBody);
});

test('deriveWatchIndex: watchedTypes seřazené bez opakování; migrace V2 je doplní', async () => {
    assert.deepEqual(deriveWatchIndex([
        { type: 'Room', id: '1', scheduleType: 'Actual' },
        { type: 'Class', id: 'ZL', scheduleType: 'Next' },
        { type: 'Room', id: '2', scheduleType: 'Next' },
        { type: 'Teacher' },
    ]).watchedTypes, ['Class', 'Room']);
    assert.deepEqual(deriveWatchIndex(null), { watchedKeys: [], hasReminders: false, watchedTypes: [] });

    await ensureWatchIndexMigrated();
    const user = db._get('users/anon-0b7f6c1e-8a1d-4c3b-9f2e-1a2b3c4d5e6f');
    assert.deepEqual(user.watchedTypes, ['Class', 'Room']);
    assert.deepEqual(user.watchedKeys, ['Class_ZL_Actual', 'Room_17_Next', 'Class_ZK_Actual']);
    assert.equal(db._get('system/migrations').watchIndexV2, true);
});
