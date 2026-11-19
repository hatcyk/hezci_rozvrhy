/**
 * HTTP cache headers of the static files on the CDN (vercel.json): long-lived
 * caching only where the address carries a content hash.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('vercel.json: cache headers match how the files are versioned', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    /** Cache-Control rules whose `source` pattern matches the path. */
    const rulesFor = (p) => vercel.headers.filter((r) => new RegExp(`^${r.source}$`).test(p)
        && r.headers.some((h) => h.key === 'Cache-Control'));
    const cacheControl = (rule) => rule.headers.find((h) => h.key === 'Cache-Control').value;

    // the worker itself is always revalidated, otherwise a deploy would not reach anybody
    assert.deepEqual(rulesFor('/firebase-messaging-sw.js').map(cacheControl), ['no-cache']);

    // immutable only together with the ?v= content hash
    for (const file of ['/css/app.css', '/js/app.js']) {
        const rules = rulesFor(file);
        assert.equal(rules.length, 1, file);
        assert.match(cacheControl(rules[0]), /immutable/);
        assert.deepEqual(rules[0].has, [{ type: 'query', key: 'v' }], `${file}: immutable only for ?v=<hash>`);
    }
    // nothing without a version in its address may be immutable or cached for days
    for (const file of ['/js/app.js.map', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.png', '/screenshots/mobil-rozvrh.png']) {
        for (const rule of rulesFor(file)) {
            const value = cacheControl(rule);
            assert.doesNotMatch(value, /immutable/, file);
            const maxAge = Number((/max-age=(\d+)/.exec(value) || [0, 0])[1]);
            assert.ok(maxAge <= 3600, `${file}: max-age ${maxAge} s is too long for an address without a version`);
        }
    }
    assert.deepEqual(rulesFor('/manifest.webmanifest').map(cacheControl), ['no-cache']);
    assert.deepEqual(rulesFor('/js/app.js.map').map(cacheControl), ['no-cache']);
    // index.html and the sprite keep the CDN default (max-age=0, must-revalidate)
    assert.deepEqual(rulesFor('/index.html'), []);
    assert.deepEqual(rulesFor('/icons.svg'), []);
});
