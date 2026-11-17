/**
 * Third-party code of the page (public/index.html):
 * - the Firebase SDK from gstatic carries Subresource Integrity, so a changed
 *   file - on the CDN or planted in the service worker cache - does not run;
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
const attr = (attrs, name) => (new RegExp(`\\b${name}(?:="([^"]*)")?(?=[\\s>]|$)`).exec(attrs) || [])[1];
const has = (attrs, name) => new RegExp(`\\b${name}\\b`).test(attrs);

const sdkScripts = [...html.matchAll(GSTATIC_SCRIPT)].map((m) => ({ attrs: m[1], src: m[2] }));
const versionOf = (url) => (/\/firebasejs\/(\d+\.\d+\.\d+)\//.exec(url) || [])[1];

test('every gstatic script of index.html has integrity (sha384) and crossorigin="anonymous"', () => {
    assert.deepEqual(sdkScripts.map((s) => s.src.split('/').pop()),
        ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js', 'firebase-messaging-compat.js']);
    for (const { attrs, src } of sdkScripts) {
        const integrity = attr(attrs, 'integrity');
        assert.match(integrity || '', /^sha384-[A-Za-z0-9+/]{64}$/, `${src}: integrity`);
        assert.equal(Buffer.from(integrity.slice(7), 'base64').length, 48, `${src}: a SHA-384 digest`);
        // without CORS the response is opaque and the browser cannot check the hash
        assert.equal(attr(attrs, 'crossorigin'), 'anonymous', `${src}: crossorigin`);
        assert.ok(has(attrs, 'defer'), `${src}: stays deferred, in order before the app module`);
    }
    assert.equal(new Set(sdkScripts.map((s) => attr(s.attrs, 'integrity'))).size, sdkScripts.length, 'one hash per file');
    // nothing else of the page is loaded from gstatic without a hash
    assert.equal((html.match(/www\.gstatic\.com/g) || []).length, sdkScripts.length);
});

test('index.html, the service worker and the CSP use the same Firebase SDK version', () => {
    const htmlVersions = new Set(sdkScripts.map((s) => versionOf(s.src)));
    const swUrls = [...sw.matchAll(/https:\/\/www\.gstatic\.com\/[^'"\s]+/g)].map((m) => m[0]);
    assert.ok(swUrls.length >= 6, 'importScripts + the precache list');
    const swVersions = new Set(swUrls.map(versionOf));
    assert.equal(htmlVersions.size, 1, `index.html: ${[...htmlVersions]}`);
    assert.deepEqual([...swVersions], [...htmlVersions], 'service worker and index.html');
    assert.equal(versionOf(FIREBASE_SDK_BASE), [...htmlVersions][0], 'backend/security-headers.js FIREBASE_SDK_BASE');
    for (const url of [...swUrls, ...sdkScripts.map((s) => s.src)]) assert.ok(url.startsWith(FIREBASE_SDK_BASE), url);

    // the worker precaches exactly the scripts the page loads (and checks)
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
