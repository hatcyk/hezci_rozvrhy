// processPendingChanges(): the path every change notification takes.
// Claim in a transaction (at most once), delivery record, group and
// preference filters, pruning of dead tokens, message TTL. Firebase is the
// in-memory fake; FCM is a stub that records the multicasts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeFirestore, stubFirebase } = require('./helpers/fake-firestore');

console.log = () => {};

const TT = { type: 'Class', id: 'ZL', name: '1.A', scheduleType: 'Actual' };
const KEY = 'Class_ZL_Actual';
const DEFAULTS = { lesson_removed: true, substitution: true, room_change: true, lesson_added: false, subject_change: false };
const user = (tokens, { groupFilters = ['all'], changes = DEFAULTS, watched = TT } = {}) => ({
    tokens,
    watchedKeys: [`${watched.type}_${watched.id}_${watched.scheduleType}`],
    preferences: { watchedTimetables: [{ type: watched.type, id: watched.id, scheduleType: watched.scheduleType, groupFilters,
        notificationTypes: { changes } }] },
});
const change = (type, hour, lesson, extra = {}) => ({
    type, day: 0, dayName: 'Po', hour, timetable: TT,
    lesson: { subject: 'Matematika', teacher: 'J. Ukázková', room: 'A102', group: '', date: '2026-11-09', ...lesson },
    description: `${type} ${hour}`, ...extra,
});
const CHANGES = [
    change('substitution', 1, { group: '1.sk', subject: 'Angličtina' }, { change: { oldValue: 'A. První', newValue: 'C. Třetí' } }),
    change('room_change', 2, {}, { change: { oldValue: 'A102', newValue: 'B5' } }),
    change('lesson_added', 3, { subject: 'Fyzika' }),
];
const changeDoc = (extra = {}) => ({ timetable: TT, weekStart: '2026-11-09', changes: CHANGES, timestamp: '2026-11-09T07:00:00.000Z', sent: false, ...extra });

const db = createFakeFirestore({ 'system/migrations': { watchIndexV1: true, watchIndexV2: true } });

// FCM stub: tokens listed in `failing` fail with the given error code.
const sent = [];
const failing = new Map();
let throwFor = null;
const messaging = {
    async sendEachForMulticast(message) {
        if (throwFor && message.tokens.includes(throwFor)) throw new Error('FCM unavailable (synthetic)');
        sent.push(message);
        const responses = message.tokens.map(token => (failing.has(token)
            ? { success: false, error: { code: failing.get(token) } }
            : { success: true }));
        const successCount = responses.filter(r => r.success).length;
        return { successCount, failureCount: responses.length - successCount, responses };
    },
};
stubFirebase(db, { getMessaging: () => messaging });

const { processPendingChanges, cleanupOldChanges } = require('../backend/fcm');
const { listChanges } = require('../backend/admin');

const quiet = (t) => { for (const level of ['log', 'warn', 'error']) t.mock.method(console, level, () => {}); };
function reset(docs) {
    for (const collection of ['users', 'changes']) for (const p of db._paths(collection)) db._store.delete(p);
    for (const [p, data] of Object.entries(docs)) db._store.set(p, structuredClone(data));
    sent.length = 0;
    failing.clear();
    throwFor = null;
}
const sentTo = (token) => sent.filter(m => m.tokens.includes(token));

test('změna se pošle sledujícím a dokument dostane sent, sentAt a počty', async (t) => {
    quiet(t);
    reset({ 'users/u1': user(['t1a', 't1b']), 'users/u2': user(['t2']), 'changes/c1': changeDoc() });
    const result = await processPendingChanges();
    assert.deepEqual(result, { processedCount: 1, sentCount: 3 });
    assert.equal(sent.length, 2, 'one multicast per user');
    assert.deepEqual(sentTo('t1a')[0].tokens, ['t1a', 't1b']);
    assert.equal(sent[0].data.type, 'timetable_change');
    assert.equal(sent[0].data.title, '1.A AKTUÁLNÍ: Změny v rozvrhu');

    const doc = db._get('changes/c1');
    assert.equal(doc.sent, true);
    assert.match(doc.sentAt, /^\d{4}-\d\d-\d\dT/);
    assert.equal(doc.sentToUsers, 2);
    assert.equal(doc.sentToDevices, 3);

    // a later run finds nothing pending
    assert.deepEqual(await processPendingChanges(), { processedCount: 0, sentCount: 0 });
    assert.equal(sent.length, 2);
});

test('zábor v transakci: dva souběžné běhy pošlou změnu jen jednou', async (t) => {
    quiet(t);
    reset({ 'users/u1': user(['t1']), 'changes/c1': changeDoc(), 'changes/c2': changeDoc({ timestamp: '2026-11-09T07:15:00.000Z' }) });
    const [a, b] = await Promise.all([processPendingChanges(), processPendingChanges()]);
    assert.equal(sent.length, 2, 'two documents, each sent once');
    assert.equal(a.processedCount + b.processedCount, 2);
    assert.equal(a.sentCount + b.sentCount, 2);
});

test('zábor v transakci: dokument, který mezitím zabral jiný běh, se přeskočí', async (t) => {
    quiet(t);
    reset({ 'users/u1': user(['t1']), 'changes/c1': changeDoc() });
    // Another processor claims the document after this run's query, before its transaction.
    const realTransaction = db.runTransaction;
    t.after(() => { db.runTransaction = realTransaction; });
    db.runTransaction = async (fn) => {
        db._store.set('changes/c1', { ...db._get('changes/c1'), sent: true, sentAt: '2026-11-09T07:00:01.000Z' });
        return realTransaction(fn);
    };
    const result = await processPendingChanges();
    assert.deepEqual(result, { processedCount: 0, sentCount: 0 });
    assert.equal(sent.length, 0);
    assert.equal(db._get('changes/c1').sentToUsers, undefined, "the other run's document is left alone");
});

test('filtr předvoleb a skupin: každý dostane jen své změny, kdo nemá žádnou, nedostane nic', async (t) => {
    quiet(t);
    reset({
        'users/defaults': user(['t-defaults']),                                         // substitution + room change
        'users/group2': user(['t-group2'], { groupFilters: ['2.sk'] }),                 // not the 1.sk substitution
        'users/group1': user(['t-group1'], { groupFilters: ['1.sk'], changes: { ...DEFAULTS, room_change: false } }),
        'users/added': user(['t-added'], { changes: { lesson_removed: false, substitution: false, room_change: false, lesson_added: true, subject_change: false } }),
        'users/off': user(['t-off'], { changes: { lesson_removed: false, substitution: false, room_change: false, lesson_added: false, subject_change: false } }),
        'users/legacy-filter': { ...user(['t-legacy']), preferences: { watchedTimetables: [{ ...TT, groupFilter: '2.sk' }] } },
        'users/other': user(['t-other'], { watched: { type: 'Class', id: 'XX', scheduleType: 'Actual' } }),
        'users/next': user(['t-next'], { watched: { ...TT, scheduleType: 'Next' } }),
        'users/no-token': user([]),
        'changes/c1': changeDoc(),
    });
    await processPendingChanges();
    const got = (token) => {
        const messages = sentTo(token);
        assert.ok(messages.length <= 1, `${token}: at most one message`);
        return messages.length ? `${messages[0].data.changeCount}: ${messages[0].data.body}` : null;
    };
    assert.equal(got('t-defaults'), '2: Po 1.h: Angličtina - supluje C. Třetí; Po 2.h: Matematika - učebna B5');
    assert.equal(got('t-group2'), '1: Po 2.h: Matematika - učebna B5');
    assert.equal(got('t-group1'), '1: Po 1.h: Angličtina - supluje C. Třetí');
    assert.equal(got('t-added'), '1: Po 3.h: Přidána Fyzika');
    assert.equal(got('t-off'), null);
    // no stored switches → everything; old single groupFilter still honoured
    assert.equal(got('t-legacy'), '2: Po 2.h: Matematika - učebna B5; Po 3.h: Přidána Fyzika');
    assert.equal(got('t-other'), null, 'watches another class');
    assert.equal(got('t-next'), null, 'watches the next week of this class');
    assert.equal(sent.length, 5);

    const doc = db._get('changes/c1');
    assert.equal(doc.sentToUsers, 6, 'watchers with a token');
    assert.equal(doc.sentToDevices, 5);
});

test('úklid tokenů: smaže se jen token, který FCM označí za neplatný', async (t) => {
    quiet(t);
    reset({ 'users/u1': user(['dead', 'alive', 'unregistered', 'bad-message']), 'users/u2': user(['t2']), 'changes/c1': changeDoc() });
    failing.set('dead', 'messaging/registration-token-not-registered');
    failing.set('unregistered', 'messaging/invalid-registration-token');
    failing.set('bad-message', 'messaging/invalid-argument');
    const result = await processPendingChanges();
    assert.equal(result.sentCount, 2);
    assert.deepEqual(db._get('users/u1').tokens, ['alive', 'bad-message']);
    assert.deepEqual(db._get('users/u2').tokens, ['t2']);
    assert.equal(db._get('changes/c1').sentToDevices, 2);
});

test('selhání odeslání jednomu uživateli nezastaví ostatní', async (t) => {
    quiet(t);
    reset({ 'users/u1': user(['t1']), 'users/u2': user(['t2']), 'changes/c1': changeDoc() });
    throwFor = 't1';
    const result = await processPendingChanges();
    assert.deepEqual(result, { processedCount: 1, sentCount: 1 });
    assert.equal(sentTo('t2').length, 1);
    assert.deepEqual(db._get('users/u1').tokens, ['t1'], 'an outage is not a dead token');
});

test('změna rozvrhu, který nikdo nesleduje, je v administraci „nikdo nesleduje“, ne věčně „odesílá se“', async (t) => {
    quiet(t);
    reset({ 'users/u1': user(['t1'], { watched: { type: 'Class', id: 'XX', scheduleType: 'Actual' } }), 'changes/c1': changeDoc() });
    const result = await processPendingChanges();
    assert.deepEqual(result, { processedCount: 1, sentCount: 0 });
    const doc = db._get('changes/c1');
    assert.equal(doc.sent, true);
    assert.equal(doc.sentToUsers, 0);
    assert.equal(doc.sentToDevices, 0);
    const { items } = await listChanges({ db });
    assert.equal(items[0].delivery, 'no_watchers');
});

test('zpráva o změně má TTL 3 dny a Urgency high', async (t) => {
    quiet(t);
    reset({ 'users/u1': user(['t1']), 'changes/c1': changeDoc() });
    await processPendingChanges();
    assert.deepEqual(sent[0].webpush, { headers: { TTL: String(3 * 24 * 3600), Urgency: 'high' } });
});

test('úklid starých změn: maže jen odeslané starší než limit', async (t) => {
    quiet(t);
    const old = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    reset({
        'changes/old-sent': changeDoc({ sent: true, sentAt: old }),
        'changes/old-unsent': changeDoc({ sent: false, sentAt: old }),
        'changes/fresh-sent': changeDoc({ sent: true, sentAt: new Date().toISOString() }),
        'changes/pending': changeDoc(),
    });
    assert.deepEqual(await cleanupOldChanges(2), { deleted: 1, errors: 0 });
    assert.deepEqual(db._paths('changes').sort(), ['changes/fresh-sent', 'changes/old-unsent', 'changes/pending']);
    assert.deepEqual(await cleanupOldChanges(2), { deleted: 0, errors: 0 });
});

test('dotaz na sledující selže (chybí index) → záložní průchod všemi uživateli vybere stejné příjemce', async (t) => {
    quiet(t);
    reset({
        'users/u1': user(['t1']),
        'users/next': user(['t-next'], { watched: { ...TT, scheduleType: 'Next' } }),
        'users/other': user(['t-other'], { watched: { type: 'Room', id: 'ZL', scheduleType: 'Actual' } }),
        'changes/c1': changeDoc(),
    });
    t.after(() => { delete db._failQuery; });
    db._failQuery = ({ collection, filters }) => (collection === 'users' && filters.some(f => f.field === 'watchedKeys')
        ? Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index'), { code: 9 })
        : null);
    const result = await processPendingChanges();
    assert.deepEqual(result, { processedCount: 1, sentCount: 1 });
    assert.deepEqual(sent.map(m => m.tokens), [['t1']]);
    assert.equal(db._get('changes/c1').sentToUsers, 1);
});
