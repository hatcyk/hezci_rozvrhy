// .gitignore keeps keys and local env files out of the (public) repository,
// asked of git itself (`git check-ignore --no-index`: the patterns, whether or
// not such a file exists or is tracked). The user's global excludes are switched
// off, so only the repository's .gitignore counts.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/** path → the .gitignore pattern that decides it ('' = none) */
function checkIgnore(paths) {
    const out = spawnSync('git', ['-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '--verbose', '--non-matching', '--stdin'], {
        cwd: ROOT, input: paths.join('\n') + '\n', encoding: 'utf8',
        env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
    if (out.error || out.status > 1) return null;
    const result = {};
    for (const line of out.stdout.split('\n').filter(Boolean)) {
        const [source, pathname] = line.split('\t');
        const [file, , pattern] = source.split(':');
        result[pathname] = pattern ? { file, pattern } : null;
    }
    return result;
}
const ignored = (m) => Boolean(m && !m.pattern.startsWith('!'));

test('.gitignore: klíče servisního účtu, místní .env.* a výstup pokrytí se necommitnou', (t) => {
    const mustIgnore = [
        'barat-bakalari-firebase-adminsdk-abc12-0123456789.json', // default name of a key downloaded from the console
        'keys/barat-bakalari-firebase-adminsdk-abc12-0123456789.json',
        'firebase-service-account.json',
        '.env', '.env.local', '.env.production', '.env.development.local',
        'lcov.info', 'coverage/lcov.info', 'coverage/index.html',
    ];
    const mustTrack = ['.env.example', 'package.json', 'firestore.rules', 'firebase.json', 'test/rules/firestore-rules.emulator.test.mjs'];
    const res = checkIgnore([...mustIgnore, ...mustTrack]);
    if (!res) return t.skip('git není k dispozici (ne v repozitáři)');
    for (const p of mustIgnore) {
        assert.ok(ignored(res[p]), `${p} se musí ignorovat`);
        assert.equal(res[p].file, '.gitignore', p);
    }
    for (const p of mustTrack) assert.ok(!ignored(res[p]), `${p} se nesmí ignorovat (${res[p] && res[p].pattern})`);
});
