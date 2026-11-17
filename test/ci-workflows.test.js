// GitHub Actions configuration (.github/), read as text: pinned actions,
// least-privilege tokens, the prefetch job that holds the production secrets,
// and the emulator job for firestore.rules. Nothing is executed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');
const workflows = Object.fromEntries(fs.readdirSync(WF_DIR)
    .filter(f => f.endsWith('.yml'))
    .map(f => [f, fs.readFileSync(path.join(WF_DIR, f), 'utf8')]));

/** Text of the step `- name: <name>` up to the next step. */
function step(src, name) {
    const start = src.indexOf(`- name: ${name}`);
    assert.ok(start >= 0, `step "${name}" not found`);
    const next = src.indexOf('\n      - ', start + 1);
    return src.slice(start, next < 0 ? undefined : next);
}

test('workflows: každá akce je připnutá na celé SHA s komentářem verze', () => {
    let count = 0;
    for (const [file, src] of Object.entries(workflows)) {
        for (const m of src.matchAll(/^\s*-?\s*uses:\s*(.+)$/gm)) {
            count++;
            assert.match(m[1], /^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, `${file}: ${m[1]}`);
        }
    }
    assert.ok(count >= 8, `jen ${count} použití akcí - čte test správné soubory?`);
});

test('workflows: každý má blok permissions, volání cronu bez repa dostanou {}', () => {
    for (const [file, src] of Object.entries(workflows)) {
        assert.match(src, /^permissions:/m, `${file}: chybí permissions (jinak platí výchozí práva tokenu repozitáře)`);
    }
    for (const file of ['cleanup.yml', 'lesson-reminders.yml', 'process-notifications.yml']) {
        assert.match(workflows[file], /^permissions: \{\}$/m, file);
        assert.doesNotMatch(workflows[file], /actions\/checkout/, `${file}: s checkoutem potřebuje contents: read`);
    }
});

test('dependabot hlídá verze akcí', () => {
    const src = fs.readFileSync(path.join(ROOT, '.github', 'dependabot.yml'), 'utf8');
    assert.match(src, /^version: 2$/m);
    assert.match(src, /package-ecosystem: ['"]?github-actions['"]?\s+directory: ['"]?\/['"]?\s+schedule:\s+interval: ['"]?monthly/);
});

test('prefetch.yml: instalace bez skriptů balíčků', () => {
    const src = workflows['prefetch.yml'];
    // install scripts would run in the job that later gets BAKALARI_PASSWORD and the service account
    assert.match(step(src, 'Install dependencies'), /run: npm ci --omit=dev --ignore-scripts$/m);
});

test('rules.yml: emulátor pravidel při změně pravidel nebo jejich testu', () => {
    const src = workflows['rules.yml'];
    assert.ok(src, 'chybí .github/workflows/rules.yml');
    assert.match(src, /^ {2}push:\n {4}branches: \[dev, main\]\n {4}paths:/m);
    assert.match(src, /^ {2}pull_request:\n {4}paths:/m);
    for (const p of ['firestore.rules', "'test/rules/**'", '.github/workflows/rules.yml']) {
        assert.equal(src.split(`      - ${p}\n`).length - 1, 2, `${p}: v paths u push i pull_request`);
    }
    assert.match(src, /^permissions:\n {2}contents: read$/m);
    assert.match(src, /distribution: temurin\s+java-version: '21'/);
    assert.match(src, /npm i --no-save --no-package-lock[^\n]*\n\s*@firebase\/rules-unit-testing@6\.0\.0 firebase@13\.1\.0 firebase-tools@15\.34\.2/);
    assert.match(src, /run: npm run test:rules$/m);

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const script = pkg.scripts['test:rules'];
    assert.match(script, /^firebase emulators:exec --only firestore --project demo-lepsi-rozvrh /, 'jen projekt demo-* (nikdy skutečný Firebase)');
    assert.match(script, /node --test test\/rules\/firestore-rules\.emulator\.test\.mjs/);
    // the emulator test needs Java and packages that are not dependencies: keep it out of npm test
    assert.doesNotMatch('test/rules/firestore-rules.emulator.test.mjs', /\.test\.js$/);
    for (const dep of ['@firebase/rules-unit-testing', 'firebase', 'firebase-tools']) {
        assert.ok(!(dep in (pkg.dependencies || {})) && !(dep in (pkg.devDependencies || {})), `${dep} nepatří do package.json`);
    }
});
