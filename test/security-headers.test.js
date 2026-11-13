// Security headers (Express + vercel.json), CSP hashes of the inline scripts,
// the CSP report endpoint and the /admin route.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stubFirebase, listen } = require('./helpers/fake-firestore');

process.env.NODE_ENV = 'test';
stubFirebase();

const sec = require('../backend/security-headers');
const { isInSync, syncedVercelConfig, VERCEL_JSON } = require('../tools/csp-hashes');
const { createApp } = require('../routes');
const { createCspReportRouter, MAX_REPORTS_PER_MINUTE } = require('../routes/csp-report');

const INDEX_HTML = fs.readFileSync(sec.DEFAULT_INDEX_HTML, 'utf8');
const vercel = JSON.parse(fs.readFileSync(VERCEL_JSON, 'utf8'));

test('inlineScriptHashes: hash podle CSP (příklad ze specifikace), skripty se src přeskočí', () => {
    const html = `<script>alert('Hello, world.');</script><script src="/a.js"></script><script type="module" src="x"></script>`;
    assert.deepEqual(sec.inlineScriptHashes(html), ["'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='"]);
    // whitespace is part of the hashed text
    assert.notDeepEqual(sec.inlineScriptHashes('<script> a </script>'), sec.inlineScriptHashes('<script>a</script>'));
});

test('CSP aplikace pokrývá všechny inline skripty a skutečné zdroje index.html', () => {
    const hashes = sec.inlineScriptHashes(INDEX_HTML);
    assert.ok(hashes.length >= 1);
    const csp = sec.buildAppCsp({ scriptHashes: hashes });
    for (const h of hashes) assert.ok(csp.includes(h), h);
    // every external script / stylesheet / dynamic import host of index.html is allowed
    const hosts = new Set([...INDEX_HTML.matchAll(/(?:src|href)="(https:\/\/[^/"]+)|import\('(https:\/\/[^/']+)/g)].map(m => m[1] || m[2]));
    const allowed = ['https://www.gstatic.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net', 'https://github.com', 'https://sunrisesunset.io'];
    for (const host of hosts) assert.ok(allowed.includes(host), `unexpected host in index.html: ${host}`);
    for (const src of ['https://firestore.googleapis.com', 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com',
        'https://fcmregistrations.googleapis.com', 'https://api.sunrisesunset.io', 'https://vitals.vercel-insights.com']) {
        assert.match(csp, new RegExp(`connect-src[^;]*${src.replace(/\./g, '\\.')}`), src);
    }
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.ok(!/'unsafe-inline'[^;]*;/.test(csp.split('; ').find(d => d.startsWith('script-src'))), 'no unsafe-inline for scripts');
});

test('vercel.json má stejné hlavičky jako Express (po změně inline skriptu: node tools/csp-hashes.js --write)', () => {
    const rules = sec.vercelHeaderRules({ scriptHashes: sec.inlineScriptHashes(INDEX_HTML) });
    assert.ok(isInSync(vercel, rules),
        'CSP hashe ve vercel.json neodpovídají inline skriptům v public/index.html – spusť `node tools/csp-hashes.js --write`');
    assert.deepEqual(vercel.rewrites, [{ source: '/admin', destination: '/admin.html' }]);
    // cache rules stay in front of the security rules
    assert.equal(vercel.headers[0].source, '/css/app.css');
});

test('syncedVercelConfig nahradí jen spravovaná pravidla', () => {
    const config = { headers: [{ source: '/x', headers: [] }, { source: '/(.*)', headers: [{ key: 'Old', value: '1' }] }] };
    const rules = [{ source: '/(.*)', headers: [{ key: 'New', value: '2' }] }];
    assert.deepEqual(syncedVercelConfig(config, rules).headers, [{ source: '/x', headers: [] }, rules[0]]);
    assert.equal(isInSync(config, rules), false);
});

let base, close;
const staticDir = path.join(__dirname, '..', 'public');
test.before(async () => { ({ base, close } = await listen(createApp({ staticDir }))); });
test.after(() => close());

test('Express: hlavičky na API i statických souborech, CSP report-only se stejnými hashi', async () => {
    for (const p of ['/api/ical/Hacker/x.ics', '/manifest.webmanifest', '/']) {
        const r = await fetch(base + p);
        assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
        assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', p);
        assert.equal(r.headers.get('x-frame-options'), 'DENY', p);
        assert.equal(r.headers.get('permissions-policy'), sec.PERMISSIONS_POLICY, p);
        assert.equal(r.headers.get('content-security-policy-report-only'), sec.buildAppCsp({ scriptHashes: sec.inlineScriptHashes(INDEX_HTML) }), p);
        assert.equal(r.headers.get('content-security-policy'), null, `${p}: app policy is report-only`);
    }
});

test('/admin vrátí admin stránku s vynucenou CSP a noindex', async () => {
    for (const p of ['/admin', '/admin.html', '/admin/admin.js']) {
        const r = await fetch(base + p);
        assert.equal(r.status, 200, p);
        assert.equal(r.headers.get('content-security-policy'), sec.ADMIN_CSP, p);
        assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow', p);
    }
    const page = await (await fetch(base + '/admin')).text();
    assert.match(page, /Lepší Rozvrh – správa/);
    assert.match((await fetch(base + '/admin/admin.js')).headers.get('content-type'), /javascript/);
});

test('/api/csp-report: 204, jeden řádek do logu bez query, strop na minutu', async () => {
    const lines = [];
    const express = require('express');
    const app = express();
    let now = 0;
    app.use('/api', createCspReportRouter({ log: (l) => lines.push(l), now: () => now }));
    const local = await listen(app);
    try {
        const report = { 'csp-report': { 'document-uri': 'https://spsd-rozvrhy.vercel.app/?type=Teacher&id=UXYZ', 'violated-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?token=1' } };
        const send = (body, type = 'application/csp-report') => fetch(local.base + '/api/csp-report', { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body) });
        assert.equal((await send(report)).status, 204);
        assert.equal(lines.length, 1);
        assert.match(lines[0], /script-src-elem blocked=https:\/\/evil\.example\/x\.js page=https:\/\/spsd-rozvrhy\.vercel\.app\//);
        assert.ok(!lines[0].includes('UXYZ') && !lines[0].includes('token'), 'no query strings in the log');

        const reportingApi = [{ type: 'csp-violation', body: { effectiveDirective: 'connect-src', blockedURL: 'https://x.example/a', documentURL: 'https://spsd-rozvrhy.vercel.app/' } }];
        assert.equal((await send(reportingApi, 'application/reports+json')).status, 204);
        assert.match(lines[1], /connect-src blocked=https:\/\/x\.example\/a/);

        for (let i = 0; i < MAX_REPORTS_PER_MINUTE + 5; i++) await send(report);
        assert.equal(lines.length, MAX_REPORTS_PER_MINUTE, 'capped');
        now = 61000;
        await send(report);
        assert.equal(lines.length, MAX_REPORTS_PER_MINUTE + 1, 'next minute logs again');
        assert.equal((await send('x'.repeat(20000))).status, 413);
    } finally {
        await local.close();
    }
});
