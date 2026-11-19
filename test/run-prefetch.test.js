// scripts/run-prefetch.js as a real process: which run status ends with which
// exit code. The exit code is what .github/workflows/prefetch.yml acts on.
// Firebase, Bakaláři and dotenv are stand-ins (test/helpers/run-prefetch-preload.js),
// the network is cut off in the child process.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PRELOAD = path.join(__dirname, 'helpers', 'run-prefetch-preload.js');

function runScript(env) {
    const out = spawnSync(process.execPath, ['-r', PRELOAD, path.join(ROOT, 'scripts', 'run-prefetch.js')], {
        cwd: ROOT, encoding: 'utf8', timeout: 30000,
        env: { PATH: process.env.PATH, NODE_OPTIONS: '', ...env },
    });
    return { code: out.status, text: `${out.stdout}${out.stderr}` };
}

test('run-prefetch: úspěch a očekávané výpadky Bakalářů končí kódem 0, chyba skriptu kódem 1', () => {
    const expected = {
        ok: 0,
        // partial: what did download is stored, its changes wait for the notification step
        partial: 0,
        guard_no_definitions: 0,
        guard_no_lessons: 0,
        login_failed: 0,
        network: 0,
        error: 1,
        something_new: 1,
    };
    for (const [status, code] of Object.entries(expected)) {
        const { code: actual, text } = runScript({ FAKE_RUN_STATUS: status });
        assert.equal(actual, code, `${status}\n${text}`);
        assert.match(text, new RegExp(`Prefetch status: ${status} `));
        assert.equal(/not a script error/.test(text), code === 0 && status !== 'ok', status);
    }
});

test('run-prefetch: nejde spustit Firebase nebo běh vyhodí výjimku → kód 1', () => {
    const init = runScript({ FAKE_RUN_STATUS: 'ok', FAKE_INIT_FAILS: '1' });
    assert.equal(init.code, 1);
    assert.match(init.text, /Firebase Admin init failed/);
    assert.equal(runScript({ FAKE_RUN_STATUS: 'throws' }).code, 1);
});

test('workflow: změny se odešlou jen po kroku sběru s kódem 0 – proto partial nesmí vracet 1', () => {
    // Read-only check of the assumption behind `partial: 0` above. With exit 1
    // the changes a partial run did store would wait for the next run that
    // ends well, and GitHub would mail a failure every 15 minutes of an outage
    // that /api/status already reports (lastSuccessAt does not move).
    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'prefetch.yml'), 'utf8');
    const steps = workflow.split(/\n {6}- name: /).slice(1);
    const prefetch = steps.findIndex(step => /run: node scripts\/run-prefetch\.js/.test(step));
    const notify = steps.findIndex(step => /api\/cron\/process-notifications/.test(step));
    assert.ok(prefetch >= 0 && notify > prefetch, 'the notification step follows the prefetch step');
    assert.match(steps[notify], /^Process notifications after prefetch\n\s+if: success\(\)/);
    assert.doesNotMatch(steps[prefetch], /continue-on-error/);
});
