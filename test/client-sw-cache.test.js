/**
 * Service worker app-shell cache (public/firebase-messaging-sw.js): install,
 * activate, fetch strategies and the notification click, run in a node:vm
 * sandbox with fake caches, fetch, timers and clients.
 *
 * - a failed precache fails the install: the old worker and its cache stay;
 * - activate removes only older shell caches (also the names of 1.x);
 * - navigations are network-first with a time limit; the cached shell is
 *   served offline, on a timeout and on a 5xx answer, under the single key "/";
 * - static files are stale-while-revalidate, /api/ is never intercepted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SW_CODE = fs.readFileSync(path.join(PUBLIC, 'firebase-messaging-sw.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const ORIGIN = 'https://rozvrh.test';
const GSTATIC = 'https://www.gstatic.com/firebasejs/9.22.0/';
/** Shell cache of the last 1.x release (origin/main). */
const CACHE_1X = 'bakalari-shell-69505063f4-a1716c3854';

const abs = (u) => new URL(typeof u === 'string' ? u : u.url, ORIGIN).href;
const noSearch = (u) => { const x = new URL(u); x.search = ''; return x.href; };

/** Minimal stand-in for a fetch Response (same-origin responses are "basic"). */
function res(body, { status = 200, type = 'basic' } = {}) {
    return { body, status, type, ok: status >= 200 && status < 300, redirected: false, clone() { return res(body, { status, type }); } };
}

/** Promise that the test settles by hand. */
function deferred() {
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
}

/**
 * Load the worker into a sandbox.
 * @param {object} [o]
 * @param {Record<string, Record<string, any>>} [o.caches] existing caches: name → { url: body }
 * @param {(req: {url: string, path: string, cache?: string, mode?: string}) => any} [o.respond]
 *   network: return a response, a promise, or throw for a network error
 */
function loadSW({ caches: initial = {}, respond = (r) => res(`net:${r.path}`), clientList = [] } = {}) {
    const listeners = {};
    const store = new Map();
    const fetches = [];
    const timers = [];
    const calls = { skipWaiting: 0, claim: 0, opened: [], focused: [], navigated: [], posted: [] };

    class FakeCache {
        constructor() { this.entries = new Map(); }
        async match(request, { ignoreSearch = false } = {}) {
            const key = abs(request);
            if (!ignoreSearch) return this.entries.get(key);
            for (const [k, v] of this.entries) if (noSearch(k) === noSearch(key)) return v;
            return undefined;
        }
        async put(request, response) { this.entries.set(abs(request), response); }
        // Atomic like the real one: nothing is stored unless every request succeeds
        async addAll(requests) {
            const responses = await Promise.all(requests.map(async (r) => {
                const response = await sandbox.fetch(r);
                if (!response.ok) throw new TypeError(`addAll: ${abs(r)} answered ${response.status}`);
                return response;
            }));
            requests.forEach((r, i) => this.entries.set(abs(r), responses[i]));
        }
        keys() { return [...this.entries.keys()]; }
    }
    for (const [name, files] of Object.entries(initial)) {
        const cache = new FakeCache();
        for (const [url, body] of Object.entries(files)) cache.entries.set(abs(url), res(body));
        store.set(name, cache);
    }
    const caches = {
        async open(name) { if (!store.has(name)) store.set(name, new FakeCache()); return store.get(name); },
        async keys() { return [...store.keys()]; },
        async delete(name) { return store.delete(name); },
        async has(name) { return store.has(name); },
    };

    class Request {
        constructor(url, init = {}) { this.url = abs(url); this.method = init.method || 'GET'; this.mode = init.mode; this.cache = init.cache; }
    }
    class Response { static error() { return res(null, { status: 0, type: 'error' }); } }

    const clients = {
        matchAll: async () => clientList,
        claim: async () => { calls.claim++; },
        openWindow: async (url) => { calls.opened.push(url); },
    };
    const self = {
        addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
        location: { origin: ORIGIN, href: `${ORIGIN}/firebase-messaging-sw.js` },
        registration: { showNotification: async () => {}, pushManager: { getSubscription: async () => null } },
        skipWaiting: async () => { calls.skipWaiting++; },
        clients,
    };
    const sandbox = {
        self, clients, caches, Request, Response, URL, URLSearchParams, Promise,
        importScripts() {},
        console: { log() {}, warn() {}, error() {} },
        firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage() {} }) },
        setTimeout: (fn, ms, ...args) => { const t = { fn, ms, args, cleared: false }; timers.push(t); return t; },
        clearTimeout: (t) => { if (t) t.cleared = true; },
        fetch: async (input, init = {}) => {
            const url = abs(input);
            const req = {
                url, path: url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : url,
                cache: init.cache ?? input.cache, mode: init.mode ?? input.mode,
            };
            fetches.push(req);
            return respond(req);
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(SW_CODE, sandbox);
    const constant = (name) => vm.runInContext(name, sandbox);
    const SHELL_CACHE = constant('SHELL_CACHE');

    /** Fire a lifecycle event and wait for everything passed to waitUntil. */
    async function lifecycle(type, extra = {}) {
        const waits = [];
        const ev = { ...extra, waitUntil(p) { waits.push(p); } };
        for (const fn of listeners[type] || []) fn(ev);
        await Promise.all(waits);
    }

    /** Fire a fetch event. `response` is undefined when the worker does not intercept. */
    function request(url, { mode = 'no-cors', method = 'GET' } = {}) {
        const waits = [];
        let response;
        const ev = {
            request: Object.assign(new Request(url, { method, mode }), {}),
            respondWith(p) { response = Promise.resolve(p); },
            waitUntil(p) { waits.push(Promise.resolve(p)); },
        };
        for (const fn of listeners.fetch) fn(ev);
        return { intercepted: response !== undefined, response, settled: () => Promise.all(waits) };
    }

    return {
        sandbox, listeners, store, fetches, timers, calls, constant, SHELL_CACHE,
        install: () => lifecycle('install'),
        activate: () => lifecycle('activate'),
        request,
        navigate: (url) => request(url, { mode: 'navigate' }),
        shell: () => store.get(SHELL_CACHE),
        /** Run the pending timers (the navigation time limit). */
        runTimers() { for (const t of timers.splice(0)) if (!t.cleared) t.fn(...t.args); },
        click: (data) => lifecycle('notificationclick', { notification: { data, close() {} } }),
    };
}

/** Lets the promise chains inside the worker run. */
const tick = () => new Promise((r) => setImmediate(r));

/* ────────────────────────── install ────────────────────────── */

test('install: precaches the shell, the Firebase SDK and takes over', async () => {
    const sw = loadSW();
    await sw.install();
    const keys = sw.shell().keys();
    for (const url of sw.constant('PRECACHE_URLS')) assert.ok(keys.includes(abs(url)), `${url} precached`);
    for (const url of sw.constant('CROSS_ORIGIN_PRECACHE')) assert.ok(keys.includes(url), `${url} precached`);
    assert.equal((await sw.shell().match('/')).body, 'net:/');
    assert.equal(sw.calls.skipWaiting, 1);
});

test('install: one failed file fails the install, the old cache stays usable', async () => {
    for (const failure of [() => res('down', { status: 503 }), () => { throw new TypeError('Failed to fetch'); }]) {
        const sw = loadSW({
            caches: { [CACHE_1X]: { '/': 'old shell', '/js/app.js?v=a1716c3854': 'old js' } },
            respond: (r) => (r.path === '/icons.svg' ? failure() : res(`net:${r.path}`)),
        });
        await assert.rejects(sw.install(), 'the install promise must reject');
        assert.equal(sw.calls.skipWaiting, 0, 'a broken worker must not take over');
        assert.equal((await sw.store.get(CACHE_1X).match('/')).body, 'old shell');
        assert.equal((await sw.store.get(CACHE_1X).match('/js/app.js?v=a1716c3854')).body, 'old js');
        // Nothing half-filled that a later navigation could be served from
        const fresh = sw.shell();
        assert.ok(!fresh || !(await fresh.match('/')), 'no shell in the new cache');
    }
});

test('install: a failed Firebase SDK download does not block the install', async () => {
    const sw = loadSW({ respond: (r) => { if (r.url.startsWith(GSTATIC)) throw new TypeError('blocked'); return res(`net:${r.path}`); } });
    await sw.install();
    assert.equal(sw.calls.skipWaiting, 1);
    assert.equal((await sw.shell().match('/')).body, 'net:/');
});

test('install leaves older caches alone; only activate removes them', async () => {
    const sw = loadSW({ caches: { [CACHE_1X]: { '/': 'old shell' } } });
    await sw.install();
    assert.ok(sw.store.has(CACHE_1X), 'the old worker still serves pages from it until activation');
});

test('precache: only what the shell needs offline, versioned files without a forced download', async () => {
    const sw = loadSW();
    const urls = sw.constant('PRECACHE_URLS');
    // everything the static HTML loads from this origin
    const used = new Set(['/']);
    for (const m of INDEX_HTML.matchAll(/<(?:img|script)\b[^>]*\bsrc="([^":]+)"/g)) used.add('/' + m[1].replace(/^\//, ''));
    for (const m of INDEX_HTML.matchAll(/<link\b[^>]*rel="(?:stylesheet|icon|manifest)"[^>]*href="([^":]+)"/g)) used.add('/' + m[1].replace(/^\//, ''));
    for (const m of INDEX_HTML.matchAll(/<use href="([^"#]+)#/g)) used.add('/' + m[1]);
    for (const url of used) assert.ok(urls.includes(url), `${url} is used by index.html but not precached`);
    // icon and badge of the notifications the worker shows
    assert.ok(urls.includes('/icon-192.png') && urls.includes('/badge-96.png'));
    for (const url of urls) {
        assert.ok(used.has(url) || url === '/badge-96.png', `${url} is precached but the shell does not need it`);
        if (url !== '/') assert.ok(fs.existsSync(path.join(PUBLIC, url.split('?')[0])), `${url} is precached but missing`);
    }
    assert.ok(urls.some((u) => /^\/css\/app\.css\?v=[a-f0-9]{10}$/.test(u)) && urls.some((u) => /^\/js\/app\.js\?v=[a-f0-9]{10}$/.test(u)));

    await sw.install();
    for (const f of sw.fetches) {
        const versioned = f.url.includes('?v=') || f.url.startsWith(GSTATIC);
        if (versioned) assert.notEqual(f.cache, 'reload', `${f.path} is immutable: the HTTP cache may answer`);
        else assert.equal(f.cache, 'no-cache', `${f.path} has no version: must be revalidated`);
    }
    assert.equal(sw.fetches.filter((f) => f.url.startsWith(ORIGIN)).length, urls.length);
});

test('cache name carries the bundle hashes of the precache list', () => {
    const sw = loadSW();
    const urls = sw.constant('PRECACHE_URLS');
    const css = urls.find((u) => u.startsWith('/css/app.css')).split('?v=')[1];
    const js = urls.find((u) => u.startsWith('/js/app.js')).split('?v=')[1];
    assert.equal(sw.SHELL_CACHE, `bakalari-shell-${css}-${js}`);
    assert.ok(INDEX_HTML.includes(`css/app.css?v=${css}`) && INDEX_HTML.includes(`js/app.js?v=${js}`), 'index.html loads the same bundles');
});

/* ────────────────────────── activate ────────────────────────── */

test('activate: removes older shell caches (1.x and 2.0 names), keeps its own and foreign ones, claims pages', async () => {
    const sw = loadSW({
        caches: {
            [CACHE_1X]: { '/': 'shell 1.x' },
            'bakalari-shell-6473f0482f-0000000000': { '/': 'shell 2.0' },
            'bakalari-shell-v3': { '/': 'older naming' },
            'firebase-messaging-database': { x: 'not ours' },
        },
    });
    await sw.install();
    await sw.activate();
    assert.deepEqual([...sw.store.keys()].sort(), ['firebase-messaging-database', sw.SHELL_CACHE].sort());
    assert.equal((await sw.shell().match('/')).body, 'net:/', 'own cache is intact');
    assert.equal(sw.calls.claim, 1);
});

/* ────────────────────────── navigations ────────────────────────── */

test('navigation online: the network answer wins over the cached shell and replaces it', async () => {
    const sw = loadSW({ respond: (r) => res(`fresh:${r.path}`) });
    await (await sw.sandbox.caches.open(sw.SHELL_CACHE)).put('/', res('stale shell'));
    const nav = sw.navigate('/');
    assert.ok(nav.intercepted);
    assert.equal((await nav.response).body, 'fresh:/', 'a new deploy must be picked up on the next load');
    await nav.settled();
    assert.equal((await sw.shell().match('/')).body, 'fresh:/');
});

test('navigation: deep links and /index.html are stored under the single key "/"', async () => {
    const sw = loadSW();
    await sw.install();
    const before = sw.shell().keys().length;
    const links = ['/?view=changes', '/?view=rooms', '/?type=Class&id=ZL&schedule=Actual&hl=change&day=2',
        '/?type=Teacher&id=UXYZ&schedule=Next&hl=change', '/index.html', '/index.html?kiosk=changes'];
    for (const link of links) {
        const nav = sw.navigate(link);
        assert.equal((await nav.response).body, `net:${link}`);
        await nav.settled();
    }
    assert.equal(sw.shell().keys().length, before, 'no extra copy of index.html per address');
    assert.equal((await sw.shell().match('/')).body, `net:${links.at(-1)}`, 'the shell is refreshed in place');
});

test('navigation offline: the cached shell is served for every app address', async () => {
    let online = true;
    const sw = loadSW({ respond: (r) => { if (!online) throw new TypeError('Failed to fetch'); return res(`net:${r.path}`); } });
    await sw.install();
    online = false;
    for (const link of ['/', '/index.html', '/?view=changes', '/?type=Class&id=ZL&schedule=Actual&hl=change']) {
        const nav = sw.navigate(link);
        assert.equal((await nav.response).body, 'net:/', link);
        await nav.settled();
    }
});

test('navigation offline without a cached shell: a network error, not an exception', async () => {
    const sw = loadSW({ respond: () => { throw new TypeError('Failed to fetch'); } });
    const nav = sw.navigate('/');
    assert.equal((await nav.response).type, 'error');
    await nav.settled();
});

test('navigation: a server that does not answer gets about 3 s, then the cached shell', async () => {
    const pending = deferred();
    let hang = false;
    const sw = loadSW({ respond: (r) => (hang ? pending.promise : res(`net:${r.path}`)) });
    await sw.install();
    hang = true;

    const nav = sw.navigate('/?view=changes');
    let answered = false;
    nav.response.then(() => { answered = true; });
    await tick();
    assert.equal(answered, false, 'still waiting for the network');
    const limits = sw.timers.filter((t) => !t.cleared);
    assert.equal(limits.length, 1, 'one time limit is running');
    assert.ok(limits[0].ms >= 2000 && limits[0].ms <= 4000, `limit of about 3 s, got ${limits[0].ms} ms`);

    sw.runTimers();
    assert.equal((await nav.response).body, 'net:/', 'shell from the cache after the limit');

    // the late answer still refreshes the cached shell
    pending.resolve(res('late but fresh'));
    await nav.settled();
    assert.equal((await sw.shell().match('/')).body, 'late but fresh');
});

test('navigation: a fast answer cancels the time limit', async () => {
    const sw = loadSW();
    await sw.install();
    const nav = sw.navigate('/');
    await nav.response;
    await nav.settled();
    assert.equal(sw.timers.filter((t) => !t.cleared).length, 0);
});

test('navigation timeout without a cached shell: keeps waiting for the network', async () => {
    const pending = deferred();
    const sw = loadSW({ respond: () => pending.promise });
    const nav = sw.navigate('/');
    await tick();
    sw.runTimers();
    await tick();
    pending.resolve(res('first visit'));
    assert.equal((await nav.response).body, 'first visit');
});

test('navigation: a 5xx answer serves the cached shell and does not overwrite it', async () => {
    for (const status of [500, 502, 503, 504]) {
        let down = false;
        const sw = loadSW({ respond: (r) => (down ? res('Service Unavailable', { status }) : res(`net:${r.path}`)) });
        await sw.install();
        down = true;
        const nav = sw.navigate('/?view=rooms');
        const response = await nav.response;
        assert.equal(response.status, 200, `HTTP ${status}`);
        assert.equal(response.body, 'net:/');
        await nav.settled();
        assert.equal((await sw.shell().match('/')).body, 'net:/', 'the error page is never cached');
    }
});

test('navigation: 5xx without a cached shell and 4xx pass through unchanged', async () => {
    const down = loadSW({ respond: () => res('Service Unavailable', { status: 503 }) });
    assert.equal((await down.navigate('/').response).status, 503);

    const sw = loadSW();
    await sw.install();
    const missing = loadSW({ caches: { [sw.SHELL_CACHE]: { '/': 'shell' } }, respond: () => res('Not Found', { status: 404 }) });
    const nav = missing.navigate('/');
    assert.equal((await nav.response).status, 404);
    await nav.settled();
    assert.equal((await missing.shell().match('/')).body, 'shell');
});

test('navigations outside the app shell (/admin, /design.html) are left to the browser', () => {
    const sw = loadSW();
    for (const url of ['/admin', '/admin.html', '/design.html', '/api/ical/Class/ZL.ics']) {
        assert.equal(sw.navigate(url).intercepted, false, url);
    }
    assert.equal(sw.fetches.length, 0);
});

/* ────────────────────────── static files and API ────────────────────────── */

test('static files: cached copy at once, refreshed from the network in the background', async () => {
    const sw = loadSW();
    await sw.install();
    const js = sw.constant('PRECACHE_URLS').find((u) => u.startsWith('/js/app.js'));
    sw.fetches.length = 0;
    const cached = sw.request('/icons.svg');
    assert.equal((await cached.response).body, 'net:/icons.svg');
    assert.equal((await sw.request(js).response).body, `net:${js}`);
    await tick();
    assert.deepEqual(sw.fetches.map((f) => f.path), ['/icons.svg', js], 'revalidated');
});

test('static files: not cached yet → network, then stored; offline → cached copy', async () => {
    let online = true;
    const sw = loadSW({ respond: (r) => { if (!online) throw new TypeError('Failed to fetch'); return res(`net:${r.path}`); } });
    assert.equal((await sw.request('/screenshots/mobil-rozvrh.png').response).body, 'net:/screenshots/mobil-rozvrh.png');
    await tick();
    online = false;
    assert.equal((await sw.request('/screenshots/mobil-rozvrh.png').response).body, 'net:/screenshots/mobil-rozvrh.png');
    // an error answer is not stored
    online = true;
    const failing = loadSW({ respond: () => res('nope', { status: 404 }) });
    assert.equal((await failing.request('/missing.png').response).status, 404);
    await tick();
    assert.equal(await failing.shell().match('/missing.png'), undefined);
});

test('API calls, other methods and foreign origins are never intercepted', () => {
    const sw = loadSW();
    for (const url of ['/api/status', '/api/fcm/preferences/anon-1', '/api/auth']) {
        assert.equal(sw.request(url).intercepted, false, url);
        assert.equal(sw.request(url, { mode: 'cors' }).intercepted, false, url);
    }
    assert.equal(sw.request('/', { mode: 'navigate', method: 'POST' }).intercepted, false);
    assert.equal(sw.request('/icons.svg', { method: 'POST' }).intercepted, false);
    assert.equal(sw.request('https://firestore.googleapis.com/v1/projects/x').intercepted, false);
    assert.equal(sw.request('https://www.gstatic.com/other/lib.js').intercepted, false);
    assert.equal(sw.fetches.length, 0);
});

test('Firebase SDK from gstatic: cache-first, so the app boots offline', async () => {
    let online = true;
    const sw = loadSW({ respond: (r) => { if (!online) throw new TypeError('Failed to fetch'); return r.url.startsWith(GSTATIC) ? res(`net:${r.path}`, { type: 'opaque', status: 0 }) : res(`net:${r.path}`); } });
    await sw.install();
    sw.fetches.length = 0;
    assert.equal((await sw.request(`${GSTATIC}firebase-auth-compat.js`).response).body, `net:${GSTATIC}firebase-auth-compat.js`);
    assert.equal(sw.fetches.length, 0, 'served from the cache without a request');
    online = false;
    const sdk = sw.request(`${GSTATIC}firebase-app-compat.js`);
    assert.ok(sdk.intercepted);
    assert.equal((await sdk.response).body, `net:${GSTATIC}firebase-app-compat.js`);
});

/* ────────────────────────── notification click ────────────────────────── */

const CHANGE = { type: 'timetable_change', timetableType: 'Class', timetableId: 'ZL', scheduleType: 'Next', day: '2' };
const DEEP_LINK = '/?type=Class&id=ZL&schedule=Next&hl=change&day=2';

test('notification click without an open window opens the deep link of the change', async () => {
    const sw = loadSW();
    await sw.click(CHANGE);
    assert.deepEqual(sw.calls.opened, [DEEP_LINK]);
    await sw.click({ type: 'lesson_reminder' });
    assert.deepEqual(sw.calls.opened, [DEEP_LINK, '/']);
});

test('notification click with the app open focuses it and navigates to the deep link', async () => {
    const seen = { focused: 0, navigated: [] };
    const client = { url: `${ORIGIN}/?view=rooms`, focus: async () => { seen.focused++; }, navigate: async (p) => { seen.navigated.push(p); } };
    const sw = loadSW({ clientList: [client] });
    await sw.click(CHANGE);
    assert.equal(seen.focused, 1);
    assert.deepEqual(seen.navigated, [DEEP_LINK]);
    assert.deepEqual(sw.calls.opened, [], 'no second window');
});
