/**
 * Service worker push handling (public/firebase-messaging-sw.js), run in a
 * node:vm sandbox with a fake Firebase SDK, registration and clients.
 *
 * - every change notification gets a per-timetable tag;
 * - on Apple's push service (WebKit) every push is shown even while the app is
 *   visible - Firebase Messaging 9.22 shows nothing then, and WebKit revokes
 *   subscriptions whose pushes end without a notification;
 * - no push is shown twice; other browsers keep the SDK behaviour.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const SW_CODE = fs.readFileSync(path.join(PUBLIC, 'firebase-messaging-sw.js'), 'utf8');
const APPLE = 'https://web.push.apple.com/QGZ8n0w8';
const FCM = 'https://fcm.googleapis.com/fcm/send/abc:def';

function loadSW({ endpoint = null, visible = false } = {}) {
    const listeners = {};
    const shown = [];
    let backgroundHandler = null;
    const clients = {
        matchAll: async () => (visible ? [{ visibilityState: 'visible', url: 'https://rozvrh.test/' }] : []),
        claim: async () => {},
    };
    const self = {
        addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
        location: { origin: 'https://rozvrh.test' },
        registration: {
            showNotification: async (title, options) => { shown.push({ title, options }); },
            pushManager: { getSubscription: async () => (endpoint ? { endpoint } : null) },
        },
        skipWaiting: async () => {},
        clients,
    };
    const sandbox = {
        self, clients, URL, URLSearchParams, Promise, Request: class {}, Response,
        importScripts() {},
        console: { log() {}, warn() {}, error() {} },
        caches: { open: async () => ({}), keys: async () => [] },
        fetch: async () => ({}),
        firebase: {
            initializeApp() {},
            messaging: () => ({ onBackgroundMessage(fn) { backgroundHandler = fn; } }),
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(SW_CODE, sandbox);
    return { sandbox, listeners, shown, background: (payload) => backgroundHandler(payload) };
}

function pushEvent(message) {
    const ev = {
        data: message === undefined ? null : { json: () => (typeof message === 'string' ? JSON.parse(message) : message) },
        waitUntil(p) { this.promise = p; },
    };
    return ev;
}

async function firePush(sw, message) {
    const ev = pushEvent(message);
    for (const fn of sw.listeners.push || []) fn(ev);
    await ev.promise;
}

const CHANGE = {
    type: 'timetable_change', timetableType: 'Class', timetableId: 'ZL', scheduleType: 'Actual',
    title: 'ZL AKTUÁLNÍ: Změny v rozvrhu', body: '1 změna', detailedBody: 'Po 3. hod: suplování', day: '0',
};

test('notification tag is per timetable + week (change_<type>_<id>_<schedule>)', () => {
    const { sandbox } = loadSW();
    assert.equal(sandbox.notificationTag(CHANGE), 'change_Class_ZL_Actual');
    assert.equal(sandbox.notificationTag({ ...CHANGE, scheduleType: 'Next' }), 'change_Class_ZL_Next');
    assert.equal(sandbox.notificationTag({ type: 'lesson_reminder' }), 'lesson_reminder');
    assert.equal(sandbox.notificationTag({}), 'default');
    const { options } = sandbox.buildNotification(CHANGE);
    assert.equal(options.badge, '/badge-96.png');
    assert.equal(options.renotify, true, 'a newer change for the same timetable alerts again');
    assert.equal(options.body, CHANGE.detailedBody);
});

test('Apple push service + visible app: the worker shows the push itself, exactly once', async () => {
    const sw = loadSW({ endpoint: APPLE, visible: true });
    await firePush(sw, { data: CHANGE, from: '576497158390' });
    assert.equal(sw.shown.length, 1);
    assert.equal(sw.shown[0].title, CHANGE.title);
    assert.equal(sw.shown[0].options.tag, 'change_Class_ZL_Actual');
    // If the SDK also calls onBackgroundMessage (app went to background meanwhile),
    // the handler must not show a second notification.
    await sw.background({ data: CHANGE });
    assert.equal(sw.shown.length, 1);
});

test('Apple push service + app in background: still exactly one notification', async () => {
    const sw = loadSW({ endpoint: APPLE, visible: false });
    await firePush(sw, { data: CHANGE });
    await sw.background({ data: CHANGE });
    assert.equal(sw.shown.length, 1);
});

test('other push services keep the SDK path: background → onBackgroundMessage shows it', async () => {
    const sw = loadSW({ endpoint: FCM, visible: false });
    await firePush(sw, { data: CHANGE });
    assert.equal(sw.shown.length, 0, 'own push listener stays out of the way');
    await sw.background({ data: CHANGE });
    assert.equal(sw.shown.length, 1);
    assert.equal(sw.shown[0].options.tag, 'change_Class_ZL_Actual');
});

test('other push services in the foreground: no system notification (page shows a toast)', async () => {
    const sw = loadSW({ endpoint: FCM, visible: true });
    await firePush(sw, { data: CHANGE });
    assert.equal(sw.shown.length, 0);
});

test('messages with a notification part and broken payloads do not throw or duplicate', async () => {
    const sw = loadSW({ endpoint: APPLE, visible: true });
    await firePush(sw, { notification: { title: 'console' }, data: {} });
    assert.equal(sw.shown.length, 0, 'SDK shows notification messages itself');
    const ev = { data: { json: () => { throw new SyntaxError('bad'); } }, waitUntil(p) { this.promise = p; } };
    for (const fn of sw.listeners.push) fn(ev);
    await ev.promise;
    await firePush(sw, undefined);
    assert.equal(sw.shown.length, 0);
});

test('Apple endpoint rule is identical in the worker and in platform.js', async () => {
    const { sandbox } = loadSW();
    const { isApplePushEndpoint } = await import('../public/js/platform.js');
    const samples = [APPLE, 'https://api.push.apple.com/x', 'https://push.apple.com/x', FCM,
        'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://evil.com/push.apple.com', 'https://push.apple.com.evil.com/x',
        '', null, undefined, 'not a url'];
    for (const ep of samples) {
        assert.equal(sandbox.isApplePushEndpoint(ep), isApplePushEndpoint(ep), String(ep));
    }
    assert.equal(isApplePushEndpoint(APPLE), true);
    assert.equal(isApplePushEndpoint('https://push.apple.com.evil.com/x'), false);
});

test('every same-origin precache URL exists in public/', () => {
    const { sandbox } = loadSW();
    const urls = vm.runInContext('PRECACHE_URLS', sandbox);
    for (const url of urls) {
        if (url === '/') continue;
        const file = path.join(PUBLIC, url.split('?')[0]);
        assert.ok(fs.existsSync(file), `${url} is precached but missing`);
    }
    assert.ok(urls.includes('/badge-96.png') && urls.includes('/icon-maskable-512.png'));
});
