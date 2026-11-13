// Test of firestore.rules against the local Firestore emulator (NOT run by npm test).
//
// Setup (once; needs Java for the emulator):
//   npm i -D @firebase/rules-unit-testing@6 firebase@13
// The .mjs extension keeps it out of `npm test` (glob test/**/*.test.js).
// Run (starts the emulator, runs the test, stops it):
//   npx firebase-tools emulators:exec --only firestore --project demo-lepsi-rozvrh \
//     "node --test test/rules/firestore-rules.emulator.test.mjs"
// "demo-" project IDs never touch a real Firebase project.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';

const ME = 'anon-0b7f6c1e-8a1d-4c3b-9f2e-1a2b3c4d5e6f';
const OTHER = 'anon-1c8e7d2f-9b2e-4d4c-8a3f-2b3c4d5e6f70';

let env;
test.before(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-lepsi-rozvrh',
        firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    });
    // Seed data the way the server (Admin SDK) would, bypassing the rules.
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'definitions/current'), { classes: [] });
        await setDoc(doc(db, 'timetables/Class_ZL_Actual'), { data: [] });
        await setDoc(doc(db, 'metadata/lastPrefetch'), { timestamp: 'x' });
        await setDoc(doc(db, 'aggregates/changes_Actual'), { days: [] });
        await setDoc(doc(db, `users/${ME}`), { tokens: ['t'] });
        await setDoc(doc(db, `users/${OTHER}`), { tokens: ['t2'] });
        for (const p of ['runs/r1', 'system/health', 'changes/c1', 'audit/a1', 'lesson_notifications_sent/n1']) {
            await setDoc(doc(db, p), { x: 1 });
        }
    });
});
test.after(() => env.cleanup());

test('nepřihlášený nečte nic', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'definitions/current')));
    await assertFails(getDoc(doc(db, 'timetables/Class_ZL_Actual')));
});

test('přihlášený čte rozvrhová data, ale nezapisuje', async () => {
    const db = env.authenticatedContext(ME).firestore();
    for (const p of ['definitions/current', 'timetables/Class_ZL_Actual', 'metadata/lastPrefetch', 'aggregates/changes_Actual']) {
        await assertSucceeds(getDoc(doc(db, p)));
        await assertFails(setDoc(doc(db, p), { hacked: true }));
    }
});

test('users: jen vlastní dokument, jen čtení, žádný výpis', async () => {
    const db = env.authenticatedContext(ME).firestore();
    await assertSucceeds(getDoc(doc(db, `users/${ME}`)));
    await assertFails(getDoc(doc(db, `users/${OTHER}`)));
    await assertFails(getDocs(collection(db, 'users')));
    await assertFails(setDoc(doc(db, `users/${ME}`), { tokens: [] }));
});

test('serverové kolekce klient nečte', async () => {
    const db = env.authenticatedContext(ME).firestore();
    for (const p of ['runs/r1', 'system/health', 'changes/c1', 'audit/a1', 'lesson_notifications_sent/n1']) {
        await assertFails(getDoc(doc(db, p)));
    }
});
