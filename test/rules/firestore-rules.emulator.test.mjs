// firestore.rules evaluated by the local Firestore emulator (NOT part of npm test:
// the .mjs extension keeps it out of the test/**/*.test.js glob).
//
// Needs Java 21 and three packages that are deliberately not in package.json
// (exact versions, installed without touching package.json or the lock):
//   npm i --no-save --no-package-lock @firebase/rules-unit-testing@6.0.0 firebase@13.1.0 firebase-tools@15.34.2
// Run (starts the emulator, runs this file, stops it):
//   npm run test:rules
// CI: .github/workflows/rules.yml. The project ID is a "demo-" one: the emulator
// then never talks to a real Firebase project, and nothing here has credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
    collection, collectionGroup, query, where, limit, onSnapshot,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-lepsi-rozvrh';
const ME = 'anon-0b7f6c1e-8a1d-4c3b-9f2e-1a2b3c4d5e6f';
const OTHER = 'anon-1c8e7d2f-9b2e-4d4c-8a3f-2b3c4d5e6f70';

// What the browser reads (public/js/firebase-client.js), one document each.
const PUBLIC_DOCS = ['definitions/current', 'timetables/Class_ZL_Actual', 'metadata/lastPrefetch', 'aggregates/changes_Actual'];
const PUBLIC_COLLECTIONS = ['definitions', 'timetables', 'metadata', 'aggregates'];
// Written and read only by the server (Admin SDK). The last two fall to the
// catch-all: a collection nobody listed, and a subcollection of a public document.
const SERVER_DOCS = [
    `users/${ME}`, `users/${OTHER}`, 'userMigrations/anonymous-1700000000000', 'changes/c1',
    'lesson_notifications_sent/n1', 'runs/r1', 'system/health', 'system/prefetchStatus',
    'system/migrations', 'system/adminDispatch', 'system/permanentRefresh', 'audit/a1',
    'notListed/x1', 'timetables/Class_ZL_Actual/history/h1',
];
const SERVER_COLLECTIONS = ['users', 'userMigrations', 'changes', 'lesson_notifications_sent', 'runs', 'system', 'audit', 'notListed'];

/**
 * First snapshot of a listener confirmed by the server (a cached one does not
 * prove the rules allowed it), the way the kiosk follows aggregates/{id}.
 */
const firstSnapshot = (ref) => new Promise((resolve, reject) => {
    const unsubscribe = onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
        if (snap.metadata.fromCache) return;
        unsubscribe();
        resolve(snap);
    }, reject);
});

let env;
test.before(async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_EMULATOR_HUB) {
        throw new Error('Firestore emulator not running - use `npm run test:rules` (firebase emulators:exec).');
    }
    env = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
    });
    // Seed the way the server (Admin SDK) would, bypassing the rules.
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'definitions/current'), { classes: [], teachers: [], rooms: [] });
        await setDoc(doc(db, 'timetables/Class_ZL_Actual'), { type: 'Class', data: [] });
        await setDoc(doc(db, 'metadata/lastPrefetch'), { timestamp: '2026-11-04T08:00:00Z' });
        await setDoc(doc(db, 'aggregates/changes_Actual'), { days: [] });
        await setDoc(doc(db, `users/${ME}`), { tokens: ['token-me'], hasReminders: true });
        await setDoc(doc(db, `users/${OTHER}`), { tokens: ['token-other'], hasReminders: true });
        for (const p of SERVER_DOCS.filter(p => !p.startsWith('users/'))) {
            await setDoc(doc(db, p), { x: 1 });
        }
    });
});
test.after(async () => { if (env) await env.cleanup(); });

test('nepřihlášený nečte nic a nic nezapíše', async () => {
    const db = env.unauthenticatedContext().firestore();
    for (const p of [...PUBLIC_DOCS, ...SERVER_DOCS]) {
        await assertFails(getDoc(doc(db, p)));
        await assertFails(setDoc(doc(db, p), { hacked: true }));
    }
    for (const c of [...PUBLIC_COLLECTIONS, ...SERVER_COLLECTIONS]) {
        await assertFails(getDocs(collection(db, c)));
    }
    await assertFails(firstSnapshot(doc(db, 'aggregates/changes_Actual')));
});

test('přihlášený: get jednoho veřejného dokumentu projde (i živý odběr dokumentu)', async () => {
    const db = env.authenticatedContext(ME).firestore();
    for (const p of PUBLIC_DOCS) {
        const snap = await assertSucceeds(getDoc(doc(db, p)));
        assert.ok(snap.exists(), p);
    }
    // a timetable that prefetch has not written yet: allowed, just empty
    const missing = await assertSucceeds(getDoc(doc(db, 'timetables/Class_XX_Actual')));
    assert.equal(missing.exists(), false);
    const live = await assertSucceeds(firstSnapshot(doc(db, 'aggregates/changes_Actual')));
    assert.deepEqual(live.data(), { days: [] });
});

test('přihlášený: výpis ani dotaz na veřejnou kolekci neprojde', async () => {
    const db = env.authenticatedContext(ME).firestore();
    for (const c of PUBLIC_COLLECTIONS) {
        await assertFails(getDocs(collection(db, c)));
        await assertFails(getDocs(query(collection(db, c), limit(1))));
        await assertFails(firstSnapshot(collection(db, c)));
    }
    await assertFails(getDocs(query(collection(db, 'timetables'), where('type', '==', 'Class'))));
    await assertFails(getDocs(collectionGroup(db, 'timetables')));
});

test('users: vlastní ani cizí dokument nejde číst, výpis ani dotaz také ne', async () => {
    const db = env.authenticatedContext(ME).firestore();
    await assertFails(getDoc(doc(db, `users/${ME}`)));
    await assertFails(getDoc(doc(db, `users/${OTHER}`)));
    await assertFails(firstSnapshot(doc(db, `users/${ME}`)));
    await assertFails(getDocs(collection(db, 'users')));
    await assertFails(getDocs(query(collection(db, 'users'), where('tokens', 'array-contains', 'token-other'))));
    await assertFails(getDocs(query(collection(db, 'users'), where('hasReminders', '==', true))));
});

test('přihlášený nezapíše nikam: veřejná data, vlastní users ani serverové kolekce', async () => {
    const db = env.authenticatedContext(ME).firestore();
    for (const p of [...PUBLIC_DOCS, ...SERVER_DOCS]) {
        await assertFails(setDoc(doc(db, p), { hacked: true }));
        await assertFails(setDoc(doc(db, p), { hacked: true }, { merge: true }));
        await assertFails(updateDoc(doc(db, p), { hacked: true }));
        await assertFails(deleteDoc(doc(db, p)));
    }
    for (const c of [...PUBLIC_COLLECTIONS, ...SERVER_COLLECTIONS]) {
        await assertFails(addDoc(collection(db, c), { hacked: true }));
    }
    // a brand-new document, e.g. a forged timetable or a second identity
    await assertFails(setDoc(doc(db, 'timetables/Class_NEW_Actual'), { data: [] }));
    await assertFails(setDoc(doc(db, 'users/anon-2d9f8e30-ac3f-4e5d-9b40-3c4d5e6f7081'), { tokens: [] }));
});

test('serverové kolekce přihlášený nečte: get, výpis ani odběr', async () => {
    const db = env.authenticatedContext(ME).firestore();
    for (const p of SERVER_DOCS) {
        await assertFails(getDoc(doc(db, p)));
    }
    for (const c of SERVER_COLLECTIONS) {
        await assertFails(getDocs(collection(db, c)));
        await assertFails(firstSnapshot(collection(db, c)));
    }
    await assertFails(getDocs(collectionGroup(db, 'history')));
});
