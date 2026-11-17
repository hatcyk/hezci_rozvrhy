/**
 * Third-party code of the page (public/index.html):
 * - index.html, the service worker and the CSP name one and the same SDK version;
 * - Vercel Web Analytics and Speed Insights come from this origin (/_vercel/*),
 *   after the load event, never from a public npm CDN.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { FIREBASE_SDK_BASE } = require('../backend/security-headers');

const PUBLIC = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(PUBLIC, 'firebase-messaging-sw.js'), 'utf8');

const GSTATIC_SCRIPT = /<script\b([^>]*\bsrc="(https:\/\/www\.gstatic\.com\/[^"]+)"[^>]*)><\/script>/g;
const sdkScripts = [...html.matchAll(GSTATIC_SCRIPT)].map((m) => ({ attrs: m[1], src: m[2] }));
const versionOf = (url) => (/\/firebasejs\/(\d+\.\d+\.\d+)\//.exec(url) || [])[1];

test('index.html, the service worker and the CSP use the same Firebase SDK version', () => {
    const htmlVersions = new Set(sdkScripts.map((s) => versionOf(s.src)));
    const swUrls = [...sw.matchAll(/https:\/\/www\.gstatic\.com\/[^'"\s]+/g)].map((m) => m[0]);
    assert.ok(swUrls.length >= 6, 'importScripts + the precache list');
    const swVersions = new Set(swUrls.map(versionOf));
    assert.equal(htmlVersions.size, 1, `index.html: ${[...htmlVersions]}`);
    assert.deepEqual([...swVersions], [...htmlVersions], 'service worker and index.html');
    assert.equal(versionOf(FIREBASE_SDK_BASE), [...htmlVersions][0], 'backend/security-headers.js FIREBASE_SDK_BASE');
    for (const url of [...swUrls, ...sdkScripts.map((s) => s.src)]) assert.ok(url.startsWith(FIREBASE_SDK_BASE), url);

    // the worker precaches exactly the scripts the page loads
    const precache = /const CROSS_ORIGIN_PRECACHE = \[([\s\S]*?)\];/.exec(sw)[1].match(/https:[^']+/g);
    assert.deepEqual(precache, sdkScripts.map((s) => s.src));
});

test('index.html loads no code from public npm CDNs', () => {
    assert.ok(!/cdn\.jsdelivr\.net|unpkg\.com|va\.vercel-scripts\.com/.test(html));
    assert.ok(!/\bimport\(\s*['"]https?:/.test(html), 'no dynamic import() of a remote module (no SRI possible)');
});

/** Runs the inline analytics loader of index.html against a minimal window. */
function runAnalyticsLoader() {
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const code = inline.filter((c) => c.includes('/_vercel/'));
    assert.equal(code.length, 1, 'one inline loader');
    const listeners = {};
    const idle = [];
    const appended = [];
    const window = {
        addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
        requestIdleCallback: (fn) => idle.push(fn),
    };
    const document = {
        createElement: (tag) => ({ tagName: tag.toUpperCase(), dataset: {} }),
        head: { appendChild: (el) => appended.push(el) },
        body: { appendChild: (el) => appended.push(el) },
    };
    window.window = window;
    window.document = document;
    vm.runInNewContext(code[0], window);
    return { window, listeners, idle, appended };
}

test('Vercel Analytics and Speed Insights: own origin, deferred, only after load and an idle moment', () => {
    const { window, listeners, idle, appended } = runAnalyticsLoader();
    assert.equal(appended.length, 0, 'nothing on the critical path');
    for (const fn of listeners.load || []) fn();
    assert.equal(appended.length, 0, 'waits for an idle moment after load');
    assert.equal(idle.length, 1);
    idle[0]();
    assert.deepEqual(appended.map((s) => s.src).sort(), ['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js']);
    for (const script of appended) {
        assert.equal(script.tagName, 'SCRIPT');
        assert.equal(script.defer, true, script.src);
    }
    // the queues of the Vercel snippet: calls before the script arrives are kept
    window.va('event', { name: 'x' });
    window.si('beforeSend', 'y');
    assert.deepEqual(Array.from(window.vaq[0]), ['event', { name: 'x' }]);
    assert.deepEqual(Array.from(window.siq[0]), ['beforeSend', 'y']);
});
