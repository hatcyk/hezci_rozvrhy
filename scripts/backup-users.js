#!/usr/bin/env node

/**
 * Backup and restore of the `users` collection, before the 2.0 release.
 *
 * The 1.x → 2.0 migration copies users/{anonymous-…} to users/{anon-…} and
 * DELETES the old document (routes/auth.js). Without a copy taken beforehand
 * that cannot be undone. The managed Firestore export needs billing enabled,
 * this script only needs the service account the other jobs use.
 *
 *   node scripts/backup-users.js export <file.json>
 *   node scripts/backup-users.js restore <file.json>          # dry run: counts only
 *   node scripts/backup-users.js restore <file.json> --yes    # writes missing documents
 *
 * The file holds device tokens: keep it outside the repository and delete it
 * once the rollback window is over. Export never overwrites an existing file.
 * Restore only creates documents that do not exist (it never overwrites a
 * user who has changed settings since), Firestore timestamps survive the
 * round trip.
 */

const fs = require('fs');
const path = require('path');
const { Timestamp } = require('firebase-admin/firestore');

const COLLECTION = 'users';
const FORMAT = 'lepsi-rozvrh/users-backup@1';
const TS_KEY = '__timestamp__';

function encodeValue(value) {
    if (value instanceof Timestamp) return { [TS_KEY]: value.toDate().toISOString() };
    if (Array.isArray(value)) return value.map(encodeValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeValue(v)]));
    }
    return value;
}

function decodeValue(value) {
    if (Array.isArray(value)) return value.map(decodeValue);
    if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === TS_KEY) return Timestamp.fromDate(new Date(value[TS_KEY]));
        return Object.fromEntries(keys.map((k) => [k, decodeValue(value[k])]));
    }
    return value;
}

/** Read every users document into a JSON-safe backup object. */
async function exportUsers(db, now = new Date()) {
    const snap = await db.collection(COLLECTION).get();
    const docs = {};
    snap.forEach((doc) => { docs[doc.id] = encodeValue(doc.data()); });
    return { format: FORMAT, collection: COLLECTION, exportedAt: now.toISOString(), count: Object.keys(docs).length, docs };
}

function parseBackup(backup) {
    if (!backup || backup.format !== FORMAT || backup.collection !== COLLECTION || typeof backup.docs !== 'object') {
        throw new Error(`Soubor není záloha ${FORMAT}`);
    }
    const ids = Object.keys(backup.docs);
    if (ids.length !== backup.count) throw new Error(`Záloha je neúplná: ${ids.length} dokumentů, hlavička uvádí ${backup.count}`);
    return ids;
}

/**
 * Put back the documents that are missing now. `write: false` only counts.
 * Existing documents are never touched (`create` fails on them).
 */
async function restoreUsers(db, backup, { write = false } = {}) {
    const ids = parseBackup(backup);
    const result = { total: ids.length, missing: 0, created: 0, existing: 0 };
    const refs = ids.map((id) => db.collection(COLLECTION).doc(id));
    for (let i = 0; i < refs.length; i += 300) {
        const chunk = refs.slice(i, i + 300);
        const snaps = await db.getAll(...chunk);
        for (const snap of snaps) {
            if (snap.exists) { result.existing += 1; continue; }
            result.missing += 1;
            if (!write) continue;
            try {
                await snap.ref.create(decodeValue(backup.docs[snap.id]));
                result.created += 1;
            } catch (error) {
                // 6 = ALREADY_EXISTS: written by the app in the meantime, keep it.
                if (error.code === 6) result.existing += 1;
                else throw error;
            }
        }
    }
    return result;
}

async function main(argv) {
    const [command, file, flag] = argv;
    if (!['export', 'restore'].includes(command) || !file) {
        console.error('Použití: node scripts/backup-users.js export|restore <soubor.json> [--yes]');
        return 2;
    }
    const target = path.resolve(file);

    require('dotenv').config();
    const { initializeFirebaseAdmin } = require('../backend/firebase-admin-init');
    const { db } = initializeFirebaseAdmin();

    if (command === 'export') {
        if (fs.existsSync(target)) {
            console.error(`❌ ${target} už existuje, zálohu nepřepíšu.`);
            return 1;
        }
        const backup = await exportUsers(db);
        fs.writeFileSync(target, JSON.stringify(backup), { mode: 0o600, flag: 'wx' });
        console.log(`✅ Záloha ${backup.count} dokumentů ${COLLECTION} → ${target}`);
        console.log('   Obsahuje tokeny zařízení: nenechávej ji v repozitáři a po skončení okna pro návrat ji smaž.');
        return 0;
    }

    const backup = JSON.parse(fs.readFileSync(target, 'utf8'));
    const write = flag === '--yes';
    const r = await restoreUsers(db, backup, { write });
    console.log(`Záloha z ${backup.exportedAt}: ${r.total} dokumentů, ${r.existing} existuje, ${r.missing} chybí.`);
    console.log(write
        ? `✅ Obnoveno ${r.created} chybějících dokumentů (existující beze změny).`
        : 'Nic se nezapsalo. Chybějící dokumenty obnovíš s --yes.');
    return 0;
}

if (require.main === module) {
    main(process.argv.slice(2))
        .then((code) => process.exit(code))
        .catch((error) => {
            console.error('❌ Záloha users selhala:', error.message);
            process.exit(1);
        });
}

module.exports = { exportUsers, restoreUsers, encodeValue, decodeValue, FORMAT };
