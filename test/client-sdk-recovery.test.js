/**
 * Recovery from the switch to SRI (public/js/sdk-recovery.js and the inline
 * <head> script of index.html): the first load after such a deploy is served
 * by the older service worker, whose opaque SDK copies a page with
 * integrity + crossorigin cannot use. Once the new worker has taken the page
 * over, the page reloads itself once - only early and before any input,
 * otherwise it offers the reload. Without a takeover nothing happens.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/** sessionStorage stand-in; `broken` throws like a blocked storage. */
function memoryStorage({ broken = false, forgetful = false } = {}) {
    const map = new Map();
    return {
        map,
        getItem(k) { if (broken) throw new Error('SecurityError'); return map.has(k) ? map.get(k) : null; },
        setItem(k, v) { if (broken) throw new Error('QuotaExceededError'); if (!forgetful) map.set(k, String(v)); },
        removeItem(k) { if (broken) throw new Error('SecurityError'); map.delete(k); },
    };
}

const OLD = { name: 'old worker' };
const NEW = { name: 'new worker' };

/** One page start: the boot record of the <head> script and a worker container. */
function start({ sdk = false, controller = OLD, takeover = false, input = false, storage = memoryStorage(), time = 500 } = {}) {
    const listeners = {};
    const env = { reloads: 0, notices: 0, time };
    const sw = {
        controller: takeover ? NEW : controller,
        addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    };
    const boot = { controller, takeover, input };
    const options = {
        sdkLoaded: () => sdk, boot, sw, storage,
        now: () => env.time,
        reload: () => { env.reloads++; },
        showNotice: () => { env.notices++; },
    };
    return {
        env, boot, sw, storage, options,
        /** Another worker takes the page over (the <head> script notes it as well). */
        takeOver() { sw.controller = NEW; boot.takeover = true; (listeners.controllerchange || []).forEach((fn) => fn()); },
        listeners,
    };
}

test('loop guard: one automatic reload per tab session, none without a working sessionStorage', async () => {
    const { claimReload, releaseReload, RELOAD_GUARD_KEY } = await import('../public/js/sdk-recovery.js');
    const storage = memoryStorage();
    assert.equal(claimReload(storage), true, 'first time');
    assert.equal(storage.map.get(RELOAD_GUARD_KEY), '1');
    assert.equal(claimReload(storage), false, 'the reloaded page must not reload again');
    assert.equal(claimReload(storage), false);
    releaseReload(storage); // the SDK loaded: a later deploy may recover the same way
    assert.equal(claimReload(storage), true);

    assert.equal(claimReload(memoryStorage({ broken: true })), false, 'storage that throws: no reload');
    assert.equal(claimReload(memoryStorage({ forgetful: true })), false, 'storage that does not keep the mark: no reload');
    assert.equal(claimReload(null), false, 'no storage at all');
    assert.doesNotThrow(() => releaseReload(memoryStorage({ broken: true })));
});

test('SDK missing, the new worker takes over in time: exactly one reload, never a loop', async () => {
    const { initSdkRecovery } = await import('../public/js/sdk-recovery.js');
    const storage = memoryStorage();
    const first = start({ storage });
    initSdkRecovery(first.options);
    assert.equal(first.env.reloads, 0, 'nothing before the takeover');
    first.takeOver();
    assert.equal(first.env.reloads, 1);
    assert.equal(first.env.notices, 0);

    // The reloaded page still has no SDK and sees yet another takeover: no second reload
    const again = start({ storage });
    initSdkRecovery(again.options);
    again.takeOver();
    assert.equal(again.env.reloads, 0);
    assert.equal(again.env.notices, 1, 'the notice offers the reload instead');

    // The SDK loads on a later page: the guard is released for a future deploy
    initSdkRecovery(start({ sdk: true, storage }).options);
    const later = start({ storage });
    initSdkRecovery(later.options);
    later.takeOver();
    assert.equal(later.env.reloads, 1);
});

test('a takeover that happened before the app started (or a controller other than the serving one) counts too', async () => {
    const { initSdkRecovery } = await import('../public/js/sdk-recovery.js');
    const noted = start({ takeover: true });
    initSdkRecovery(noted.options);
    assert.equal(noted.env.reloads, 1, 'noted by the <head> script');

    const swapped = start();
    swapped.sw.controller = NEW; // controllerchange missed, but the controller is not the one that served the page
    initSdkRecovery(swapped.options);
    assert.equal(swapped.env.reloads, 1);
});

test('after about 10 s or after the first input: the notice, no reload', async () => {
    const { initSdkRecovery, AUTO_RELOAD_WINDOW_MS } = await import('../public/js/sdk-recovery.js');
    assert.ok(AUTO_RELOAD_WINDOW_MS >= 8000 && AUTO_RELOAD_WINDOW_MS <= 12000, `about 10 s, got ${AUTO_RELOAD_WINDOW_MS}`);

    const late = start();
    initSdkRecovery(late.options);
    late.env.time = AUTO_RELOAD_WINDOW_MS + 1;
    late.takeOver();
    assert.deepEqual([late.env.reloads, late.env.notices], [0, 1]);
    assert.equal(late.storage.map.size, 0, 'the guard is not used up');

    const busy = start();
    initSdkRecovery(busy.options);
    busy.boot.input = true; // a tap or a key while the new worker installed
    busy.takeOver();
    assert.deepEqual([busy.env.reloads, busy.env.notices], [0, 1]);

    const early = start({ input: true, takeover: true });
    initSdkRecovery(early.options);
    assert.deepEqual([early.env.reloads, early.env.notices], [0, 1]);

    const noStorage = start({ storage: memoryStorage({ broken: true }) });
    initSdkRecovery(noStorage.options);
    noStorage.takeOver();
    assert.deepEqual([noStorage.env.reloads, noStorage.env.notices], [0, 1], 'no sessionStorage: no reload');
});

test('kiosk (unattended): reloads after the window and despite input, still only once', async () => {
    const { initSdkRecovery, AUTO_RELOAD_WINDOW_MS } = await import('../public/js/sdk-recovery.js');
    const storage = memoryStorage();
    const kiosk = start({ storage, input: true });
    kiosk.options.unattended = true;
    initSdkRecovery(kiosk.options);
    kiosk.env.time = AUTO_RELOAD_WINDOW_MS * 6;
    kiosk.takeOver();
    assert.deepEqual([kiosk.env.reloads, kiosk.env.notices], [1, 0]);

    const again = start({ storage });
    again.options.unattended = true;
    initSdkRecovery(again.options);
    again.takeOver();
    assert.deepEqual([again.env.reloads, again.env.notices], [0, 1], 'the loop guard holds for the kiosk too');
});

test('SDK missing without a takeover (gstatic down, wrong hash), SDK loaded, or a page no worker served: nothing happens', async () => {
    const { initSdkRecovery } = await import('../public/js/sdk-recovery.js');
    const outage = start();
    initSdkRecovery(outage.options);
    assert.deepEqual([outage.env.reloads, outage.env.notices], [0, 0], 'fallback mode as before');

    const fine = start({ sdk: true });
    initSdkRecovery(fine.options);
    assert.equal(fine.listeners.controllerchange, undefined, 'nothing to wait for');
    fine.takeOver();
    assert.deepEqual([fine.env.reloads, fine.env.notices], [0, 0]);

    // First visit (no worker served the page): the first worker claiming it changes nothing for the SDK
    const firstVisit = start({ controller: null });
    initSdkRecovery(firstVisit.options);
    firstVisit.takeOver();
    assert.deepEqual([firstVisit.env.reloads, firstVisit.env.notices], [0, 0]);

    // No service worker support, no boot record (inline script missing)
    assert.doesNotThrow(() => initSdkRecovery({ ...start().options, sw: undefined }));
    assert.doesNotThrow(() => initSdkRecovery({ ...start().options, boot: undefined }));

    // Several takeovers on one page: still one decision
    const twice = start();
    initSdkRecovery(twice.options);
    twice.takeOver();
    twice.takeOver();
    assert.equal(twice.env.reloads + twice.env.notices, 1);
});

/** The inline <head> script that notes the serving worker, a takeover and input. */
function headScript() {
    const head = html.slice(0, html.indexOf('</head>'));
    const scripts = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((c) => c.includes('__swBoot'));
    assert.equal(scripts.length, 1, 'one inline script in <head> sets window.__swBoot');
    return scripts[0];
}

test('index.html <head>: notes which worker served the page, a later takeover and the first input', () => {
    const code = headScript();
    const swListeners = {};
    const winListeners = {};
    const controller = { name: 'serving worker' };
    const window = {
        addEventListener: (type, fn, opts) => { (winListeners[type] ||= []).push({ fn, opts }); },
        navigator: { serviceWorker: { controller, addEventListener: (type, fn) => { (swListeners[type] ||= []).push(fn); } } },
    };
    window.window = window;
    vm.runInNewContext(code, window);
    const boot = window.__swBoot;
    assert.equal(boot.controller, controller);
    assert.equal(boot.takeover, false);
    assert.equal(boot.input, false);
    swListeners.controllerchange.forEach((fn) => fn());
    assert.equal(boot.takeover, true);
    for (const type of ['pointerdown', 'keydown']) {
        assert.ok(winListeners[type], type);
        assert.equal(winListeners[type][0].opts.capture, true, `${type}: seen before the app handles it`);
        assert.equal(winListeners[type][0].opts.passive, true, `${type}: never delays scrolling`);
    }
    winListeners.keydown[0].fn();
    assert.equal(boot.input, true);

    // without service workers, and with a navigator.serviceWorker that throws (blocked storage)
    for (const navigator of [{}, Object.defineProperty({}, 'serviceWorker', { get() { throw new Error('SecurityError'); } })]) {
        const w = { addEventListener() {}, navigator };
        w.window = w;
        assert.doesNotThrow(() => vm.runInNewContext(code, w));
        assert.equal(w.__swBoot.controller, null);
    }
});
