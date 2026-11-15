/**
 * "A new version is available" notice (public/js/sw-update.js): shown only
 * when a newer service worker has replaced the version the page runs, never
 * reloads by itself.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const OWN = 'bakalari-shell-aaaaaaaaaa-bbbbbbbbbb';
const NEWER = 'bakalari-shell-cccccccccc-dddddddddd';

/** Just enough of a document, service worker container and cache storage. */
function page({ cacheNames = [OWN], css = 'css/app.css?v=aaaaaaaaaa', js = 'js/app.js?v=bbbbbbbbbb', registration } = {}) {
    const listeners = { sw: {}, doc: {}, button: {} };
    const hidden = new Set(['hidden']);
    const env = { cacheNames, reloads: 0, updates: 0, time: 0, visibilityState: 'visible' };
    const banner = { classList: { remove: (c) => hidden.delete(c), contains: (c) => hidden.has(c) } };
    const button = { addEventListener: (type, fn) => { listeners.button[type] = fn; } };
    const attr = (value) => (value ? { getAttribute: () => value } : null);
    const doc = {
        getElementById: (id) => ({ updateBanner: banner, updateReload: button })[id] || null,
        querySelector: (selector) => attr(selector.startsWith('link') ? css : js),
        addEventListener: (type, fn) => { listeners.doc[type] = fn; },
        get visibilityState() { return env.visibilityState; },
    };
    const sw = {
        addEventListener: (type, fn) => { listeners.sw[type] = fn; },
        getRegistration: async () => registration === undefined ? { update: async () => { env.updates++; } } : registration,
    };
    const cacheStorage = { keys: async () => { if (env.cacheNames === null) throw new Error('SecurityError'); return env.cacheNames; } };
    const settle = () => new Promise((r) => setImmediate(r));
    return {
        env, listeners, doc, sw, cacheStorage,
        options: { sw, cacheStorage, doc, reload: () => { env.reloads++; }, now: () => env.time },
        shown: () => !banner.classList.contains('hidden'),
        /** A new worker takes control; `activate` finishes its activation (older caches removed). */
        async controllerChange({ state = 'activated' } = {}) {
            const worker = {
                state, listeners: [],
                addEventListener(type, fn) { this.listeners.push(fn); },
                removeEventListener(type, fn) { this.listeners = this.listeners.filter((f) => f !== fn); },
            };
            sw.controller = worker;
            listeners.sw.controllerchange();
            await settle();
            return {
                worker,
                async activate(after = () => {}) { after(); worker.state = 'activated'; worker.listeners.forEach((fn) => fn()); await settle(); },
            };
        },
        async becomeVisible() { env.visibilityState = 'visible'; listeners.doc.visibilitychange(); await settle(); },
    };
}

test('pageShellCache: cache name from the ?v= hashes of the two bundles (as tools/build.js)', async () => {
    const { pageShellCache } = await import('../public/js/sw-update.js');
    assert.equal(pageShellCache(page().doc), OWN);
    assert.equal(pageShellCache(page({ css: 'css/app.css' }).doc), null, 'no version, no comparison');
    assert.equal(pageShellCache(page({ js: null }).doc), null);

    // the real index.html and the real worker agree
    const css = /href="(css\/app\.css\?v=[a-f0-9]+)"/.exec(html)[1];
    const js = /src="(js\/app\.js\?v=[a-f0-9]+)"/.exec(html)[1];
    const sandbox = { self: { addEventListener() {}, location: {} }, importScripts() {}, console: { log() {} }, URL,
        firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage() {} }) } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'firebase-messaging-sw.js'), 'utf8'), sandbox);
    assert.equal(pageShellCache(page({ css, js }).doc), vm.runInContext('SHELL_CACHE', sandbox));
});

test('isNewerVersionActive: only when shell caches exist and none is the page\'s own', async () => {
    const { isNewerVersionActive } = await import('../public/js/sw-update.js');
    assert.equal(isNewerVersionActive([NEWER], OWN), true);
    assert.equal(isNewerVersionActive([NEWER, 'firebase-x'], OWN), true);
    assert.equal(isNewerVersionActive([OWN], OWN), false);
    assert.equal(isNewerVersionActive([OWN, NEWER], OWN), false, 'new worker still installing: old cache is in use');
    assert.equal(isNewerVersionActive([], OWN), false, 'first visit, nothing cached yet');
    assert.equal(isNewerVersionActive(['firebase-x'], OWN), false);
    assert.equal(isNewerVersionActive([NEWER], null), false);
});

test('first install and a page that already runs the new version: no notice', async () => {
    const { initUpdateNotice } = await import('../public/js/sw-update.js');
    const p = page({ cacheNames: [] });
    initUpdateNotice(p.options);
    p.env.cacheNames = [OWN]; // the worker installed this very version and claimed the page
    await p.controllerChange();
    assert.equal(p.shown(), false);
});

test('a newer worker takes over an open page: the banner offers a reload, nothing reloads by itself', async () => {
    const { initUpdateNotice } = await import('../public/js/sw-update.js');
    const p = page();
    initUpdateNotice(p.options);
    assert.equal(p.shown(), false);
    // The page is taken over while the new worker is still activating: both
    // caches exist. The old one goes at the end of the activation.
    p.env.cacheNames = [OWN, NEWER];
    const takeover = await p.controllerChange({ state: 'activating' });
    assert.equal(p.shown(), false);
    await takeover.activate(() => { p.env.cacheNames = [NEWER]; });
    assert.equal(p.shown(), true);
    assert.equal(takeover.worker.listeners.length, 0, 'listener removed');
    assert.equal(p.env.reloads, 0, 'no automatic reload in the middle of work');
    p.listeners.button.click();
    assert.equal(p.env.reloads, 1);
});

test('a page resumed from the background notices the update and asks for a newer worker at most once an hour', async () => {
    const { initUpdateNotice } = await import('../public/js/sw-update.js');
    const p = page();
    initUpdateNotice(p.options);
    p.env.time = 10 * 60 * 1000;
    await p.becomeVisible();
    assert.equal(p.env.updates, 0, 'the page was loaded 10 minutes ago');
    p.env.time = 61 * 60 * 1000;
    await p.becomeVisible();
    await p.becomeVisible();
    assert.equal(p.env.updates, 1);
    assert.equal(p.shown(), false);
    // going to the background does nothing
    p.env.visibilityState = 'hidden';
    p.env.cacheNames = [NEWER];
    p.listeners.doc.visibilitychange();
    await new Promise((r) => setImmediate(r));
    assert.equal(p.shown(), false);
    await p.becomeVisible();
    assert.equal(p.shown(), true);
});

test('without service workers, cache storage or the banner nothing is wired and nothing throws', async () => {
    const { initUpdateNotice } = await import('../public/js/sw-update.js');
    const p = page();
    initUpdateNotice({ ...p.options, sw: undefined });
    initUpdateNotice({ ...p.options, cacheStorage: undefined });
    initUpdateNotice({ ...p.options, doc: { ...p.doc, getElementById: () => null, querySelector: p.doc.querySelector } });
    assert.deepEqual(p.listeners.sw, {});
    // cache storage that throws (private mode) and a failing update check
    const q = page({ cacheNames: null, registration: { update: async () => { throw new Error('offline'); } } });
    initUpdateNotice(q.options);
    q.env.time = 2 * 60 * 60 * 1000;
    await q.controllerChange();
    await q.becomeVisible();
    assert.equal(q.shown(), false);
});

test('index.html: the notice is a hidden status banner with a real button, Czech text', () => {
    const banner = /<div id="updateBanner"[^>]*>[\s\S]*?<\/div>/.exec(html);
    assert.ok(banner, '#updateBanner');
    assert.match(banner[0], /class="g-banner sh-banner hidden"/);
    assert.match(banner[0], /role="status"/);
    assert.match(banner[0], /Je k dispozici nová verze\./);
    assert.match(banner[0], /<button type="button" class="g-btn g-btn--small" id="updateReload">Obnovit<\/button>/);
    assert.match(banner[0], /<svg class="i" aria-hidden="true">/);
});
