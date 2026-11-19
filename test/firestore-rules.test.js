// firestore.rules as text, next to the code that uses Firestore: the browser
// may only `get` single public documents, every collection the server touches
// is listed as server-only, and the client reads nothing else. The rules
// themselves are evaluated by the emulator test (test/rules/, npm run
// test:rules); this file only reads source files, it loads no app code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = ['definitions', 'timetables', 'metadata', 'aggregates'];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const rules = stripComments(read('firestore.rules'));

/** `match /<name>/{docId} { ... }` → { name: body } */
function matchBlocks() {
    const blocks = {};
    for (const m of rules.matchAll(/match \/(\w+)\/\{\w+\} \{([^}]*)\}/g)) {
        assert.ok(!(m[1] in blocks), `${m[1]}: dvakrát v pravidlech`);
        blocks[m[1]] = m[2];
    }
    return blocks;
}

/** Every allow statement: { methods: ['get'], condition: 'signedIn()' } */
const allows = (body) => [...body.matchAll(/allow\s+([\w,\s]+?)\s*:\s*if\s+([^;]+);/g)]
    .map(m => ({ methods: m[1].split(',').map(s => s.trim()), condition: m[2].trim() }));

function jsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...jsFiles(rel));
        else if (entry.name.endsWith('.js')) out.push(rel);
    }
    return out;
}

/** Collections the server code names, with constants such as RUNS_COLLECTION resolved. */
function serverCollections() {
    const found = new Set();
    for (const file of [...jsFiles('backend'), ...jsFiles('routes'), ...jsFiles('scripts'), 'index.js']) {
        const src = stripComments(read(file));
        for (const m of src.matchAll(/\.collection\(\s*([^)]*?)\s*\)/g)) {
            const arg = m[1];
            const literal = arg.match(/^['"`]([\w-]+)['"`]$/);
            const constant = arg.match(/^([A-Z_]+)(\[0\])?$/);
            let name = literal && literal[1];
            if (constant) {
                const def = src.match(new RegExp(`const ${constant[1]} = \\[?\\s*'([\\w-]+)'`));
                name = def && def[1];
            }
            assert.ok(name, `${file}: kolekci .collection(${arg}) neumím určit, doplň ji do testu i do firestore.rules`);
            found.add(name);
        }
        for (const m of src.matchAll(/\.doc\(\s*['"`]([\w-]+)\//g)) found.add(m[1]);
        assert.doesNotMatch(src, /collectionGroup\(/, `${file}: collectionGroup potřebuje vlastní pravidlo`);
    }
    return found;
}

test('firestore.rules: prohlížeč smí jen get jednotlivých veřejných dokumentů, nic jiného', () => {
    const blocks = matchBlocks();
    for (const c of PUBLIC) {
        assert.ok(blocks[c], `${c}: chybí match`);
        assert.deepEqual(allows(blocks[c]), [
            { methods: ['get'], condition: 'signedIn()' },
            { methods: ['write'], condition: 'false' },
        ], `${c}: jen "allow get: if signedIn()" a "allow write: if false" (read by povolil i list = celou kolekci)`);
    }
    // anything granted outside the four public collections is a hole
    for (const a of allows(rules)) {
        if (a.condition === 'false') continue;
        assert.deepEqual(a, { methods: ['get'], condition: 'signedIn()' }, `nečekané povolení: ${JSON.stringify(a)}`);
    }
    assert.equal(allows(rules).filter(a => a.condition !== 'false').length, PUBLIC.length);
    assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/, 'chybí závěrečné „zakázat vše“');
});

test('firestore.rules: users a všechny serverové kolekce jsou výslovně zavřené', () => {
    const blocks = matchBlocks();
    const server = serverCollections();
    // sanity: the scan does see the collections we know about
    for (const c of ['users', 'userMigrations', 'changes', 'lesson_notifications_sent', 'runs', 'system', 'audit', ...PUBLIC]) {
        assert.ok(server.has(c), `${c}: sken kódu serveru ho nenašel`);
    }
    for (const c of server) {
        assert.ok(blocks[c], `${c}: server ji používá, ale ve firestore.rules nemá vlastní match`);
        if (PUBLIC.includes(c)) continue;
        assert.deepEqual(allows(blocks[c]), [{ methods: ['read', 'write'], condition: 'false' }], `${c}: má být "allow read, write: if false"`);
    }
    for (const c of Object.keys(blocks)) {
        assert.ok(server.has(c), `${c}: v pravidlech je, ale server ji nepoužívá (překlep?)`);
    }
});

test('klient čte Firestore jen po jednotlivých dokumentech veřejných kolekcí', () => {
    const files = [...jsFiles('public/js'), ...jsFiles('public/admin'), 'public/firebase-messaging-sw.js']
        .filter(f => f !== path.join('public', 'js', 'app.js')); // the bundle, built from these sources
    const read_ = new Set();
    for (const file of files) {
        const src = stripComments(read(file));
        for (const m of src.matchAll(/\.collection\(([^)]*)\)(\.\w+\()?/g)) {
            const name = m[1].match(/^['"`]([\w-]+)['"`]$/);
            assert.ok(name, `${file}: .collection(${m[1]})`);
            assert.equal(m[2], '.doc(', `${file}: ${name[1]} se čte jinak než jedním dokumentem (dotaz/list pravidla zakazují)`);
            assert.ok(PUBLIC.includes(name[1]), `${file}: ${name[1]} není veřejná kolekce`);
            read_.add(name[1]);
        }
        assert.doesNotMatch(src, /collectionGroup\(|\.where\(|\.orderBy\(/, `${file}: dotaz na Firestore`);
    }
    assert.deepEqual([...read_].sort(), [...PUBLIC].sort());
});
