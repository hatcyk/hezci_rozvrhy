// The app runs on any domain without code changes (a custom domain such as
// rozvrh.<school or own domain> next to, or instead of, *.vercel.app):
// - a job whose VERCEL_URL answers with a redirect (an old domain that now
//   redirects to the new one) fails instead of passing without doing anything.
// Only 127.0.0.1 is contacted (a local server stands in for the app).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// ---- scheduled jobs against a redirect ---------------------------------------

const WF_DIR = path.join(ROOT, '.github', 'workflows');

/** The `run: |` script of the step `- name: <name>` (as bash would get it). */
function runScript(file, name) {
    const src = fs.readFileSync(path.join(WF_DIR, file), 'utf8');
    const lines = src.split('\n');
    const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
    assert.ok(start >= 0, `${file}: krok "${name}" nenalezen`);
    const indent = lines[start].indexOf('-');
    const runAt = lines.findIndex((l, i) => i > start && /^\s+run: \|\s*$/.test(l));
    assert.ok(runAt > start, `${file}: krok "${name}" nemá run: |`);
    const body = [];
    for (let i = runAt + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.trim() && l.search(/\S/) <= indent) break;
        body.push(l);
    }
    const strip = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
    const script = body.map((l) => l.slice(strip)).join('\n');
    assert.doesNotMatch(script, /\$\{\{/, 'skript bere hodnoty z env, ne z ${{ }}');
    return script;
}

function startServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => resolve({
            base: `http://127.0.0.1:${server.address().port}`,
            close: () => new Promise((r) => server.close(r)),
        }));
    });
}

function bash(script, env) {
    return new Promise((resolve) => {
        const child = spawn('bash', ['-e', '-o', 'pipefail', '-c', script], { env: { PATH: process.env.PATH, ...env } });
        let out = '';
        child.stdout.on('data', (c) => { out += c; });
        child.stderr.on('data', (c) => { out += c; });
        child.on('close', (code) => resolve({ code, out }));
    });
}

const JOBS = [
    ['check-status.yml', 'Check data freshness', '/api/status?strict=1'],
    ['prefetch.yml', 'Process notifications after prefetch', '/api/cron/process-notifications'],
];

for (const [file, name, endpoint] of JOBS) {
    test(`${file}: přesměrování adresy VERCEL_URL krok shodí (dřív prošel s HTTP 308 a nic neudělal)`, async (t) => {
        if (spawnSync('curl', ['--version']).status !== 0 || spawnSync('bash', ['--version']).status !== 0) {
            return t.skip('curl nebo bash není k dispozici');
        }
        const script = runScript(file, name);
        const seen = [];
        const app = await startServer((req, res) => {
            seen.push(`${req.method} ${req.url} ${req.headers.authorization || '-'}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        });
        // The old domain: Vercel's domain redirect answers 308 with the new address.
        const old = await startServer((req, res) => {
            res.writeHead(308, { Location: `${app.base}${req.url}` });
            res.end('Redirecting...');
        });
        try {
            const env = { CRON_SECRET: 'test-secret' };
            const ok = await bash(script, { ...env, BASE_URL: app.base });
            assert.equal(ok.code, 0, `správná adresa projde:\n${ok.out}`);
            assert.deepEqual(seen.map((s) => s.split(' ')[1]), [endpoint]);

            seen.length = 0;
            const moved = await bash(script, { ...env, BASE_URL: old.base });
            assert.notEqual(moved.code, 0, `přesměrování musí krok shodit:\n${moved.out}`);
            assert.deepEqual(seen, [], 'za přesměrováním se nic nevolá (Authorization by se ani nepředal)');
        } finally {
            await app.close();
            await old.close();
        }
    });
}
